import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { VIEW_AS_COOKIE } from '../auth';
import {
  contractsOfLocation,
  countBills,
  first,
  getLocation,
  getStatement,
  getUser,
  listBills,
  listLocations,
  listRecentStatements,
  listStatementsOfLocation,
  listUsers,
  recurringOfLocation,
  run,
  tenantsOfLocation,
} from '../db';
import { minorToInput, parseAmount } from '../money';
import { applyCredits, ensureStatement, pullBills } from '../statements';
import {
  LINE_KIND_LABELS,
  RECURRING_KINDS,
  ROLE_LABELS,
  STATUS_LABELS,
  UTILITY_LABELS,
  UTILITY_TYPES,
  type AppEnv,
  type User,
} from '../types';
import { Avatar, Empty, Icon, KindIcon, Layout, Money, monthLabel, Options, PostButton, TableWrap } from '../ui/layout';
import { currentMonth, isMonth, normalizeContract, nullIfEmpty, parseList } from '../util';
import { adminBills, BillTable } from './admin-bills';
import { field, flash, form, intParam, notFound, redirect, type Ctx } from './common';
import { StatementTable } from './tenant';

export const admin = new Hono<AppEnv>();

admin.route('/bills', adminBills);

// --- dashboard ---------------------------------------------------------------

admin.get('/', async (c) => {
  const db = c.env.DB;
  const [pending, duplicates, locations, statements, unassigned, users] = await Promise.all([
    countBills(db, 'pending_review'),
    countBills(db, 'duplicate'),
    listLocations(db),
    listRecentStatements(db, 12),
    first<{ n: number }>(db, "SELECT count(*) AS n FROM bills WHERE location_id IS NULL AND status = 'pending_review'"),
    listUsers(db),
  ]);
  const [unbilled, awaiting] = await Promise.all([
    first<{ n: number }>(
      db,
      "SELECT count(*) AS n FROM bills b WHERE status = 'approved' AND NOT EXISTS (SELECT 1 FROM line_items li WHERE li.bill_id = b.id)",
    ),
    first<{ n: number }>(db, "SELECT count(*) AS n FROM statements WHERE status = 'sent'"),
  ]);
  const me = c.get('user');
  const tenants = users.filter((u) => u.role === 'tenant' && !u.banned);
  return c.html(
    <Layout title="Áttekintés" user={me} flash={flash(c)}>
      <div class="page-head">
        <div>
          <div class="eyebrow">
            <Icon name="sparkle" size={14} /> {me.name ? `Szia, ${me.name.split(/\s+/)[0]}!` : 'Szia!'} · {monthLabel(currentMonth())}
          </div>
          <h1>Áttekintés</h1>
        </div>
        <div class="actions" style="margin:0">
          <a class="btn" href="/admin/bills/new">
            <Icon name="upload" size={16} /> PDF feltöltése
          </a>
          <a class="btn primary" href="/admin/bills?status=pending_review">
            <Icon name="inbox" size={16} /> Számlák ellenőrzése
          </a>
        </div>
      </div>
      <div class="stats">
        <a class={`stat warn${pending > 0 ? ' attn' : ''}`} href="/admin/bills?status=pending_review">
          <span class="ico">
            <Icon name="inbox" size={22} />
          </span>
          <span>
            <div class="lbl">Ellenőrzésre vár</div>
            <div class="val">{pending}</div>
            {((unassigned?.n ?? 0) > 0 || duplicates > 0) && (
              <div class="muted">
                {[(unassigned?.n ?? 0) > 0 && `${unassigned?.n} ismeretlen`, duplicates > 0 && `${duplicates} duplikált`].filter(Boolean).join(' · ')}
              </div>
            )}
          </span>
        </a>
        <a class="stat info" href="/admin/bills?status=approved">
          <span class="ico">
            <Icon name="receipt" size={22} />
          </span>
          <span>
            <div class="lbl">Elszámolásra vár</div>
            <div class="val">{unbilled?.n ?? 0}</div>
          </span>
        </a>
        <div class="stat">
          <span class="ico">
            <Icon name="send" size={22} />
          </span>
          <span>
            <div class="lbl">Kiküldve, fizetésre vár</div>
            <div class="val">{awaiting?.n ?? 0}</div>
          </span>
        </div>
        <a class="stat ok" href="/admin/users">
          <span class="ico">
            <Icon name="users" size={22} />
          </span>
          <span>
            <div class="lbl">Ingatlan · bérlő</div>
            <div class="val">
              {locations.length} · {tenants.length}
            </div>
          </span>
        </a>
      </div>
      <div class="grid">
        <div class="card">
          <h2>
            <Icon name="calendar" /> Havi elszámolás
          </h2>
          <p class="muted">Létrehozza vagy frissíti a piszkozatokat minden ingatlanra, a jóváhagyott számlákkal és az ismétlődő tételekkel.</p>
          <form method="post" action="/admin/statements" class="row">
            <div>
              <label>Hónap</label>
              <input type="month" name="month" value={currentMonth()} required />
            </div>
            <div class="shrink">
              <button class="primary">
                <Icon name="sparkle" size={16} /> Létrehozás minden ingatlanra
              </button>
            </div>
          </form>
        </div>
        <ViewAsForm tenants={tenants} />
      </div>
      <h2>Ingatlanok</h2>
      {locations.length === 0 ? (
        <div class="card">
          <Empty icon="building" title="Még nincs ingatlan">
            <p>
              <a href="/admin/locations">Hozzon létre egyet</a> a kezdéshez.
            </p>
          </Empty>
        </div>
      ) : (
        <div class="st-list">
          {locations.map((l) => (
            <a class="st-card" href={`/admin/locations/${l.id}`}>
              <div class="top">
                <KindIcon kind="rent" />
                <span class="tag">{l.currency}</span>
              </div>
              <div>
                <div class="m">{l.name}</div>
                <div class="muted">{l.address ?? '\u00a0'}</div>
              </div>
              <div class="foot">
                <span></span>
                <span class="go">
                  Megnyitás <Icon name="arrowRight" size={14} />
                </span>
              </div>
            </a>
          ))}
        </div>
      )}
      <h2>Legutóbbi elszámolások</h2>
      <StatementTable rows={statements} showLocation />
    </Layout>,
  );
});

function ViewAsForm(p: { tenants: User[] }) {
  return (
    <div class="card">
      <h2>
        <Icon name="eye" /> Bérlői nézet
      </h2>
      <p class="muted">Pontosan azt látja, amit a kiválasztott bérlő. Az előnézet csak olvasható; a felső sávban léphet vissza.</p>
      {p.tenants.length === 0 ? (
        <p class="muted">
          Még nincs bérlő. <a href="/admin/users">Hívjon meg egyet.</a>
        </p>
      ) : (
        <form method="post" action="/admin/view-as" class="row">
          <div>
            <label>Bérlő</label>
            <select name="user_id">
              {p.tenants.map((u) => (
                <option value={String(u.id)}>{u.name ? `${u.name} (${u.email})` : u.email}</option>
              ))}
            </select>
          </div>
          <div class="shrink">
            <button class="primary">Megtekintés bérlőként</button>
          </div>
        </form>
      )}
    </div>
  );
}

admin.post('/view-as', async (c) => {
  const id = Number(field(await form(c), 'user_id'));
  const target = id ? await getUser(c.env.DB, id) : null;
  if (!target || target.role !== 'tenant' || target.banned)
    return redirect(c, '/admin', { err: 'Csak aktív bérlő nézete tekinthető meg' });
  setCookie(c, VIEW_AS_COOKIE, String(target.id), { path: '/', httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 8 * 3600 });
  return redirect(c, '/', { ok: `Bérlői nézet: ${target.email}` });
});

// --- statements --------------------------------------------------------------

admin.post('/statements', async (c) => {
  const f = await form(c);
  const month = field(f, 'month');
  if (!isMonth(month)) return redirect(c, '/admin', { err: 'Érvénytelen hónap' });
  const locations = await listLocations(c.env.DB);
  let created = 0;
  for (const l of locations) if ((await ensureStatement(c.env.DB, l.id, month)).created) created++;
  return redirect(c, '/admin', { ok: `${created} új elszámolás (${month}); a meglévő piszkozatok frissítve.` });
});

async function loadStatement(c: Ctx) {
  const id = intParam(c, 'id');
  return id ? getStatement(c.env.DB, id) : null;
}

admin.post('/statements/:id/refresh', async (c) => {
  const st = await loadStatement(c);
  if (!st) return notFound(c);
  if (st.status !== 'draft') return redirect(c, `/statements/${st.id}`, { err: 'Csak piszkozat módosítható' });
  const n = await pullBills(c.env.DB, st.id);
  return redirect(c, `/statements/${st.id}`, { ok: n ? `${n} számla hozzáadva` : 'Nincs új jóváhagyott számla' });
});

admin.post('/statements/:id/lines', async (c) => {
  const st = await loadStatement(c);
  if (!st) return notFound(c);
  const back = `/statements/${st.id}`;
  if (st.status !== 'draft') return redirect(c, back, { err: 'Csak piszkozat módosítható' });
  const f = await form(c);
  const kind = field(f, 'kind');
  if (!['adjustment', 'rent', 'condo_fee'].includes(kind)) return redirect(c, back, { err: 'Érvénytelen típus' });
  const description = field(f, 'description').slice(0, 300);
  const amount = parseAmount(field(f, 'amount'));
  if (!description || amount == null) return redirect(c, back, { err: 'Leírás és érvényes összeg szükséges' });
  await run(c.env.DB, 'INSERT INTO line_items (statement_id, kind, description, amount) VALUES (?, ?, ?, ?)', st.id, kind, description, amount);
  return redirect(c, back, { ok: `${LINE_KIND_LABELS[kind as 'adjustment']} hozzáadva` });
});

admin.post('/lines/:id/delete', async (c) => {
  const id = intParam(c, 'id');
  const line = id
    ? await first<{ id: number; statement_id: number; status: string; location_id: number }>(
        c.env.DB,
        'SELECT li.id, li.statement_id, s.status, s.location_id FROM line_items li JOIN statements s ON s.id = li.statement_id WHERE li.id = ?',
        id,
      )
    : null;
  if (!line) return notFound(c);
  if (line.status !== 'draft') return redirect(c, `/statements/${line.statement_id}`, { err: 'Csak piszkozat módosítható' });
  await run(c.env.DB, 'DELETE FROM line_items WHERE id = ?', line.id);
  await applyCredits(c.env.DB, line.location_id);
  return redirect(c, `/statements/${line.statement_id}`, { ok: 'Tétel törölve (az eltávolított számla a következő elszámolásba újra bekerülhet)' });
});

admin.post('/statements/:id/status', async (c) => {
  const st = await loadStatement(c);
  if (!st) return notFound(c);
  const f = await form(c);
  const to = field(f, 'status');
  const allowed: Record<string, string[]> = { draft: ['sent'], sent: ['paid', 'draft'], paid: ['draft'] };
  if (!allowed[st.status]?.includes(to)) return redirect(c, `/statements/${st.id}`, { err: 'Érvénytelen állapotváltás' });
  const sql =
    to === 'sent'
      ? "UPDATE statements SET status = 'sent', sent_at = datetime('now') WHERE id = ?"
      : to === 'paid'
        ? "UPDATE statements SET status = 'paid', paid_at = datetime('now') WHERE id = ?"
        : "UPDATE statements SET status = 'draft', sent_at = NULL, paid_at = NULL WHERE id = ?";
  await run(c.env.DB, sql, st.id);
  if (to === 'draft') await applyCredits(c.env.DB, st.location_id);
  return redirect(c, `/statements/${st.id}`, { ok: `Elszámolás állapota: ${STATUS_LABELS[to] ?? to}` });
});

admin.post('/statements/:id/delete', async (c) => {
  const st = await loadStatement(c);
  if (!st) return notFound(c);
  if (st.status !== 'draft') return redirect(c, `/statements/${st.id}`, { err: 'Csak piszkozat törölhető' });
  await run(c.env.DB, 'DELETE FROM statements WHERE id = ?', st.id);
  await applyCredits(c.env.DB, st.location_id);
  return redirect(c, `/admin/locations/${st.location_id}`, { ok: `${st.month} piszkozat törölve` });
});

// --- locations ---------------------------------------------------------------

admin.get('/locations', async (c) => {
  const locations = await listLocations(c.env.DB);
  return c.html(
    <Layout title="Ingatlanok" user={c.get('user')} flash={flash(c)}>
      <h1>Ingatlanok</h1>
      <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Név</th>
            <th>Cím</th>
            <th>Pénznem</th>
          </tr>
        </thead>
        <tbody>
          {locations.map((l) => (
            <tr>
              <td>
                <div class="cell">
                  <KindIcon kind="rent" small />
                  <a href={`/admin/locations/${l.id}`}>
                    <b>{l.name}</b>
                  </a>
                </div>
              </td>
              <td>{l.address ?? ''}</td>
              <td>
                <span class="tag">{l.currency}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </TableWrap>
      <form method="post" action="/admin/locations" class="card" style="margin-top:16px">
        <h2>Új ingatlan</h2>
        <LocationFields />
        <div class="actions">
          <button class="primary">Létrehozás</button>
        </div>
      </form>
    </Layout>,
  );
});

function LocationFields(p: { name?: string; address?: string | null; currency?: string }) {
  return (
    <div class="row">
      <div>
        <label>Név</label>
        <input name="name" required value={p.name ?? ''} placeholder="pl. Lisszaboni lakás" />
      </div>
      <div style="flex:2">
        <label>Cím</label>
        <input name="address" value={p.address ?? ''} />
      </div>
      <div class="shrink" style="width:110px">
        <label>Pénznem</label>
        <input name="currency" required maxlength={3} value={p.currency ?? 'EUR'} />
      </div>
    </div>
  );
}

function parseLocationForm(f: Awaited<ReturnType<typeof form>>) {
  const name = field(f, 'name').slice(0, 100);
  const currency = field(f, 'currency').toUpperCase();
  if (!name || !/^[A-Z]{3}$/.test(currency)) return null;
  return { name, address: nullIfEmpty(field(f, 'address')), currency };
}

admin.post('/locations', async (c) => {
  const v = parseLocationForm(await form(c));
  if (!v) return redirect(c, '/admin/locations', { err: 'Név és 3 betűs pénznem szükséges' });
  const row = await first<{ id: number }>(
    c.env.DB,
    'INSERT INTO locations (name, address, currency) VALUES (?, ?, ?) RETURNING id',
    v.name,
    v.address,
    v.currency,
  );
  return redirect(c, `/admin/locations/${row!.id}`, { ok: 'Ingatlan létrehozva' });
});

admin.get('/locations/:id', async (c) => {
  const id = intParam(c, 'id');
  const location = id ? await getLocation(c.env.DB, id) : null;
  if (!location) return notFound(c);
  const db = c.env.DB;
  const [contracts, recurring, tenants, users, statements, bills] = await Promise.all([
    contractsOfLocation(db, location.id),
    recurringOfLocation(db, location.id),
    tenantsOfLocation(db, location.id),
    listUsers(db),
    listStatementsOfLocation(db, location.id, true),
    listBills(db, { locationId: location.id }),
  ]);
  const candidates = users.filter((u) => !tenants.some((t) => t.id === u.id) && !u.banned);
  const base = `/admin/locations/${location.id}`;

  return c.html(
    <Layout title={location.name} user={c.get('user')} flash={flash(c)}>
      <a class="back" href="/admin/locations">
        <Icon name="arrowLeft" size={16} /> Ingatlanok
      </a>
      <div class="page-head">
        <div style="display:flex;gap:14px;align-items:center">
          <KindIcon kind="rent" large />
          <div>
            <div class="eyebrow">
              <Icon name="mapPin" size={14} /> {location.address ?? 'Ingatlan'} · {location.currency}
            </div>
            <h1>{location.name}</h1>
          </div>
        </div>
      </div>

      <div class="grid">
        <div class="card">
          <h2>
            <Icon name="calendar" /> Elszámolások
          </h2>
          <form method="post" action={`${base}/statements`} class="row">
            <div>
              <label>Hónap</label>
              <input type="month" name="month" value={currentMonth()} required />
            </div>
            <div class="shrink">
              <button class="primary">Létrehozás / frissítés</button>
            </div>
          </form>
          <div style="margin-top:12px">
            <StatementTable rows={statements} />
          </div>
        </div>

        <div class="card">
          <h2>
            <Icon name="refresh" /> Ismétlődő tételek
          </h2>
          <p class="muted">Minden új elszámolásba automatikusan bekerülnek.</p>
          <table>
            <tbody>
              {recurring.map((r) => (
                <tr>
                  <td>
                    <div class="cell">
                      <KindIcon kind={r.kind} small />
                      <div>
                        {r.description}
                        <div class="muted">
                          {LINE_KIND_LABELS[r.kind]}
                          {r.active ? '' : ' · szüneteltetve'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td class="num">
                    <Money amount={r.amount} currency={location.currency} />
                  </td>
                  <td>
                    <PostButton action={`/admin/recurring/${r.id}/toggle`} label={r.active ? 'szüneteltetés' : 'folytatás'} cls="link" />{' '}
                    <PostButton action={`/admin/recurring/${r.id}/delete`} label="törlés" cls="link" confirm="Törli ezt az ismétlődő tételt?" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form method="post" action={`${base}/recurring`} class="row">
            <div class="shrink">
              <label>Típus</label>
              <select name="kind">
                <Options values={RECURRING_KINDS} labels={LINE_KIND_LABELS} />
              </select>
            </div>
            <div style="flex:2">
              <label>Leírás</label>
              <input name="description" required placeholder="Havi bérleti díj" />
            </div>
            <div>
              <label>Összeg</label>
              <input name="amount" required placeholder="850.00" />
            </div>
            <div class="shrink">
              <button>Hozzáadás</button>
            </div>
          </form>
        </div>

        <div class="card">
          <h2>
            <Icon name="file" /> Azonosítók
          </h2>
          <p class="muted">Az ingatlanhoz tartozó számla-azonosítók (pl. felhasználó azonosító száma).</p>
          <table>
            <tbody>
              {contracts.map((ct) => (
                <tr>
                  <td>
                    <div class="cell">
                      <KindIcon kind={ct.utility_type ?? 'other'} small />
                      <div>
                    <code>{ct.contract_number}</code>
                    <div class="muted">
                      {[ct.utility_type ? UTILITY_LABELS[ct.utility_type] : null, ct.provider, ct.note].filter(Boolean).join(' · ')}
                    </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <PostButton action={`/admin/contracts/${ct.id}/delete`} label="törlés" cls="link" confirm="Törli ezt az azonosítót?" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form method="post" action={`${base}/contracts`} class="row">
            <div>
              <label>Azonosító</label>
              <input name="contract_number" required />
            </div>
            <div class="shrink">
              <label>Típus</label>
              <select name="utility_type">
                <Options values={UTILITY_TYPES} labels={UTILITY_LABELS} />
              </select>
            </div>
            <div>
              <label>Szolgáltató</label>
              <input name="provider" />
            </div>
            <div class="shrink">
              <button>Hozzáadás</button>
            </div>
          </form>
        </div>

        <div class="card">
          <h2>
            <Icon name="users" /> Bérlők
          </h2>
          <table>
            <tbody>
              {tenants.map((t) => (
                <tr>
                  <td>
                    <div class="cell">
                      <Avatar user={t} />
                      <div>
                        {t.name ?? t.email}
                        <div class="muted">
                          {t.email}
                          {t.banned ? ' · kitiltva' : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <PostButton action={`${base}/tenants/${t.id}/delete`} label="eltávolítás" cls="link" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {candidates.length > 0 ? (
            <form method="post" action={`${base}/tenants`} class="row">
              <div>
                <label>Felhasználó hozzárendelése</label>
                <select name="user_id">
                  {candidates.map((u) => (
                    <option value={String(u.id)}>
                      {u.email} ({ROLE_LABELS[u.role]})
                    </option>
                  ))}
                </select>
              </div>
              <div class="shrink">
                <button>Hozzárendelés</button>
              </div>
            </form>
          ) : (
            <p class="muted">
              Előbb <a href="/admin/users">hívjon meg egy felhasználót</a>.
            </p>
          )}
        </div>
      </div>

      <h2>Számlák</h2>
      <BillTable bills={bills} />

      <form method="post" action={base} class="card" style="margin-top:16px">
        <h2>Ingatlan szerkesztése</h2>
        <LocationFields name={location.name} address={location.address} currency={location.currency} />
        <div class="actions">
          <button>Mentés</button>
        </div>
      </form>
    </Layout>,
  );
});

admin.post('/locations/:id', async (c) => {
  const id = intParam(c, 'id');
  if (!id) return notFound(c);
  const v = parseLocationForm(await form(c));
  if (!v) return redirect(c, `/admin/locations/${id}`, { err: 'Név és 3 betűs pénznem szükséges' });
  await run(c.env.DB, 'UPDATE locations SET name = ?, address = ?, currency = ? WHERE id = ?', v.name, v.address, v.currency, id);
  return redirect(c, `/admin/locations/${id}`, { ok: 'Mentve' });
});

admin.post('/locations/:id/statements', async (c) => {
  const id = intParam(c, 'id');
  const location = id ? await getLocation(c.env.DB, id) : null;
  if (!location) return notFound(c);
  const month = field(await form(c), 'month');
  if (!isMonth(month)) return redirect(c, `/admin/locations/${location.id}`, { err: 'Érvénytelen hónap' });
  const st = await ensureStatement(c.env.DB, location.id, month);
  return redirect(c, `/statements/${st.id}`, { ok: st.created ? 'Piszkozat létrehozva' : 'Az elszámolás már létezett' });
});

admin.post('/locations/:id/recurring', async (c) => {
  const id = intParam(c, 'id');
  if (!id) return notFound(c);
  const f = await form(c);
  const kind = field(f, 'kind');
  const description = field(f, 'description').slice(0, 300);
  const amount = parseAmount(field(f, 'amount'));
  if (!(RECURRING_KINDS as readonly string[]).includes(kind) || !description || amount == null)
    return redirect(c, `/admin/locations/${id}`, { err: 'Típus, leírás és érvényes összeg szükséges' });
  await run(c.env.DB, 'INSERT INTO recurring_items (location_id, kind, description, amount) VALUES (?, ?, ?, ?)', id, kind, description, amount);
  return redirect(c, `/admin/locations/${id}`, { ok: `Hozzáadva: ${description} (${minorToInput(amount)})` });
});

admin.post('/recurring/:id/:op{toggle|delete}', async (c) => {
  const id = intParam(c, 'id');
  const item = id ? await first<{ location_id: number }>(c.env.DB, 'SELECT location_id FROM recurring_items WHERE id = ?', id) : null;
  if (!item) return notFound(c);
  if (c.req.param('op') === 'delete') await run(c.env.DB, 'DELETE FROM recurring_items WHERE id = ?', id);
  else await run(c.env.DB, 'UPDATE recurring_items SET active = 1 - active WHERE id = ?', id);
  return redirect(c, `/admin/locations/${item.location_id}`, { ok: 'Frissítve' });
});

admin.post('/locations/:id/contracts', async (c) => {
  const id = intParam(c, 'id');
  if (!id) return notFound(c);
  const f = await form(c);
  const number = normalizeContract(field(f, 'contract_number'));
  if (!number) return redirect(c, `/admin/locations/${id}`, { err: 'Az azonosító megadása kötelező' });
  const type = (UTILITY_TYPES as readonly string[]).includes(field(f, 'utility_type')) ? field(f, 'utility_type') : null;
  const existing = await first<{ location_id: number }>(c.env.DB, 'SELECT location_id FROM contracts WHERE contract_number = ?', number);
  if (existing && existing.location_id !== id) return redirect(c, `/admin/locations/${id}`, { err: `${number} már egy másik ingatlanhoz tartozik` });
  await run(
    c.env.DB,
    `INSERT INTO contracts (contract_number, location_id, utility_type, provider) VALUES (?, ?, ?, ?)
     ON CONFLICT (contract_number) DO UPDATE SET utility_type = excluded.utility_type, provider = excluded.provider`,
    number,
    id,
    type,
    nullIfEmpty(field(f, 'provider')),
  );
  // Assign any waiting bills that carry this contract number.
  const res = await run(
    c.env.DB,
    "UPDATE bills SET location_id = ?, updated_at = datetime('now') WHERE contract_number = ? AND location_id IS NULL AND status = 'pending_review'",
    id,
    number,
  );
  const n = res.meta.changes ?? 0;
  return redirect(c, `/admin/locations/${id}`, { ok: `${number} azonosító hozzáadva${n ? `; ${n} várakozó számla hozzárendelve` : ''}` });
});

admin.post('/contracts/:id/delete', async (c) => {
  const id = intParam(c, 'id');
  const ct = id ? await first<{ location_id: number }>(c.env.DB, 'SELECT location_id FROM contracts WHERE id = ?', id) : null;
  if (!ct) return notFound(c);
  await run(c.env.DB, 'DELETE FROM contracts WHERE id = ?', id);
  return redirect(c, `/admin/locations/${ct.location_id}`, { ok: 'Azonosító törölve' });
});

admin.post('/locations/:id/tenants', async (c) => {
  const id = intParam(c, 'id');
  if (!id) return notFound(c);
  const userId = Number(field(await form(c), 'user_id'));
  const user = userId ? await getUser(c.env.DB, userId) : null;
  if (!user) return redirect(c, `/admin/locations/${id}`, { err: 'Ismeretlen felhasználó' });
  await run(c.env.DB, 'INSERT INTO location_users (location_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING', id, user.id);
  return redirect(c, `/admin/locations/${id}`, { ok: `${user.email} hozzárendelve` });
});

admin.post('/locations/:id/tenants/:uid/delete', async (c) => {
  const id = intParam(c, 'id');
  const uid = intParam(c, 'uid');
  if (!id || !uid) return notFound(c);
  await run(c.env.DB, 'DELETE FROM location_users WHERE location_id = ? AND user_id = ?', id, uid);
  return redirect(c, `/admin/locations/${id}`, { ok: 'Bérlő eltávolítva az ingatlanról' });
});

// --- users -------------------------------------------------------------------

admin.get('/users', async (c) => {
  const db = c.env.DB;
  const [users, links] = await Promise.all([
    listUsers(db),
    db
      .prepare('SELECT lu.user_id, l.id, l.name FROM location_users lu JOIN locations l ON l.id = lu.location_id ORDER BY l.name')
      .all<{ user_id: number; id: number; name: string }>(),
  ]);
  const locations = await listLocations(db);
  const bootstrap = parseList(c.env.ADMIN_EMAILS);
  const me = c.get('user');
  return c.html(
    <Layout title="Felhasználók" user={me} flash={flash(c)}>
      <h1>Felhasználók</h1>
      <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Felhasználó</th>
            <th>Szerepkör</th>
            <th>Ingatlanok</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const locked = bootstrap.includes(u.email.toLowerCase()) || u.id === me.id;
            return (
              <tr>
                <td>
                  <div class="cell">
                    <Avatar user={u} />
                    <div>
                      <b>{u.name ?? u.email}</b>
                      <div class="muted">{u.email}</div>
                    </div>
                  </div>
                </td>
                <td>
                  {ROLE_LABELS[u.role]} {u.banned ? <span class="badge rejected">kitiltva</span> : null}
                </td>
                <td>
                  {links.results
                    .filter((l) => l.user_id === u.id)
                    .map((l) => (
                      <div>
                        <a href={`/admin/locations/${l.id}`}>{l.name}</a>
                      </div>
                    ))}
                </td>
                <td>
                  {locked ? (
                    <span class="muted">{u.id === me.id ? 'Ön' : 'állandó admin'}</span>
                  ) : (
                    <>
                      {u.role === 'tenant' && !u.banned && (
                        <>
                          <PostButton action="/admin/view-as" fields={{ user_id: String(u.id) }} label="nézet bérlőként" cls="link plain" />{' '}
                        </>
                      )}
                      <PostButton
                        action={`/admin/users/${u.id}`}
                        fields={{ op: 'role' }}
                        label={u.role === 'admin' ? 'legyen bérlő' : 'legyen admin'}
                        cls="link"
                        confirm={u.role === 'admin' ? undefined : `Teljes admin jogot ad neki: ${u.email}?`}
                      />{' '}
                      <PostButton
                        action={`/admin/users/${u.id}`}
                        fields={{ op: 'ban' }}
                        label={u.banned ? 'kitiltás feloldása' : 'kitiltás'}
                        cls="link"
                        confirm={u.banned ? undefined : `Kitiltja ${u.email} felhasználót? Azonnal elveszíti a hozzáférést.`}
                      />
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </TableWrap>

      <form method="post" action="/admin/users" class="card" style="margin-top:16px">
        <h2>
          <Icon name="send" /> Felhasználó meghívása
        </h2>
        <p class="muted">
          Az e-mail-címükkel jelentkeznek be ezen az oldalon (egyszer használatos kóddal). Csak meghívott, nem kitiltott címek léphetnek be.
        </p>
        <div class="row">
          <div>
            <label>E-mail</label>
            <input type="email" name="email" required />
          </div>
          <div>
            <label>Név</label>
            <input name="name" />
          </div>
          <div class="shrink">
            <label>Szerepkör</label>
            <select name="role">
              <option value="tenant">Bérlő</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label>Ingatlan</label>
            <select name="location_id">
              <option value="">—</option>
              {locations.map((l) => (
                <option value={String(l.id)}>{l.name}</option>
              ))}
            </select>
          </div>
          <div class="shrink">
            <button class="primary">Meghívás</button>
          </div>
        </div>
      </form>
    </Layout>,
  );
});

admin.post('/users', async (c) => {
  const f = await form(c);
  const email = field(f, 'email').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return redirect(c, '/admin/users', { err: 'Érvénytelen e-mail-cím' });
  const role = field(f, 'role') === 'admin' ? 'admin' : 'tenant';
  const row = await first<{ id: number }>(
    c.env.DB,
    `INSERT INTO users (email, name, role) VALUES (?, ?, ?)
     ON CONFLICT (email) DO UPDATE SET name = COALESCE(excluded.name, users.name) RETURNING id`,
    email,
    nullIfEmpty(field(f, 'name')),
    role,
  );
  const locationId = Number(field(f, 'location_id'));
  if (row && locationId) {
    await run(c.env.DB, 'INSERT INTO location_users (location_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING', locationId, row.id);
  }
  return redirect(c, '/admin/users', { ok: `${email} meghívva` });
});

admin.post('/users/:id', async (c) => {
  const id = intParam(c, 'id');
  const user = id ? await getUser(c.env.DB, id) : null;
  if (!user) return notFound(c);
  if (user.id === c.get('user').id || parseList(c.env.ADMIN_EMAILS).includes(user.email.toLowerCase()))
    return redirect(c, '/admin/users', { err: 'Ezt a felhasználót nem módosíthatja' });
  const op = field(await form(c), 'op');
  if (op === 'ban') await run(c.env.DB, 'UPDATE users SET banned = 1 - banned WHERE id = ?', user.id);
  else if (op === 'role') await run(c.env.DB, "UPDATE users SET role = CASE role WHEN 'admin' THEN 'tenant' ELSE 'admin' END WHERE id = ?", user.id);
  return redirect(c, '/admin/users', { ok: `${user.email} frissítve` });
});

