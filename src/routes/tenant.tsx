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
    <Layout title="My statements" user={user} flash={flash(c)}>
      <h1>My statements</h1>
      {locations.length === 0 && <p class="muted">You are not assigned to any property yet.</p>}
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
  if (p.rows.length === 0) return <p class="muted">No statements yet.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Month</th>
          {p.showLocation && <th>Location</th>}
          <th>Status</th>
          <th class="num">Lines</th>
          <th class="num">Total</th>
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
    <Layout title={`${st.location_name} ${st.month}`} user={user} flash={flash(c)}>
      <h1>
        {st.location_name} — {st.month} <Badge status={st.status} />
      </h1>
      <div class="card">
        <div class="muted">{st.total >= 0 ? 'Amount due from tenant' : 'Amount owed to tenant'}</div>
        <div class="total">
          <Money amount={Math.abs(st.total)} currency={st.currency} />
        </div>
        {st.sent_at && <div class="muted">Sent {st.sent_at}</div>}
        {st.paid_at && <div class="muted">Paid {st.paid_at}</div>}
        {admin && (
          <div class="actions">
            {draft && <PostButton action={`/admin/statements/${st.id}/refresh`} label="Pull newly approved bills" />}
            {draft && <PostButton action={`/admin/statements/${st.id}/status`} fields={{ status: 'sent' }} label="Mark as sent" cls="primary" />}
            {st.status === 'sent' && <PostButton action={`/admin/statements/${st.id}/status`} fields={{ status: 'paid' }} label="Mark as paid" cls="primary" />}
            {!draft && <PostButton action={`/admin/statements/${st.id}/status`} fields={{ status: 'draft' }} label="Re-open as draft" confirm="Re-open this statement? Tenants won't see it until it's sent again." />}
            {draft && <PostButton action={`/admin/statements/${st.id}/delete`} label="Delete draft" cls="danger" confirm="Delete this draft? Its bills become available for the next statement." />}
            <a class="btn" href={`/admin/locations/${st.location_id}`}>Location</a>
          </div>
        )}
      </div>

      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Type</th>
            <th>Documents</th>
            <th class="num">Amount</th>
            {editable && <th></th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr>
              <td>
                {l.description}
                {l.bill_due_date && <div class="muted">due {l.bill_due_date}{l.bill_paid_at ? ` · paid ${l.bill_paid_at}` : ''}</div>}
              </td>
              <td>{LINE_KIND_LABELS[l.kind]}</td>
              <td>
                {l.bill_id && l.bill_pdf && <a href={`/files/bills/${l.bill_id}/pdf`} target="_blank">bill</a>}{' '}
                {l.bill_id && l.bill_proof && <a href={`/files/bills/${l.bill_id}/proof`} target="_blank">proof of payment</a>}{' '}
                {admin && l.bill_id && <a href={`/admin/bills/${l.bill_id}`}>edit bill</a>}
              </td>
              <td class="num">
                <Money amount={l.amount} currency={st.currency} />
              </td>
              {editable && (
                <td>
                  <PostButton action={`/admin/lines/${l.id}/delete`} label="remove" cls="link" />
                </td>
              )}
            </tr>
          ))}
          {lines.length === 0 && (
            <tr>
              <td colspan={5} class="muted">No line items.</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colspan={3}>Total</td>
            <td class="num">
              <Money amount={st.total} currency={st.currency} />
            </td>
            {editable && <td></td>}
          </tr>
        </tfoot>
      </table>
      <p class="muted">Positive amounts are owed by the tenant; negative amounts are owed to the tenant.</p>

      {editable && (
        <div class="card">
          <h2 style="margin-top:0">Add line</h2>
          <form method="post" action={`/admin/statements/${st.id}/lines`} class="row">
            <div>
              <label>Type</label>
              <select name="kind">
                <option value="adjustment">Adjustment</option>
                <option value="rent">Rent</option>
                <option value="condo_fee">Condo fee</option>
              </select>
            </div>
            <div style="flex:3">
              <label>Description</label>
              <input name="description" required placeholder="e.g. Reimbursement: boiler repair" />
            </div>
            <div>
              <label>Amount ({st.currency}, negative = refund)</label>
              <input name="amount" required placeholder="-120.00" />
            </div>
            <div class="shrink">
              <button class="primary">Add</button>
            </div>
          </form>
        </div>
      )}

      <h2>Comments</h2>
      {comments.length === 0 && <p class="muted">No comments yet.</p>}
      {comments.map((cm) => (
        <div class="comment">
          <div class="muted">
            {cm.name ?? cm.email} {cm.role === 'admin' ? '(landlord)' : ''} · {cm.created_at}
            {cm.line_item_id ? ` · on: ${lines.find((l) => l.id === cm.line_item_id)?.description ?? 'removed line'}` : ''}
          </div>
          <div style="white-space:pre-wrap">{cm.body}</div>
        </div>
      ))}
      <form method="post" action={`/statements/${st.id}/comments`} class="card">
        <label>About</label>
        <select name="line_item_id">
          <option value="">The whole statement</option>
          {lines.map((l) => (
            <option value={String(l.id)}>{l.description}</option>
          ))}
        </select>
        <label>Comment</label>
        <textarea name="body" rows={3} required maxlength={4000}></textarea>
        <div class="actions">
          <button class="primary">Post comment</button>
        </div>
      </form>
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
  if (!body) return redirect(c, `/statements/${st.id}`, { err: 'Comment is empty' });
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
  return redirect(c, `/statements/${st.id}`, { ok: 'Comment posted' });
});
