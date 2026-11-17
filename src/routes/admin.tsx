import { Hono } from 'hono';
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
import { ensureStatement, pullBills } from '../statements';
import {
  LINE_KIND_LABELS,
  RECURRING_KINDS,
  UTILITY_LABELS,
  UTILITY_TYPES,
  type AppEnv,
} from '../types';
import { Layout, Money, Options, PostButton } from '../ui/layout';
import { currentMonth, isMonth, normalizeContract, nullIfEmpty, parseList } from '../util';
import { adminBills, BillTable } from './admin-bills';
import { field, flash, form, intParam, notFound, redirect, type Ctx } from './common';
import { StatementTable } from './tenant';

export const admin = new Hono<AppEnv>();

admin.route('/bills', adminBills);

// --- dashboard ---------------------------------------------------------------

admin.get('/', async (c) => {
  const db = c.env.DB;
  const [pending, duplicates, locations, statements, unassigned] = await Promise.all([
    countBills(db, 'pending_review'),
    countBills(db, 'duplicate'),
    listLocations(db),
    listRecentStatements(db, 12),
    first<{ n: number }>(db, "SELECT count(*) AS n FROM bills WHERE location_id IS NULL AND status = 'pending_review'"),
  ]);
  const unbilled = await first<{ n: number }>(
    db,
    "SELECT count(*) AS n FROM bills b WHERE status = 'approved' AND NOT EXISTS (SELECT 1 FROM line_items li WHERE li.bill_id = b.id)",
  );
  return c.html(
    <Layout title="Dashboard" user={c.get('user')} flash={flash(c)}>
      <h1>Dashboard</h1>
      <div class="grid">
        <div class="card">
          <div class="muted">Waiting for review</div>
          <div class="total">{pending}</div>
          {(unassigned?.n ?? 0) > 0 && <div class="muted">{unassigned?.n} with unknown contract number</div>}
          {duplicates > 0 && <div class="muted">{duplicates} duplicates</div>}
          <div class="actions">
            <a class="btn primary" href="/admin/bills?status=pending_review">
              Review bills
            </a>
            <a class="btn" href="/admin/bills/new">
              Upload PDF
            </a>
          </div>
        </div>
        <div class="card">
          <div class="muted">Approved, not on a statement yet</div>
          <div class="total">{unbilled?.n ?? 0}</div>
          <form method="post" action="/admin/statements" class="row">
            <div>
              <label>Create / refresh statements for month</label>
              <input type="month" name="month" value={currentMonth()} required />
            </div>
            <div class="shrink">
              <button class="primary">Create for all locations</button>
            </div>
          </form>
        </div>
      </div>
      <h2>Locations</h2>
      {locations.length === 0 ? (
        <p>
          No locations yet. <a href="/admin/locations">Create one</a>.
        </p>
      ) : (
        <div class="grid">
          {locations.map((l) => (
            <a class="card" href={`/admin/locations/${l.id}`} style="text-decoration:none;color:inherit">
              <b>{l.name}</b>
              <div class="muted">{l.address ?? ''}</div>
            </a>
          ))}
        </div>
      )}
      <h2>Recent statements</h2>
      <StatementTable rows={statements} showLocation />
    </Layout>,
  );
});

// --- statements --------------------------------------------------------------

admin.post('/statements', async (c) => {
  const f = await form(c);
  const month = field(f, 'month');
  if (!isMonth(month)) return redirect(c, '/admin', { err: 'Invalid month' });
  const locations = await listLocations(c.env.DB);
  let created = 0;
  for (const l of locations) if ((await ensureStatement(c.env.DB, l.id, month)).created) created++;
  return redirect(c, '/admin', { ok: `${created} new statement(s) for ${month}; existing drafts refreshed.` });
});

async function loadStatement(c: Ctx) {
  const id = intParam(c, 'id');
  return id ? getStatement(c.env.DB, id) : null;
}

admin.post('/statements/:id/refresh', async (c) => {
  const st = await loadStatement(c);
  if (!st) return notFound(c);
  if (st.status !== 'draft') return redirect(c, `/statements/${st.id}`, { err: 'Only drafts can be changed' });
  const n = await pullBills(c.env.DB, st.id);
  return redirect(c, `/statements/${st.id}`, { ok: n ? `Added ${n} bill(s)` : 'No new approved bills' });
});

admin.post('/statements/:id/lines', async (c) => {
  const st = await loadStatement(c);
  if (!st) return notFound(c);
  const back = `/statements/${st.id}`;
  if (st.status !== 'draft') return redirect(c, back, { err: 'Only drafts can be changed' });
  const f = await form(c);
  const kind = field(f, 'kind');
  if (!['adjustment', 'rent', 'condo_fee'].includes(kind)) return redirect(c, back, { err: 'Invalid type' });
  const description = field(f, 'description').slice(0, 300);
  const amount = parseAmount(field(f, 'amount'));
  if (!description || amount == null) return redirect(c, back, { err: 'Description and a valid amount are required' });
  await run(c.env.DB, 'INSERT INTO line_items (statement_id, kind, description, amount) VALUES (?, ?, ?, ?)', st.id, kind, description, amount);
  return redirect(c, back, { ok: `${LINE_KIND_LABELS[kind as 'adjustment']} added` });
});

admin.post('/lines/:id/delete', async (c) => {
  const id = intParam(c, 'id');
  const line = id
    ? await first<{ id: number; statement_id: number; status: string }>(
        c.env.DB,
        'SELECT li.id, li.statement_id, s.status FROM line_items li JOIN statements s ON s.id = li.statement_id WHERE li.id = ?',
        id,
      )
    : null;
  if (!line) return notFound(c);
  if (line.status !== 'draft') return redirect(c, `/statements/${line.statement_id}`, { err: 'Only drafts can be changed' });
  await run(c.env.DB, 'DELETE FROM line_items WHERE id = ?', line.id);
  return redirect(c, `/statements/${line.statement_id}`, { ok: 'Line removed (a removed bill will be offered again on the next statement)' });
});

admin.post('/statements/:id/status', async (c) => {
  const st = await loadStatement(c);
  if (!st) return notFound(c);
  const f = await form(c);
  const to = field(f, 'status');
  const allowed: Record<string, string[]> = { draft: ['sent'], sent: ['paid', 'draft'], paid: ['draft'] };
  if (!allowed[st.status]?.includes(to)) return redirect(c, `/statements/${st.id}`, { err: `Can't go from ${st.status} to ${to}` });
  const sql =
    to === 'sent'
      ? "UPDATE statements SET status = 'sent', sent_at = datetime('now') WHERE id = ?"
      : to === 'paid'
        ? "UPDATE statements SET status = 'paid', paid_at = datetime('now') WHERE id = ?"
        : "UPDATE statements SET status = 'draft', sent_at = NULL, paid_at = NULL WHERE id = ?";
  await run(c.env.DB, sql, st.id);
  return redirect(c, `/statements/${st.id}`, { ok: `Statement marked as ${to}` });
});

admin.post('/statements/:id/delete', async (c) => {
  const st = await loadStatement(c);
  if (!st) return notFound(c);
  if (st.status !== 'draft') return redirect(c, `/statements/${st.id}`, { err: 'Only drafts can be deleted' });
  await run(c.env.DB, 'DELETE FROM statements WHERE id = ?', st.id);
  return redirect(c, `/admin/locations/${st.location_id}`, { ok: `Draft ${st.month} deleted` });
});

// --- locations ---------------------------------------------------------------

admin.get('/locations', async (c) => {
  const locations = await listLocations(c.env.DB);
  return c.html(
    <Layout title="Locations" user={c.get('user')} flash={flash(c)}>
      <h1>Locations</h1>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Address</th>
            <th>Currency</th>
          </tr>
        </thead>
        <tbody>
          {locations.map((l) => (
            <tr>
              <td>
                <a href={`/admin/locations/${l.id}`}>{l.name}</a>
              </td>
              <td>{l.address ?? ''}</td>
              <td>{l.currency}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form method="post" action="/admin/locations" class="card" style="margin-top:16px">
        <h2 style="margin-top:0">New location</h2>
        <LocationFields />
        <div class="actions">
          <button class="primary">Create</button>
        </div>
      </form>
    </Layout>,
  );
});

function LocationFields(p: { name?: string; address?: string | null; currency?: string }) {
  return (
    <div class="row">
      <div>
        <label>Name</label>
        <input name="name" required value={p.name ?? ''} placeholder="Lisbon flat" />
      </div>
      <div style="flex:2">
        <label>Address</label>
        <input name="address" value={p.address ?? ''} />
      </div>
      <div class="shrink" style="width:110px">
        <label>Currency</label>
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
  if (!v) return redirect(c, '/admin/locations', { err: 'Name and a 3-letter currency are required' });
  const row = await first<{ id: number }>(
    c.env.DB,
    'INSERT INTO locations (name, address, currency) VALUES (?, ?, ?) RETURNING id',
    v.name,
    v.address,
    v.currency,
  );
  return redirect(c, `/admin/locations/${row!.id}`, { ok: 'Location created' });
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
      <h1>{location.name}</h1>

      <div class="grid">
        <div class="card">
          <h2 style="margin-top:0">Statements</h2>
          <form method="post" action={`${base}/statements`} class="row">
            <div>
              <label>Month</label>
              <input type="month" name="month" value={currentMonth()} required />
            </div>
            <div class="shrink">
              <button class="primary">Create / refresh</button>
            </div>
          </form>
          <div style="margin-top:12px">
            <StatementTable rows={statements} />
          </div>
        </div>

        <div class="card">
          <h2 style="margin-top:0">Recurring items</h2>
          <p class="muted">Copied into every new statement.</p>
          <table>
            <tbody>
              {recurring.map((r) => (
                <tr>
                  <td>
                    {r.description}
                    <div class="muted">{LINE_KIND_LABELS[r.kind]}{r.active ? '' : ' · paused'}</div>
                  </td>
                  <td class="num">
                    <Money amount={r.amount} currency={location.currency} />
                  </td>
                  <td>
                    <PostButton action={`/admin/recurring/${r.id}/toggle`} label={r.active ? 'pause' : 'resume'} cls="link" />{' '}
                    <PostButton action={`/admin/recurring/${r.id}/delete`} label="delete" cls="link" confirm="Delete this recurring item?" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form method="post" action={`${base}/recurring`} class="row">
            <div class="shrink">
              <label>Type</label>
              <select name="kind">
                <Options values={RECURRING_KINDS} labels={LINE_KIND_LABELS} />
              </select>
            </div>
            <div style="flex:2">
              <label>Description</label>
              <input name="description" required placeholder="Monthly rent" />
            </div>
            <div>
              <label>Amount</label>
              <input name="amount" required placeholder="850.00" />
            </div>
            <div class="shrink">
              <button>Add</button>
            </div>
          </form>
        </div>

        <div class="card">
          <h2 style="margin-top:0">Contract numbers</h2>
          <p class="muted">Bill identity numbers that belong to this location.</p>
          <table>
            <tbody>
              {contracts.map((ct) => (
                <tr>
                  <td>
                    <code>{ct.contract_number}</code>
                    <div class="muted">
                      {[ct.utility_type ? UTILITY_LABELS[ct.utility_type] : null, ct.provider, ct.note].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td>
                    <PostButton action={`/admin/contracts/${ct.id}/delete`} label="delete" cls="link" confirm="Delete this contract number?" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form method="post" action={`${base}/contracts`} class="row">
            <div>
              <label>Number</label>
              <input name="contract_number" required />
            </div>
            <div class="shrink">
              <label>Type</label>
              <select name="utility_type">
                <Options values={UTILITY_TYPES} labels={UTILITY_LABELS} />
              </select>
            </div>
            <div>
              <label>Provider</label>
              <input name="provider" />
            </div>
            <div class="shrink">
              <button>Add</button>
            </div>
          </form>
        </div>

        <div class="card">
          <h2 style="margin-top:0">Tenants</h2>
          <table>
            <tbody>
              {tenants.map((t) => (
                <tr>
                  <td>
                    {t.name ?? t.email}
                    <div class="muted">
                      {t.email}
                      {t.banned ? ' · banned' : ''}
                    </div>
                  </td>
                  <td>
                    <PostButton action={`${base}/tenants/${t.id}/delete`} label="remove" cls="link" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {candidates.length > 0 ? (
            <form method="post" action={`${base}/tenants`} class="row">
              <div>
                <label>Assign user</label>
                <select name="user_id">
                  {candidates.map((u) => (
                    <option value={String(u.id)}>
                      {u.email} ({u.role})
                    </option>
                  ))}
                </select>
              </div>
              <div class="shrink">
                <button>Assign</button>
              </div>
            </form>
          ) : (
            <p class="muted">
              <a href="/admin/users">Invite a user</a> first.
            </p>
          )}
        </div>
      </div>

      <h2>Bills</h2>
      <BillTable bills={bills} />

      <form method="post" action={base} class="card" style="margin-top:16px">
        <h2 style="margin-top:0">Edit location</h2>
        <LocationFields name={location.name} address={location.address} currency={location.currency} />
        <div class="actions">
          <button>Save</button>
        </div>
      </form>
    </Layout>,
  );
});

admin.post('/locations/:id', async (c) => {
  const id = intParam(c, 'id');
  if (!id) return notFound(c);
  const v = parseLocationForm(await form(c));
  if (!v) return redirect(c, `/admin/locations/${id}`, { err: 'Name and a 3-letter currency are required' });
  await run(c.env.DB, 'UPDATE locations SET name = ?, address = ?, currency = ? WHERE id = ?', v.name, v.address, v.currency, id);
  return redirect(c, `/admin/locations/${id}`, { ok: 'Saved' });
});

admin.post('/locations/:id/statements', async (c) => {
  const id = intParam(c, 'id');
  const location = id ? await getLocation(c.env.DB, id) : null;
  if (!location) return notFound(c);
  const month = field(await form(c), 'month');
  if (!isMonth(month)) return redirect(c, `/admin/locations/${location.id}`, { err: 'Invalid month' });
  const st = await ensureStatement(c.env.DB, location.id, month);
  return redirect(c, `/statements/${st.id}`, { ok: st.created ? 'Draft created' : 'Statement already existed; draft refreshed' });
});

admin.post('/locations/:id/recurring', async (c) => {
  const id = intParam(c, 'id');
  if (!id) return notFound(c);
  const f = await form(c);
  const kind = field(f, 'kind');
  const description = field(f, 'description').slice(0, 300);
  const amount = parseAmount(field(f, 'amount'));
  if (!(RECURRING_KINDS as readonly string[]).includes(kind) || !description || amount == null)
    return redirect(c, `/admin/locations/${id}`, { err: 'Type, description and a valid amount are required' });
  await run(c.env.DB, 'INSERT INTO recurring_items (location_id, kind, description, amount) VALUES (?, ?, ?, ?)', id, kind, description, amount);
  return redirect(c, `/admin/locations/${id}`, { ok: `Added ${description} (${minorToInput(amount)})` });
});

admin.post('/recurring/:id/:op{toggle|delete}', async (c) => {
  const id = intParam(c, 'id');
  const item = id ? await first<{ location_id: number }>(c.env.DB, 'SELECT location_id FROM recurring_items WHERE id = ?', id) : null;
  if (!item) return notFound(c);
  if (c.req.param('op') === 'delete') await run(c.env.DB, 'DELETE FROM recurring_items WHERE id = ?', id);
  else await run(c.env.DB, 'UPDATE recurring_items SET active = 1 - active WHERE id = ?', id);
  return redirect(c, `/admin/locations/${item.location_id}`, { ok: 'Updated' });
});

admin.post('/locations/:id/contracts', async (c) => {
  const id = intParam(c, 'id');
  if (!id) return notFound(c);
  const f = await form(c);
  const number = normalizeContract(field(f, 'contract_number'));
  if (!number) return redirect(c, `/admin/locations/${id}`, { err: 'Contract number is required' });
  const type = (UTILITY_TYPES as readonly string[]).includes(field(f, 'utility_type')) ? field(f, 'utility_type') : null;
  const existing = await first<{ location_id: number }>(c.env.DB, 'SELECT location_id FROM contracts WHERE contract_number = ?', number);
  if (existing && existing.location_id !== id) return redirect(c, `/admin/locations/${id}`, { err: `${number} already belongs to another location` });
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
  return redirect(c, `/admin/locations/${id}`, { ok: `Contract ${number} added${n ? `; ${n} waiting bill(s) assigned` : ''}` });
});

admin.post('/contracts/:id/delete', async (c) => {
  const id = intParam(c, 'id');
  const ct = id ? await first<{ location_id: number }>(c.env.DB, 'SELECT location_id FROM contracts WHERE id = ?', id) : null;
  if (!ct) return notFound(c);
  await run(c.env.DB, 'DELETE FROM contracts WHERE id = ?', id);
  return redirect(c, `/admin/locations/${ct.location_id}`, { ok: 'Contract number deleted' });
});

admin.post('/locations/:id/tenants', async (c) => {
  const id = intParam(c, 'id');
  if (!id) return notFound(c);
  const userId = Number(field(await form(c), 'user_id'));
  const user = userId ? await getUser(c.env.DB, userId) : null;
  if (!user) return redirect(c, `/admin/locations/${id}`, { err: 'Unknown user' });
  await run(c.env.DB, 'INSERT INTO location_users (location_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING', id, user.id);
  return redirect(c, `/admin/locations/${id}`, { ok: `${user.email} assigned` });
});

admin.post('/locations/:id/tenants/:uid/delete', async (c) => {
  const id = intParam(c, 'id');
  const uid = intParam(c, 'uid');
  if (!id || !uid) return notFound(c);
  await run(c.env.DB, 'DELETE FROM location_users WHERE location_id = ? AND user_id = ?', id, uid);
  return redirect(c, `/admin/locations/${id}`, { ok: 'Tenant removed from location' });
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
    <Layout title="Users" user={me} flash={flash(c)}>
      <h1>Users</h1>
      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Role</th>
            <th>Locations</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const locked = bootstrap.includes(u.email.toLowerCase()) || u.id === me.id;
            return (
              <tr>
                <td>
                  {u.name ?? u.email}
                  <div class="muted">{u.email}</div>
                </td>
                <td>
                  {u.role} {u.banned ? <span class="badge rejected">banned</span> : null}
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
                    <span class="muted">{u.id === me.id ? 'you' : 'bootstrap admin'}</span>
                  ) : (
                    <>
                      <PostButton
                        action={`/admin/users/${u.id}`}
                        fields={{ op: 'role' }}
                        label={u.role === 'admin' ? 'make tenant' : 'make admin'}
                        cls="link"
                        confirm={u.role === 'admin' ? undefined : `Give ${u.email} full admin access?`}
                      />{' '}
                      <PostButton
                        action={`/admin/users/${u.id}`}
                        fields={{ op: 'ban' }}
                        label={u.banned ? 'unban' : 'ban'}
                        cls="link"
                        confirm={u.banned ? undefined : `Ban ${u.email}? They lose access immediately.`}
                      />
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <form method="post" action="/admin/users" class="card" style="margin-top:16px">
        <h2 style="margin-top:0">Invite user</h2>
        <p class="muted">
          They sign in at this site with their email through Cloudflare Access. Only invited, non-banned emails get in.
        </p>
        <div class="row">
          <div>
            <label>Email</label>
            <input type="email" name="email" required />
          </div>
          <div>
            <label>Name</label>
            <input name="name" />
          </div>
          <div class="shrink">
            <label>Role</label>
            <select name="role">
              <option value="tenant">tenant</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <div>
            <label>Location</label>
            <select name="location_id">
              <option value="">—</option>
              {locations.map((l) => (
                <option value={String(l.id)}>{l.name}</option>
              ))}
            </select>
          </div>
          <div class="shrink">
            <button class="primary">Invite</button>
          </div>
        </div>
      </form>
    </Layout>,
  );
});

admin.post('/users', async (c) => {
  const f = await form(c);
  const email = field(f, 'email').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return redirect(c, '/admin/users', { err: 'Invalid email' });
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
  return redirect(c, '/admin/users', { ok: `${email} invited` });
});

admin.post('/users/:id', async (c) => {
  const id = intParam(c, 'id');
  const user = id ? await getUser(c.env.DB, id) : null;
  if (!user) return notFound(c);
  if (user.id === c.get('user').id || parseList(c.env.ADMIN_EMAILS).includes(user.email.toLowerCase()))
    return redirect(c, '/admin/users', { err: "You can't change that user" });
  const op = field(await form(c), 'op');
  if (op === 'ban') await run(c.env.DB, 'UPDATE users SET banned = 1 - banned WHERE id = ?', user.id);
  else if (op === 'role') await run(c.env.DB, "UPDATE users SET role = CASE role WHEN 'admin' THEN 'tenant' ELSE 'admin' END WHERE id = ?", user.id);
  return redirect(c, '/admin/users', { ok: `${user.email} updated` });
});

