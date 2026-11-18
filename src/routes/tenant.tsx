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
import { Badge, Layout, Money, PostButton } from '../ui/layout';
import { LINE_KIND_LABELS, type AppEnv } from '../types';
import { canSeeStatement, field, flash, form, intParam, notFound, redirect } from './common';

export const tenant = new Hono<AppEnv>();

tenant.get('/', async (c) => {
  const user = c.get('user');
  if (user.role === 'admin') return c.redirect('/admin');
  const locations = await locationsForUser(c.env.DB, user.id);
  const byLocation = await Promise.all(
    locations.map(async (l) => ({ location: l, statements: await listStatementsOfLocation(c.env.DB, l.id, false) })),
  );
  return c.html(
    <Layout title="Elszámolásaim" user={user} impersonator={c.get('realUser')} flash={flash(c)}>
      <h1>Elszámolásaim</h1>
      {locations.length === 0 && <p class="muted">Még nincs ingatlanhoz rendelve.</p>}
      {byLocation.map(({ location, statements }) => (
        <div class="card">
          <h2 style="margin-top:0">{location.name}</h2>
          {location.address && <p class="muted">{location.address}</p>}
          <StatementTable rows={statements} />
        </div>
      ))}
    </Layout>,
  );
});

export function StatementTable(p: { rows: StatementRow[]; showLocation?: boolean }) {
  if (p.rows.length === 0) return <p class="muted">Még nincs elszámolás.</p>;
  return (
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
              <a href={`/statements/${s.id}`}>{s.month}</a>
            </td>
            {p.showLocation && <td>{s.location_name}</td>}
            <td>
              <Badge status={s.status} />
            </td>
            <td class="num">{s.lines}</td>
            <td class="num">
              <Money amount={s.total} currency={s.currency} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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

  return c.html(
    <Layout title={`${st.location_name} ${st.month}`} user={user} impersonator={c.get('realUser')} flash={flash(c)}>
      <h1>
        {st.location_name} — {st.month} <Badge status={st.status} />
      </h1>
      <div class="card">
        <div class="muted">{st.total >= 0 ? 'A bérlő által fizetendő' : 'A bérlőnek visszajár'}</div>
        <div class="total">
          <Money amount={Math.abs(st.total)} currency={st.currency} />
        </div>
        {st.sent_at && <div class="muted">Kiküldve: {st.sent_at}</div>}
        {st.paid_at && <div class="muted">Fizetve: {st.paid_at}</div>}
        {admin && (
          <div class="actions">
            {draft && <PostButton action={`/admin/statements/${st.id}/refresh`} label="Új jóváhagyott számlák behúzása" />}
            {draft && <PostButton action={`/admin/statements/${st.id}/status`} fields={{ status: 'sent' }} label="Kiküldöttnek jelölés" cls="primary" />}
            {st.status === 'sent' && <PostButton action={`/admin/statements/${st.id}/status`} fields={{ status: 'paid' }} label="Fizetettnek jelölés" cls="primary" />}
            {!draft && <PostButton action={`/admin/statements/${st.id}/status`} fields={{ status: 'draft' }} label="Visszaállítás piszkozatra" confirm="Visszaállítja piszkozatra? A bérlő addig nem látja, amíg újra ki nem küldi." />}
            {draft && <PostButton action={`/admin/statements/${st.id}/delete`} label="Piszkozat törlése" cls="danger" confirm="Törli ezt a piszkozatot? A számlái a következő elszámolásba kerülhetnek." />}
            <a class="btn" href={`/admin/locations/${st.location_id}`}>Ingatlan</a>
          </div>
        )}
      </div>

      <table>
        <thead>
          <tr>
            <th>Tétel</th>
            <th>Típus</th>
            <th>Dokumentumok</th>
            <th class="num">Összeg</th>
            {editable && <th></th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr>
              <td>
                {l.description}
                {l.bill_due_date && <div class="muted">határidő: {l.bill_due_date}{l.bill_paid_at ? ` · fizetve: ${l.bill_paid_at}` : ''}</div>}
              </td>
              <td>{LINE_KIND_LABELS[l.kind]}</td>
              <td>
                {l.bill_id && l.bill_pdf && <a href={`/files/bills/${l.bill_id}/pdf`} target="_blank">számla</a>}{' '}
                {l.bill_id && l.bill_proof && <a href={`/files/bills/${l.bill_id}/proof`} target="_blank">befizetési igazolás</a>}{' '}
                {admin && l.bill_id && <a href={`/admin/bills/${l.bill_id}`}>számla szerkesztése</a>}
              </td>
              <td class="num">
                <Money amount={l.amount} currency={st.currency} />
              </td>
              {editable && (
                <td>
                  <PostButton action={`/admin/lines/${l.id}/delete`} label="törlés" cls="link" />
                </td>
              )}
            </tr>
          ))}
          {lines.length === 0 && (
            <tr>
              <td colspan={5} class="muted">Nincsenek tételek.</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colspan={3}>Összesen</td>
            <td class="num">
              <Money amount={st.total} currency={st.currency} />
            </td>
            {editable && <td></td>}
          </tr>
        </tfoot>
      </table>
      <p class="muted">A pozitív összeget a bérlő fizeti, a negatív összeg a bérlőnek jár vissza.</p>

      {editable && (
        <div class="card">
          <h2 style="margin-top:0">Tétel hozzáadása</h2>
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
              <label>Összeg ({st.currency}, negatív = visszatérítés)</label>
              <input name="amount" required placeholder="-120.00" />
            </div>
            <div class="shrink">
              <button class="primary">Hozzáadás</button>
            </div>
          </form>
        </div>
      )}

      <h2>Megjegyzések</h2>
      {comments.length === 0 && <p class="muted">Még nincs megjegyzés.</p>}
      {comments.map((cm) => (
        <div class="comment">
          <div class="muted">
            {cm.name ?? cm.email} {cm.role === 'admin' ? '(főbérlő)' : ''} · {cm.created_at}
            {cm.line_item_id ? ` · tétel: ${lines.find((l) => l.id === cm.line_item_id)?.description ?? 'törölt tétel'}` : ''}
          </div>
          <div style="white-space:pre-wrap">{cm.body}</div>
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
        <textarea name="body" rows={3} required maxlength={4000}></textarea>
        <div class="actions">
          <button class="primary">Megjegyzés küldése</button>
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
