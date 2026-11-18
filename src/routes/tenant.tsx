import { Hono } from 'hono';
import {
  commentsOfStatement,
  getStatementRow,
  linesOfStatement,
  listStatementsOfLocation,
  locationsForUser,
  run,
  type StatementRow,
} from '../db';
import { Avatar, Badge, Empty, Icon, KindIcon, Layout, Money, monthLabel, PostButton, TableWrap } from '../ui/layout';
import { LINE_KIND_LABELS, UTILITY_LABELS, type AppEnv, type UtilityType } from '../types';
import { canSeeStatement, field, flash, form, intParam, notFound, redirect } from './common';

export const tenant = new Hono<AppEnv>();

const day = (ts: string | null) => (ts ? ts.slice(0, 10) : null);

/** Wording + colour of a statement's headline amount. */
function headline(st: StatementRow) {
  if (st.status === 'paid') return { cls: 'settled', text: 'Kiegyenlítve' };
  if (st.total < 0) return { cls: 'refund', text: 'Visszajár Önnek' };
  if (st.total === 0) return { cls: 'settled', text: 'Nincs fizetendő' };
  return { cls: '', text: 'Fizetendő összeg' };
}

tenant.get('/', async (c) => {
  const user = c.get('user');
  if (user.role === 'admin') return c.redirect('/admin');
  const locations = await locationsForUser(c.env.DB, user.id);
  const byLocation = await Promise.all(
    locations.map(async (l) => ({ location: l, statements: await listStatementsOfLocation(c.env.DB, l.id, false) })),
  );
  const firstName = user.name?.split(/\s+/)[0];
  return c.html(
    <Layout title="Elszámolásaim" user={user} impersonator={c.get('realUser')} flash={flash(c)}>
      <div class="page-head">
        <div>
          <div class="eyebrow">
            <Icon name="sparkle" size={14} /> {firstName ? `Üdvözöljük, ${firstName}!` : 'Üdvözöljük!'}
          </div>
          <h1>Elszámolásaim</h1>
        </div>
      </div>
      {locations.length === 0 && (
        <div class="card">
          <Empty icon="building" title="Még nincs ingatlanhoz rendelve">
            <p>Amint a főbérlő hozzárendeli Önt egy ingatlanhoz, itt jelennek meg a havi elszámolások.</p>
          </Empty>
        </div>
      )}
      {byLocation.map(({ location, statements }) => {
        const [latest, ...older] = statements;
        return (
          <section>
            {byLocation.length > 1 && (
              <div class="loc-head">
                <KindIcon kind="rent" />
                <div>
                  <h2>{location.name}</h2>
                  {location.address && <div class="muted">{location.address}</div>}
                </div>
              </div>
            )}
            {latest ? (
              <LatestHero st={latest} address={byLocation.length === 1 ? location.address : null} />
            ) : (
              <div class="card">
                <Empty icon="calendar" title="Még nincs elszámolás">
                  <p>Az első havi elszámolás itt jelenik meg, amint elkészül.</p>
                </Empty>
              </div>
            )}
            {older.length > 0 && (
              <>
                <h2>Korábbi elszámolások</h2>
                <StatementCards rows={older} />
              </>
            )}
          </section>
        );
      })}
    </Layout>,
  );
});

function LatestHero(p: { st: StatementRow; address: string | null }) {
  const h = headline(p.st);
  return (
    <a class={`hero ${h.cls}`} href={`/statements/${p.st.id}`} style="display:block;color:#fff;text-decoration:none">
      <div class="hl">
        <Icon name="calendar" size={16} /> {monthLabel(p.st.month)} · {p.st.location_name}
      </div>
      <div class="amount">
        <Money amount={Math.abs(p.st.total)} currency={p.st.currency} />
      </div>
      <div class="sub">{h.text}</div>
      <div class="meta">
        <Badge status={p.st.status} />
        <span class="chip">
          <Icon name="receipt" size={14} /> {p.st.lines} tétel
        </span>
        {p.address && (
          <span class="chip">
            <Icon name="mapPin" size={14} /> {p.address}
          </span>
        )}
        <span class="chip">
          Részletek <Icon name="arrowRight" size={14} />
        </span>
      </div>
    </a>
  );
}

function StatementCards(p: { rows: StatementRow[] }) {
  return (
    <div class="st-list">
      {p.rows.map((s) => (
        <a class="st-card" href={`/statements/${s.id}`}>
          <div class="top">
            <span class="m">{monthLabel(s.month)}</span>
            <Badge status={s.status} />
          </div>
          <div class="amt">
            <Money amount={s.total} currency={s.currency} />
          </div>
          <div class="foot">
            <span>{s.lines} tétel</span>
            <span class="go">
              Megnyitás <Icon name="arrowRight" size={14} />
            </span>
          </div>
        </a>
      ))}
    </div>
  );
}

export function StatementTable(p: { rows: StatementRow[]; showLocation?: boolean }) {
  if (p.rows.length === 0) return <p class="muted">Még nincs elszámolás.</p>;
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Hónap</th>
            {p.showLocation && <th>Ingatlan</th>}
            <th>Állapot</th>
            <th class="num">Tételek</th>
            <th class="num">Összesen</th>
          </tr>
        </thead>
        <tbody>
          {p.rows.map((s) => (
            <tr>
              <td>
                <a href={`/statements/${s.id}`}>
                  <b>{monthLabel(s.month)}</b>
                </a>
              </td>
              {p.showLocation && <td>{s.location_name}</td>}
              <td>
                <Badge status={s.status} />
              </td>
              <td class="num">{s.lines}</td>
              <td class="num">
                <b>
                  <Money amount={s.total} currency={s.currency} />
                </b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function Stepper(p: { st: StatementRow }) {
  const idx = { draft: 0, sent: 1, paid: 2 }[p.st.status] ?? 0;
  const steps = [
    { label: 'Elkészült', at: day(p.st.created_at) },
    { label: 'Kiküldve', at: day(p.st.sent_at) },
    { label: 'Fizetve', at: day(p.st.paid_at) },
  ];
  return (
    <ol class="stepper">
      {steps.map((s, i) => (
        <li class={i <= idx ? 'done' : i === idx + 1 ? 'cur' : ''}>
          <span class="dot">{i <= idx && <Icon name="check" size={14} />}</span>
          <span>
            {s.label}
            {i <= idx && s.at && (
              <>
                <br />
                <small>{s.at}</small>
              </>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

tenant.get('/statements/:id', async (c) => {
  const id = intParam(c, 'id');
  const user = c.get('user');
  const st = id ? await getStatementRow(c.env.DB, id) : null;
  if (!st || !(await canSeeStatement(c.env.DB, user, st))) return notFound(c);
  const [lines, comments] = await Promise.all([linesOfStatement(c.env.DB, st.id), commentsOfStatement(c.env.DB, st.id)]);
  const admin = user.role === 'admin';
  const draft = st.status === 'draft';
  const editable = admin && draft;
  const h = headline(st);

  return c.html(
    <Layout title={`${st.location_name} ${monthLabel(st.month)}`} user={user} impersonator={c.get('realUser')} flash={flash(c)}>
      <a class="back" href={admin ? '/admin' : '/'}>
        <Icon name="arrowLeft" size={16} /> {admin ? 'Áttekintés' : 'Elszámolásaim'}
      </a>

      <div class={`hero ${h.cls}`}>
        <div class="hl">
          <Icon name="building" size={16} /> {st.location_name}
        </div>
        <div style="font-size:20px;font-weight:700;margin-top:2px">{monthLabel(st.month)}</div>
        <div class="amount">
          <Money amount={Math.abs(st.total)} currency={st.currency} />
        </div>
        <div class="sub">
          {admin ? (st.total >= 0 ? 'A bérlő által fizetendő' : 'A bérlőnek visszajár') : h.text}
        </div>
        <Stepper st={st} />
        <div class="actions no-print">
          {admin && draft && <PostButton action={`/admin/statements/${st.id}/status`} fields={{ status: 'sent' }} label="Kiküldöttnek jelölés" cls="primary" icon="send" />}
          {admin && st.status === 'sent' && (
            <PostButton action={`/admin/statements/${st.id}/status`} fields={{ status: 'paid' }} label="Fizetettnek jelölés" cls="primary" icon="checkCircle" />
          )}
          {admin && draft && <PostButton action={`/admin/statements/${st.id}/refresh`} label="Új jóváhagyott számlák behúzása" icon="refresh" />}
          {admin && !draft && (
            <PostButton
              action={`/admin/statements/${st.id}/status`}
              fields={{ status: 'draft' }}
              label="Visszaállítás piszkozatra"
              confirm="Visszaállítja piszkozatra? A bérlő addig nem látja, amíg újra ki nem küldi."
            />
          )}
          {admin && draft && (
            <PostButton
              action={`/admin/statements/${st.id}/delete`}
              label="Piszkozat törlése"
              cls="danger"
              icon="trash"
              confirm="Törli ezt a piszkozatot? A számlái a következő elszámolásba kerülhetnek."
            />
          )}
          {admin && (
            <a class="btn" href={`/admin/locations/${st.location_id}`}>
              <Icon name="building" size={16} /> Ingatlan
            </a>
          )}
          <button type="button" onclick="window.print()">
            <Icon name="printer" size={16} /> Nyomtatás
          </button>
        </div>
      </div>

      <div class="card flush">
        <div class="card-head">
          <h2>Tételek</h2>
          <span class="muted">{lines.length} tétel</span>
        </div>
        <ul class="lines">
          {lines.map((l) => {
            const kind = l.kind === 'utility' ? (l.bill_utility ?? 'utility') : l.kind;
            const kindLabel = l.kind === 'utility' && l.bill_utility ? UTILITY_LABELS[l.bill_utility as UtilityType] : LINE_KIND_LABELS[l.kind];
            const meta = [
              // Skip the type when the description already starts with it ("Víz · EPAL · …").
              (!l.description.startsWith(kindLabel) || (!l.bill_due_date && !l.bill_paid_at)) && kindLabel,
              l.bill_due_date && `határidő: ${l.bill_due_date}`,
              l.bill_paid_at && `fizetve: ${day(l.bill_paid_at)}`,
            ].filter(Boolean);
            return (
              <li>
                <KindIcon kind={kind} />
                <div class="desc">
                  <div class="t">{l.description}</div>
                  <div class="muted">{meta.join(' · ')}</div>
                  {l.bill_id && (l.bill_pdf || l.bill_proof || admin) && (
                    <div class="docs">
                      {l.bill_pdf && (
                        <a class="doc" href={`/files/bills/${l.bill_id}/pdf`} target="_blank">
                          <Icon name="file" /> számla
                        </a>
                      )}
                      {l.bill_proof && (
                        <a class="doc" href={`/files/bills/${l.bill_id}/proof`} target="_blank">
                          <Icon name="checkCircle" /> befizetési igazolás
                        </a>
                      )}
                      {admin && (
                        <a class="doc" href={`/admin/bills/${l.bill_id}`}>
                          <Icon name="eye" /> számla szerkesztése
                        </a>
                      )}
                    </div>
                  )}
                </div>
                <div class="amt">
                  <Money amount={l.amount} currency={st.currency} />
                  {editable && (
                    <div>
                      <PostButton action={`/admin/lines/${l.id}/delete`} label="törlés" cls="link" />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
          {lines.length === 0 && (
            <li>
              <span class="muted">Nincsenek tételek.</span>
            </li>
          )}
          <li class="sum">
            <div class="desc">Összesen</div>
            <div class="amt">
              <Money amount={st.total} currency={st.currency} />
            </div>
          </li>
        </ul>
      </div>
      <p class="muted">A pozitív összeget a bérlő fizeti, a negatív összeg a bérlőnek jár vissza.</p>

      {editable && (
        <div class="card">
          <h2>Tétel hozzáadása</h2>
          <form method="post" action={`/admin/statements/${st.id}/lines`} class="row">
            <div>
              <label>Típus</label>
              <select name="kind">
                <option value="adjustment">Korrekció</option>
                <option value="rent">Bérleti díj</option>
                <option value="condo_fee">Közös költség</option>
              </select>
            </div>
            <div style="flex:3">
              <label>Leírás</label>
              <input name="description" required placeholder="pl. Visszatérítés: kazánjavítás" />
            </div>
            <div>
              <label>Összeg ({st.currency})</label>
              <input name="amount" required placeholder="-120.00 = visszatérítés" />
            </div>
            <div class="shrink">
              <button class="primary">Hozzáadás</button>
            </div>
          </form>
        </div>
      )}

      <h2>
        <Icon name="message" /> Megjegyzések
      </h2>
      {comments.length === 0 && <p class="muted">Még nincs megjegyzés. Kérdése van egy tétellel kapcsolatban? Írjon nyugodtan.</p>}
      {comments.map((cm) => (
        <div class={`comment${cm.email === user.email ? ' mine' : ''}`}>
          <Avatar user={cm} />
          <div class="bubble">
            <div class="who-line">
              <b>{cm.name ?? cm.email}</b>
              {cm.role === 'admin' && <span class="tag">főbérlő</span>}
              <span>· {cm.created_at}</span>
              {cm.line_item_id && <span class="tag">{lines.find((l) => l.id === cm.line_item_id)?.description ?? 'törölt tétel'}</span>}
            </div>
            <div class="body">{cm.body}</div>
          </div>
        </div>
      ))}
      {c.get('realUser') ? (
        <p class="muted">Bérlői előnézetben nem lehet megjegyzést írni.</p>
      ) : (
        <form method="post" action={`/statements/${st.id}/comments`} class="card">
          <label>Mire vonatkozik</label>
          <select name="line_item_id">
            <option value="">A teljes elszámolás</option>
            {lines.map((l) => (
              <option value={String(l.id)}>{l.description}</option>
            ))}
          </select>
          <label>Megjegyzés</label>
          <textarea name="body" rows={3} required maxlength={4000} placeholder="Írja ide kérdését vagy megjegyzését…"></textarea>
          <div class="actions">
            <button class="primary">
              <Icon name="send" size={16} /> Megjegyzés küldése
            </button>
          </div>
        </form>
      )}
    </Layout>,
  );
});

tenant.post('/statements/:id/comments', async (c) => {
  const id = intParam(c, 'id');
  const user = c.get('user');
  const st = id ? await getStatementRow(c.env.DB, id) : null;
  if (!st || !(await canSeeStatement(c.env.DB, user, st))) return notFound(c);
  const f = await form(c);
  const body = field(f, 'body').slice(0, 4000);
  if (!body) return redirect(c, `/statements/${st.id}`, { err: 'A megjegyzés üres' });
  const lineId = Number(field(f, 'line_item_id')) || null;
  await run(
    c.env.DB,
    `INSERT INTO comments (statement_id, line_item_id, user_id, body)
     VALUES (?, (SELECT id FROM line_items WHERE id = ? AND statement_id = ?), ?, ?)`,
    st.id,
    lineId,
    st.id,
    user.id,
    body,
  );
  return redirect(c, `/statements/${st.id}`, { ok: 'Megjegyzés elküldve' });
});
