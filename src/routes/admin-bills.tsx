import { Hono } from 'hono';
import { getBill, getLocation, listBills, listLocations, run, statementOfBill } from '../db';
import { ingestPdf, readStoredEmail, reextractBill } from '../intake';
import { minorToInput, parseAmount } from '../money';
import { syncBillLine } from '../statements';
import { BILL_STATUSES, STATUS_LABELS, UTILITY_LABELS, UTILITY_TYPES, type AppEnv, type Bill } from '../types';
import { Badge, Empty, Icon, KindIcon, Layout, Money, monthLabel, Options, PostButton, TableWrap } from '../ui/layout';
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
    <Layout title="Számlák" user={c.get('user')} flash={flash(c)}>
      <div class="page-head">
        <h1>Számlák</h1>
        <a class="btn primary" href="/admin/bills/new">
          <Icon name="upload" size={16} /> PDF feltöltése
        </a>
      </div>
      <nav class="seg" style="margin-bottom:18px">
        {[...BILL_STATUSES, 'all'].map((s) => (
          <a href={`/admin/bills?status=${s}`} aria-current={s === status ? 'page' : undefined}>
            {s === 'all' ? 'Összes' : STATUS_LABELS[s]}
          </a>
        ))}
      </nav>
      <BillTable bills={bills} />
    </Layout>,
  );
});

export function BillTable(p: { bills: (Bill & { location_name: string | null; statement_id: number | null; statement_month: string | null })[] }) {
  if (p.bills.length === 0)
    return (
      <div class="card">
        <Empty icon="checkCircle" title="Nincs itt semmi">
          <p>Minden rendben, ebben a listában nincs számla.</p>
        </Empty>
      </div>
    );
  return (
    <TableWrap>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Állapot</th>
          <th>Típus / szolgáltató</th>
          <th>Ingatlan</th>
          <th>Azonosító</th>
          <th>Határidő</th>
          <th class="num">Összeg</th>
          <th>Elszámolás</th>
        </tr>
      </thead>
      <tbody>
        {p.bills.map((b) => (
          <tr>
            <td>
              <a href={`/admin/bills/${b.id}`}>
                <b>#{b.id}</b>
              </a>
            </td>
            <td>
              <Badge status={b.status} />
            </td>
            <td>
              <div class="cell">
                <KindIcon kind={b.utility_type} small />
                <div>
                  {UTILITY_LABELS[b.utility_type]}
                  <div class="muted">{b.provider ?? b.email_subject ?? ''}</div>
                </div>
              </div>
            </td>
            <td>{b.location_name ?? <span class="badge rejected">nincs hozzárendelve</span>}</td>
            <td>{b.contract_number ?? '—'}</td>
            <td>{b.due_date ?? '—'}</td>
            <td class="num">
              <Money amount={b.amount} currency={b.currency} />
            </td>
            <td>{b.statement_id ? <a href={`/statements/${b.statement_id}`}>{b.statement_month && monthLabel(b.statement_month)}</a> : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </TableWrap>
  );
}

adminBills.get('/new', (c) =>
  c.html(
    <Layout title="Számla feltöltése" user={c.get('user')} flash={flash(c)}>
      <a class="back" href="/admin/bills">
        <Icon name="arrowLeft" size={16} /> Számlák
      </a>
      <h1>Számla PDF feltöltése</h1>
      <form method="post" action="/admin/bills" enctype="multipart/form-data" class="card" style="max-width:640px">
        <div class="empty" style="padding:12px 0 18px">
          <div class="ico">
            <Icon name="upload" size={28} />
          </div>
          <b>PDF kiválasztása</b>
          <p>A PDF ugyanúgy feldolgozásra kerül, mint az e-mailben érkező számlák, és az ellenőrzési sorba kerül.</p>
        </div>
        <input type="file" name="file" accept="application/pdf" required />
        <div class="actions">
          <button class="primary">
            <Icon name="sparkle" size={16} /> Feltöltés és feldolgozás
          </button>
        </div>
      </form>
    </Layout>,
  ),
);

adminBills.post('/', async (c) => {
  const f = await form(c);
  const pdf = file(f, 'file');
  if (!pdf) return redirect(c, '/admin/bills/new', { err: 'Válasszon PDF fájlt' });
  if (pdf.size > MAX_UPLOAD) return redirect(c, '/admin/bills/new', { err: 'A fájl nagyobb 20 MB-nál' });
  const bytes = await pdf.arrayBuffer();
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') return redirect(c, '/admin/bills/new', { err: 'Ez nem PDF fájl' });
  const id = await ingestPdf(c.env, { bytes, filename: pdf.name || 'upload.pdf', source: 'upload' });
  return redirect(c, `/admin/bills/${id}`, { ok: 'Feltöltve. Ellenőrizze a kinyert adatokat.' });
});

adminBills.get('/:id', async (c) => {
  const id = intParam(c, 'id');
  const bill = id ? await getBill(c.env.DB, id) : null;
  if (!bill) return notFound(c);
  const [locations, statement, email] = await Promise.all([
    listLocations(c.env.DB),
    statementOfBill(c.env.DB, bill.id),
    !bill.pdf_key && bill.raw_email_key ? readStoredEmail(c.env, bill.raw_email_key).catch(() => null) : null,
  ]);
  const location = locations.find((l) => l.id === bill.location_id);
  const currencyMismatch = location && bill.currency && bill.currency !== location.currency;
  let extraction: string | null = null;
  try {
    extraction = bill.extraction ? JSON.stringify(JSON.parse(bill.extraction), null, 2) : null;
  } catch {
    extraction = bill.extraction;
  }

  return c.html(
    <Layout title={`Számla ${bill.id}`} user={c.get('user')} flash={flash(c)}>
      <a class="back" href="/admin/bills">
        <Icon name="arrowLeft" size={16} /> Számlák
      </a>
      <div class="page-head">
        <div style="display:flex;gap:14px;align-items:center">
          <KindIcon kind={bill.utility_type} large />
          <div>
            <div class="eyebrow">
              {UTILITY_LABELS[bill.utility_type]}
              {bill.provider ? ` · ${bill.provider}` : ''}
            </div>
            <h1>
              Számla #{bill.id} <Badge status={bill.status} />
            </h1>
          </div>
        </div>
        <div class="total">
          <Money amount={bill.amount} currency={bill.currency} />
        </div>
      </div>
      <div class="split">
        <div>
          {statement && (
            <div class="flash ok">
              Elszámolás: <a href={`/statements/${statement.id}`}>{monthLabel(statement.month)}</a> ({STATUS_LABELS[statement.status]})
              {statement.status !== 'draft' && ' — az itteni módosítások már nem változtatják meg.'}
            </div>
          )}
          {!bill.location_id && bill.contract_number && (
            <div class="flash err">
              Ismeretlen azonosító: <b>{bill.contract_number}</b>. Válasszon ingatlant lent — a rendszer megjegyzi a következő számlákhoz.
            </div>
          )}
          {currencyMismatch && (
            <div class="flash err">
              A számla pénzneme ({bill.currency}) eltér az ingatlanétól ({location.currency}), így nem kerülhet elszámolásba.
            </div>
          )}
          <form method="post" action={`/admin/bills/${bill.id}`} class="card">
            <label>Ingatlan</label>
            <select name="location_id">
              <option value="">— nincs hozzárendelve —</option>
              {locations.map((l) => (
                <option value={String(l.id)} selected={l.id === bill.location_id}>
                  {l.name}
                </option>
              ))}
            </select>
            <label>
              <input type="checkbox" name="remember_contract" value="1" checked={!bill.location_id} /> Az azonosító megjegyzése
              a kiválasztott ingatlanhoz
            </label>
            <div class="row">
              <div>
                <label>Felhasználó azonosító / szerződésszám</label>
                <input name="contract_number" value={bill.contract_number ?? ''} />
              </div>
              <div>
                <label>Típus</label>
                <select name="utility_type">
                  <Options values={UTILITY_TYPES} selected={bill.utility_type} labels={UTILITY_LABELS} />
                </select>
              </div>
            </div>
            <div class="row">
              <div>
                <label>Szolgáltató</label>
                <input name="provider" value={bill.provider ?? ''} />
              </div>
              <div>
                <label>Számlaszám</label>
                <input name="invoice_number" value={bill.invoice_number ?? ''} />
              </div>
            </div>
            <div class="row">
              <div>
                <label>Fizetendő összeg</label>
                <input name="amount" value={minorToInput(bill.amount)} placeholder="18.10" />
              </div>
              <div>
                <label>Pénznem</label>
                <input name="currency" value={bill.currency ?? location?.currency ?? ''} maxlength={3} />
              </div>
            </div>
            <div class="row">
              <div>
                <label>Kiállítás dátuma</label>
                <input type="date" name="issue_date" value={bill.issue_date ?? ''} />
              </div>
              <div>
                <label>Fizetési határidő</label>
                <input type="date" name="due_date" value={bill.due_date ?? ''} />
              </div>
            </div>
            <div class="row">
              <div>
                <label>Időszak kezdete</label>
                <input type="date" name="period_start" value={bill.period_start ?? ''} />
              </div>
              <div>
                <label>Időszak vége</label>
                <input type="date" name="period_end" value={bill.period_end ?? ''} />
              </div>
            </div>
            <label>Megjegyzés</label>
            <textarea name="notes" rows={2}>
              {bill.notes ?? ''}
            </textarea>
            <div class="actions">
              <button name="action" value="save">Mentés</button>
              <button name="action" value="approve" class="primary">
                Mentés és jóváhagyás
              </button>
              <button name="action" value="reject" class="danger">
                Elutasítás
              </button>
              {bill.status !== 'pending_review' && <button name="action" value="pending">Vissza ellenőrzésre</button>}
            </div>
          </form>

          <form method="post" action={`/admin/bills/${bill.id}/payment`} enctype="multipart/form-data" class="card">
            <h2 style="margin-top:0">Befizetés</h2>
            <label>Fizetés dátuma</label>
            <input type="date" name="paid_at" value={bill.paid_at ?? ''} />
            <label>Befizetési igazolás (PDF vagy kép){bill.proof_key && ' — lecseréli a jelenlegit'}</label>
            <input type="file" name="proof" accept="application/pdf,image/png,image/jpeg,image/webp" />
            {bill.proof_key && (
              <p>
                <a href={`/files/bills/${bill.id}/proof`} target="_blank">
                  Jelenlegi igazolás
                </a>
              </p>
            )}
            <div class="actions">
              <button class="primary">Befizetés mentése</button>
            </div>
          </form>

          <div class="card">
            <div class="muted">
              Forrás: {bill.source === 'email' ? 'e-mail' : 'feltöltés'}
              {bill.email_from && ` · feladó: ${bill.email_from}`}
              {bill.email_subject && ` · “${bill.email_subject}”`} · érkezett: {bill.created_at}
            </div>
            <div class="actions">
              {bill.raw_email_key && (
                <a class="btn" href={`/files/bills/${bill.id}/raw`}>
                  Eredeti e-mail letöltése
                </a>
              )}
              {(bill.pdf_key || bill.raw_email_key) && (
                <PostButton action={`/admin/bills/${bill.id}/reextract`} label="Adatkinyerés újrafuttatása" confirm="Felülírja a mezőket egy új AI-feldolgozással?" />
              )}
            </div>
            {extraction && (
              <details>
                <summary class="muted">AI kimenet</summary>
                <pre style="white-space:pre-wrap;font-size:12px">{extraction}</pre>
              </details>
            )}
          </div>
        </div>
        <div>
          {bill.pdf_key ? (
            <iframe class="pdf" src={`/files/bills/${bill.id}/pdf`} title="Számla PDF"></iframe>
          ) : (
            <>
              <form method="post" action={`/admin/bills/${bill.id}/pdf`} enctype="multipart/form-data" class="card">
                <h3>
                  <Icon name="file" size={16} /> Ehhez a számlához nincs PDF
                </h3>
                <p class="muted">Ha letöltötte a számlát a szolgáltató oldaláról, csatolja itt. A bérlő is látni fogja. A mezők nem változnak.</p>
                <div class="row">
                  <div>
                    <input type="file" name="file" accept="application/pdf" required />
                  </div>
                  <div class="shrink">
                    <button class="primary">
                      <Icon name="upload" size={16} /> PDF csatolása
                    </button>
                  </div>
                </div>
              </form>
              {email && (
                <div class="card">
                  <h3>
                    <Icon name="inbox" size={16} /> Az e-mail szövege
                  </h3>
                  <div class="muted" style="margin-bottom:10px">
                    {email.from} · {email.subject}
                  </div>
                  <pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.55 inherit;margin:0">{email.text.slice(0, 20000)}</pre>
                </div>
              )}
            </>
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
  if (locationId && !location) return redirect(c, back, { err: 'Ismeretlen ingatlan' });

  const amountRaw = field(f, 'amount');
  const amount = parseAmount(amountRaw);
  if (amountRaw && amount == null) return redirect(c, back, { err: `Érvénytelen összeg: "${amountRaw}"` });

  const dates: Record<string, string | null> = {};
  for (const k of ['issue_date', 'due_date', 'period_start', 'period_end']) {
    const v = field(f, k);
    if (v && !isDate(v)) return redirect(c, back, { err: 'Érvénytelen dátum' });
    dates[k] = v || null;
  }
  const currency = field(f, 'currency').toUpperCase() || null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) return redirect(c, back, { err: 'A pénznem 3 betűs kód legyen (pl. HUF, EUR)' });
  const utilityType = (UTILITY_TYPES as readonly string[]).includes(field(f, 'utility_type')) ? field(f, 'utility_type') : 'other';
  const contractNumber = normalizeContract(field(f, 'contract_number'));

  const status =
    action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'pending' ? 'pending_review' : bill.status;

  if (status === 'approved') {
    if (!location) return redirect(c, back, { err: 'Jóváhagyás előtt válasszon ingatlant' });
    if (amount == null) return redirect(c, back, { err: 'Jóváhagyás előtt adja meg az összeget' });
    if (currency && currency !== location.currency)
      return redirect(c, back, { err: `A pénznem (${currency}) nem egyezik az ingatlanéval (${location.currency})` });
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
    if (next) return redirect(c, `/admin/bills/${next.id}`, { ok: `A(z) #${bill.id} számla jóváhagyva. Következő a sorban:` });
    return redirect(c, '/admin/bills', { ok: `A(z) #${bill.id} számla jóváhagyva. Az ellenőrzési sor üres.` });
  }
  return redirect(c, back, { ok: status === 'rejected' ? 'Elutasítva' : 'Mentve' });
});

adminBills.post('/:id/payment', async (c) => {
  const id = intParam(c, 'id');
  const bill = id ? await getBill(c.env.DB, id) : null;
  if (!bill) return notFound(c);
  const back = `/admin/bills/${bill.id}`;
  const f = await form(c);
  const paidAt = field(f, 'paid_at');
  if (paidAt && !isDate(paidAt)) return redirect(c, back, { err: 'Érvénytelen fizetési dátum' });

  let proofKey = bill.proof_key;
  const proof = file(f, 'proof');
  if (proof) {
    const ext = PROOF_TYPES[proof.type];
    if (!ext) return redirect(c, back, { err: 'Az igazolás PDF, PNG, JPEG vagy WebP lehet' });
    if (proof.size > MAX_UPLOAD) return redirect(c, back, { err: 'A fájl nagyobb 20 MB-nál' });
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
  return redirect(c, back, { ok: 'Befizetés mentve' });
});

adminBills.post('/:id/reextract', async (c) => {
  const id = intParam(c, 'id');
  const bill = id ? await getBill(c.env.DB, id) : null;
  if (!bill || (!bill.pdf_key && !bill.raw_email_key)) return notFound(c);
  try {
    await reextractBill(c.env, bill);
  } catch (err) {
    return redirect(c, `/admin/bills/${bill.id}`, { err: `Az adatkinyerés nem sikerült: ${String(err).slice(0, 200)}` });
  }
  const updated = await getBill(c.env.DB, bill.id);
  if (updated) await syncBillLine(c.env.DB, updated);
  return redirect(c, `/admin/bills/${bill.id}`, { ok: 'Mezők újra kinyerve — ellenőrizze őket.' });
});

adminBills.post('/:id/pdf', async (c) => {
  const id = intParam(c, 'id');
  const bill = id ? await getBill(c.env.DB, id) : null;
  if (!bill) return notFound(c);
  const back = `/admin/bills/${bill.id}`;
  const pdf = file(await form(c), 'file');
  if (!pdf) return redirect(c, back, { err: 'Válasszon PDF fájlt' });
  if (pdf.size > MAX_UPLOAD) return redirect(c, back, { err: 'A fájl nagyobb 20 MB-nál' });
  const bytes = await pdf.arrayBuffer();
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') return redirect(c, back, { err: 'Ez nem PDF fájl' });
  const key = `bills/${crypto.randomUUID()}.pdf`;
  await c.env.FILES.put(key, bytes, {
    httpMetadata: { contentType: 'application/pdf' },
    customMetadata: { filename: (pdf.name || 'bill.pdf').slice(0, 200) },
  });
  await run(c.env.DB, "UPDATE bills SET pdf_key = ?, updated_at = datetime('now') WHERE id = ?", key, bill.id);
  if (bill.pdf_key) await c.env.FILES.delete(bill.pdf_key);
  return redirect(c, back, { ok: 'PDF csatolva' });
});
