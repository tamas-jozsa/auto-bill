import { Hono } from 'hono';
import { getBill, getLocation, listBills, listLocations, run, statementOfBill } from '../db';
import { ingestPdf, reextractBill } from '../intake';
import { minorToInput, parseAmount } from '../money';
import { syncBillLine } from '../statements';
import { BILL_STATUSES, UTILITY_LABELS, UTILITY_TYPES, type AppEnv, type Bill } from '../types';
import { Badge, Layout, Money, Options, PostButton } from '../ui/layout';
import { isDate, normalizeContract, nullIfEmpty } from '../util';
import { field, file, flash, form, intParam, notFound, redirect } from './common';

export const adminBills = new Hono<AppEnv>();

const MAX_UPLOAD = 20 * 1024 * 1024;
const PROOF_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

adminBills.get('/', async (c) => {
  const status = c.req.query('status') ?? 'pending_review';
  const valid = status === 'all' || (BILL_STATUSES as readonly string[]).includes(status);
  const bills = await listBills(c.env.DB, { status: valid && status !== 'all' ? status : undefined });
  return c.html(
    <Layout title="Bills" user={c.get('user')} flash={flash(c)}>
      <h1>Bills</h1>
      <div class="actions" style="margin-bottom:16px">
        {[...BILL_STATUSES, 'all'].map((s) => (
          <a class={`btn ${s === status ? 'primary' : ''}`} href={`/admin/bills?status=${s}`}>
            {s.replace('_', ' ')}
          </a>
        ))}
        <a class="btn" href="/admin/bills/new" style="margin-left:auto">
          Upload PDF
        </a>
      </div>
      <BillTable bills={bills} />
    </Layout>,
  );
});

export function BillTable(p: { bills: (Bill & { location_name: string | null; statement_id: number | null; statement_month: string | null })[] }) {
  if (p.bills.length === 0) return <p class="muted">Nothing here.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Status</th>
          <th>Type / provider</th>
          <th>Location</th>
          <th>Contract</th>
          <th>Due</th>
          <th class="num">Amount</th>
          <th>Statement</th>
        </tr>
      </thead>
      <tbody>
        {p.bills.map((b) => (
          <tr>
            <td>
              <a href={`/admin/bills/${b.id}`}>{b.id}</a>
            </td>
            <td>
              <Badge status={b.status} />
            </td>
            <td>
              {UTILITY_LABELS[b.utility_type]}
              <div class="muted">{b.provider ?? b.email_subject ?? ''}</div>
            </td>
            <td>{b.location_name ?? <span class="badge rejected">unassigned</span>}</td>
            <td>{b.contract_number ?? '—'}</td>
            <td>{b.due_date ?? '—'}</td>
            <td class="num">
              <Money amount={b.amount} currency={b.currency} />
            </td>
            <td>{b.statement_id ? <a href={`/statements/${b.statement_id}`}>{b.statement_month}</a> : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

adminBills.get('/new', (c) =>
  c.html(
    <Layout title="Upload bill" user={c.get('user')} flash={flash(c)}>
      <h1>Upload a bill PDF</h1>
      <form method="post" action="/admin/bills" enctype="multipart/form-data" class="card">
        <p class="muted">The PDF goes through the same extraction as emailed bills and lands in the review queue.</p>
        <input type="file" name="file" accept="application/pdf" required />
        <div class="actions">
          <button class="primary">Upload &amp; extract</button>
        </div>
      </form>
    </Layout>,
  ),
);

adminBills.post('/', async (c) => {
  const f = await form(c);
  const pdf = file(f, 'file');
  if (!pdf) return redirect(c, '/admin/bills/new', { err: 'Choose a PDF file' });
  if (pdf.size > MAX_UPLOAD) return redirect(c, '/admin/bills/new', { err: 'File is larger than 20 MB' });
  const bytes = await pdf.arrayBuffer();
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') return redirect(c, '/admin/bills/new', { err: 'That is not a PDF' });
  const id = await ingestPdf(c.env, { bytes, filename: pdf.name || 'upload.pdf', source: 'upload' });
  return redirect(c, `/admin/bills/${id}`, { ok: 'Uploaded. Check the extracted fields.' });
});

adminBills.get('/:id', async (c) => {
  const id = intParam(c, 'id');
  const bill = id ? await getBill(c.env.DB, id) : null;
  if (!bill) return notFound(c);
  const [locations, statement] = await Promise.all([listLocations(c.env.DB), statementOfBill(c.env.DB, bill.id)]);
  const location = locations.find((l) => l.id === bill.location_id);
  const currencyMismatch = location && bill.currency && bill.currency !== location.currency;
  let extraction: string | null = null;
  try {
    extraction = bill.extraction ? JSON.stringify(JSON.parse(bill.extraction), null, 2) : null;
  } catch {
    extraction = bill.extraction;
  }

  return c.html(
    <Layout title={`Bill ${bill.id}`} user={c.get('user')} flash={flash(c)}>
      <h1>
        Bill #{bill.id} <Badge status={bill.status} />
      </h1>
      <div class="split">
        <div>
          {statement && (
            <div class="flash ok">
              On statement <a href={`/statements/${statement.id}`}>{statement.month}</a> ({statement.status})
              {statement.status !== 'draft' && ' — edits here no longer change that statement.'}
            </div>
          )}
          {!bill.location_id && bill.contract_number && (
            <div class="flash err">
              Unknown contract number <b>{bill.contract_number}</b>. Pick a location below — it will be remembered for future bills.
            </div>
          )}
          {currencyMismatch && (
            <div class="flash err">
              Bill currency {bill.currency} differs from the location currency {location.currency}; it can't go on a statement.
            </div>
          )}
          <form method="post" action={`/admin/bills/${bill.id}`} class="card">
            <label>Location</label>
            <select name="location_id">
              <option value="">— unassigned —</option>
              {locations.map((l) => (
                <option value={String(l.id)} selected={l.id === bill.location_id}>
                  {l.name}
                </option>
              ))}
            </select>
            <label>
              <input type="checkbox" name="remember_contract" value="1" checked={!bill.location_id} /> Remember this contract
              number for the selected location
            </label>
            <div class="row">
              <div>
                <label>Contract / identity number</label>
                <input name="contract_number" value={bill.contract_number ?? ''} />
              </div>
              <div>
                <label>Type</label>
                <select name="utility_type">
                  <Options values={UTILITY_TYPES} selected={bill.utility_type} labels={UTILITY_LABELS} />
                </select>
              </div>
            </div>
            <div class="row">
              <div>
                <label>Provider</label>
                <input name="provider" value={bill.provider ?? ''} />
              </div>
              <div>
                <label>Invoice number</label>
                <input name="invoice_number" value={bill.invoice_number ?? ''} />
              </div>
            </div>
            <div class="row">
              <div>
                <label>Amount to pay</label>
                <input name="amount" value={minorToInput(bill.amount)} placeholder="18.10" />
              </div>
              <div>
                <label>Currency</label>
                <input name="currency" value={bill.currency ?? location?.currency ?? ''} maxlength={3} />
              </div>
            </div>
            <div class="row">
              <div>
                <label>Issue date</label>
                <input type="date" name="issue_date" value={bill.issue_date ?? ''} />
              </div>
              <div>
                <label>Due date</label>
                <input type="date" name="due_date" value={bill.due_date ?? ''} />
              </div>
            </div>
            <div class="row">
              <div>
                <label>Period start</label>
                <input type="date" name="period_start" value={bill.period_start ?? ''} />
              </div>
              <div>
                <label>Period end</label>
                <input type="date" name="period_end" value={bill.period_end ?? ''} />
              </div>
            </div>
            <label>Notes</label>
            <textarea name="notes" rows={2}>
              {bill.notes ?? ''}
            </textarea>
            <div class="actions">
              <button name="action" value="save">Save</button>
              <button name="action" value="approve" class="primary">
                Save &amp; approve
              </button>
              <button name="action" value="reject" class="danger">
                Reject
              </button>
              {bill.status !== 'pending_review' && <button name="action" value="pending">Back to review</button>}
            </div>
          </form>

          <form method="post" action={`/admin/bills/${bill.id}/payment`} enctype="multipart/form-data" class="card">
            <h2 style="margin-top:0">Payment</h2>
            <label>Paid on</label>
            <input type="date" name="paid_at" value={bill.paid_at ?? ''} />
            <label>Proof of payment (PDF or image){bill.proof_key && ' — replaces the current one'}</label>
            <input type="file" name="proof" accept="application/pdf,image/png,image/jpeg,image/webp" />
            {bill.proof_key && (
              <p>
                <a href={`/files/bills/${bill.id}/proof`} target="_blank">
                  Current proof
                </a>
              </p>
            )}
            <div class="actions">
              <button class="primary">Save payment</button>
            </div>
          </form>

          <div class="card">
            <div class="muted">
              Source: {bill.source}
              {bill.email_from && ` · from ${bill.email_from}`}
              {bill.email_subject && ` · “${bill.email_subject}”`} · received {bill.created_at}
            </div>
            <div class="actions">
              {bill.raw_email_key && (
                <a class="btn" href={`/files/bills/${bill.id}/raw`}>
                  Download raw email
                </a>
              )}
              {bill.pdf_key && (
                <PostButton action={`/admin/bills/${bill.id}/reextract`} label="Re-run extraction" confirm="Overwrite the fields with a fresh AI extraction?" />
              )}
            </div>
            {extraction && (
              <details>
                <summary class="muted">AI output</summary>
                <pre style="white-space:pre-wrap;font-size:12px">{extraction}</pre>
              </details>
            )}
          </div>
        </div>
        <div>
          {bill.pdf_key ? (
            <iframe class="pdf" src={`/files/bills/${bill.id}/pdf`} title="Bill PDF"></iframe>
          ) : (
            <div class="card muted">No PDF stored for this bill.</div>
          )}
        </div>
      </div>
    </Layout>,
  );
});

adminBills.post('/:id', async (c) => {
  const id = intParam(c, 'id');
  const bill = id ? await getBill(c.env.DB, id) : null;
  if (!bill) return notFound(c);
  const f = await form(c);
  const action = field(f, 'action') || 'save';
  const back = `/admin/bills/${bill.id}`;

  const locationId = Number(field(f, 'location_id')) || null;
  const location = locationId ? await getLocation(c.env.DB, locationId) : null;
  if (locationId && !location) return redirect(c, back, { err: 'Unknown location' });

  const amountRaw = field(f, 'amount');
  const amount = parseAmount(amountRaw);
  if (amountRaw && amount == null) return redirect(c, back, { err: `Can't parse amount "${amountRaw}"` });

  const dates: Record<string, string | null> = {};
  for (const k of ['issue_date', 'due_date', 'period_start', 'period_end']) {
    const v = field(f, k);
    if (v && !isDate(v)) return redirect(c, back, { err: `Invalid ${k}` });
    dates[k] = v || null;
  }
  const currency = field(f, 'currency').toUpperCase() || null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) return redirect(c, back, { err: 'Currency must be a 3-letter code' });
  const utilityType = (UTILITY_TYPES as readonly string[]).includes(field(f, 'utility_type')) ? field(f, 'utility_type') : 'other';
  const contractNumber = normalizeContract(field(f, 'contract_number'));

  const status =
    action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'pending' ? 'pending_review' : bill.status;

  if (status === 'approved') {
    if (!location) return redirect(c, back, { err: 'Pick a location before approving' });
    if (amount == null) return redirect(c, back, { err: 'Enter the amount before approving' });
    if (currency && currency !== location.currency)
      return redirect(c, back, { err: `Currency ${currency} doesn't match the location currency ${location.currency}` });
  }

  const updated: Bill = {
    ...bill,
    status,
    location_id: locationId,
    contract_number: contractNumber,
    utility_type: utilityType as Bill['utility_type'],
    provider: nullIfEmpty(field(f, 'provider')),
    invoice_number: nullIfEmpty(field(f, 'invoice_number')),
    amount,
    currency: currency ?? location?.currency ?? null,
    issue_date: dates.issue_date ?? null,
    due_date: dates.due_date ?? null,
    period_start: dates.period_start ?? null,
    period_end: dates.period_end ?? null,
    notes: nullIfEmpty(field(f, 'notes')),
  };

  await run(
    c.env.DB,
    `UPDATE bills SET status = ?, location_id = ?, contract_number = ?, utility_type = ?, provider = ?, invoice_number = ?,
       amount = ?, currency = ?, issue_date = ?, due_date = ?, period_start = ?, period_end = ?, notes = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
    updated.status,
    updated.location_id,
    updated.contract_number,
    updated.utility_type,
    updated.provider,
    updated.invoice_number,
    updated.amount,
    updated.currency,
    updated.issue_date,
    updated.due_date,
    updated.period_start,
    updated.period_end,
    updated.notes,
    bill.id,
  );

  if (field(f, 'remember_contract') && contractNumber && locationId) {
    await run(
      c.env.DB,
      `INSERT INTO contracts (contract_number, location_id, utility_type, provider) VALUES (?, ?, ?, ?)
       ON CONFLICT (contract_number) DO UPDATE SET location_id = excluded.location_id`,
      contractNumber,
      locationId,
      utilityType,
      updated.provider,
    );
  }
  await syncBillLine(c.env.DB, updated);

  if (status === 'approved' && bill.status !== 'approved') {
    // Jump to the next bill waiting for review, if any.
    const next = await c.env.DB.prepare("SELECT id FROM bills WHERE status = 'pending_review' ORDER BY id LIMIT 1").first<{ id: number }>();
    if (next) return redirect(c, `/admin/bills/${next.id}`, { ok: `Bill #${bill.id} approved. Next in queue:` });
    return redirect(c, '/admin/bills', { ok: `Bill #${bill.id} approved. Review queue is empty.` });
  }
  return redirect(c, back, { ok: status === 'rejected' ? 'Rejected' : 'Saved' });
});

adminBills.post('/:id/payment', async (c) => {
  const id = intParam(c, 'id');
  const bill = id ? await getBill(c.env.DB, id) : null;
  if (!bill) return notFound(c);
  const back = `/admin/bills/${bill.id}`;
  const f = await form(c);
  const paidAt = field(f, 'paid_at');
  if (paidAt && !isDate(paidAt)) return redirect(c, back, { err: 'Invalid payment date' });

  let proofKey = bill.proof_key;
  const proof = file(f, 'proof');
  if (proof) {
    const ext = PROOF_TYPES[proof.type];
    if (!ext) return redirect(c, back, { err: 'Proof must be a PDF, PNG, JPEG or WebP' });
    if (proof.size > MAX_UPLOAD) return redirect(c, back, { err: 'File is larger than 20 MB' });
    proofKey = `proofs/${crypto.randomUUID()}.${ext}`;
    await c.env.FILES.put(proofKey, await proof.arrayBuffer(), { httpMetadata: { contentType: proof.type } });
    if (bill.proof_key) await c.env.FILES.delete(bill.proof_key);
  }
  await run(
    c.env.DB,
    "UPDATE bills SET paid_at = ?, proof_key = ?, updated_at = datetime('now') WHERE id = ?",
    paidAt || (proof ? new Date().toISOString().slice(0, 10) : null),
    proofKey,
    bill.id,
  );
  return redirect(c, back, { ok: 'Payment saved' });
});

adminBills.post('/:id/reextract', async (c) => {
  const id = intParam(c, 'id');
  const bill = id ? await getBill(c.env.DB, id) : null;
  if (!bill?.pdf_key) return notFound(c);
  try {
    await reextractBill(c.env, bill.id, bill.pdf_key);
  } catch (err) {
    return redirect(c, `/admin/bills/${bill.id}`, { err: `Extraction failed: ${String(err).slice(0, 200)}` });
  }
  const updated = await getBill(c.env.DB, bill.id);
  if (updated) await syncBillLine(c.env.DB, updated);
  return redirect(c, `/admin/bills/${bill.id}`, { ok: 'Fields re-extracted — review them.' });
});
