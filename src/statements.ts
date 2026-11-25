import { all, first, run } from './db';
import { formatMoney } from './money';
import type { Bill } from './types';
import { UTILITY_LABELS } from './types';

export function utilityLineDescription(b: Pick<Bill, 'utility_type' | 'provider' | 'period_start' | 'period_end' | 'invoice_number'>): string {
  const parts: string[] = [UTILITY_LABELS[b.utility_type] ?? b.utility_type];
  if (b.provider) parts.push(b.provider);
  if (b.period_start && b.period_end) parts.push(`${b.period_start} – ${b.period_end}`);
  else if (b.invoice_number) parts.push(`#${b.invoice_number}`);
  return parts.join(' · ');
}

/**
 * Create the statement for (location, month) if it doesn't exist yet, seed it with the
 * location's active recurring items, then pull in all approved, not-yet-billed bills.
 * Idempotent: calling it again only pulls newly approved bills into a draft.
 */
export async function ensureStatement(db: D1Database, locationId: number, month: string): Promise<{ id: number; created: boolean }> {
  const inserted = await first<{ id: number }>(
    db,
    'INSERT INTO statements (location_id, month) VALUES (?, ?) ON CONFLICT (location_id, month) DO NOTHING RETURNING id',
    locationId,
    month,
  );
  if (inserted) {
    await run(
      db,
      `INSERT INTO line_items (statement_id, kind, description, amount)
       SELECT ?, kind, description, amount FROM recurring_items WHERE location_id = ? AND active = 1 ORDER BY id`,
      inserted.id,
      locationId,
    );
    await pullBills(db, inserted.id);
    return { id: inserted.id, created: true };
  }
  const existing = await first<{ id: number; status: string }>(
    db,
    'SELECT id, status FROM statements WHERE location_id = ? AND month = ?',
    locationId,
    month,
  );
  if (!existing) throw new Error('statement vanished');
  if (existing.status === 'draft') await pullBills(db, existing.id);
  return { id: existing.id, created: false };
}

/** Add every approved bill of the statement's location that is not on any statement yet. Returns count added. */
export async function pullBills(db: D1Database, statementId: number): Promise<number> {
  const st = await first<{ location_id: number; status: string; currency: string }>(
    db,
    'SELECT s.location_id, s.status, l.currency FROM statements s JOIN locations l ON l.id = s.location_id WHERE s.id = ?',
    statementId,
  );
  if (!st || st.status !== 'draft') return 0;
  const bills = await all<Bill>(
    db,
    `SELECT b.* FROM bills b
     WHERE b.location_id = ? AND b.status = 'approved' AND b.amount IS NOT NULL
       AND (b.currency IS NULL OR b.currency = ?)
       AND NOT EXISTS (SELECT 1 FROM line_items li WHERE li.bill_id = b.id)
     ORDER BY b.issue_date, b.id`,
    st.location_id,
    st.currency,
  );
  if (bills.length === 0) return 0;
  await db.batch(
    bills.map((b) =>
      db
        .prepare(
          `INSERT INTO line_items (statement_id, kind, description, amount, bill_id)
           VALUES (?, 'utility', ?, ?, ?) ON CONFLICT (bill_id) DO NOTHING`,
        )
        .bind(statementId, utilityLineDescription(b), b.amount, b.id),
    ),
  );
  await applyCredits(db, st.location_id);
  return bills.length;
}

/**
 * Keep a bill's line on a *draft* statement in sync after the bill was edited.
 * If the bill is no longer billable (not approved / no amount / moved location), remove the line.
 */
export async function syncBillLine(db: D1Database, bill: Bill): Promise<void> {
  const line = await first<{ id: number; location_id: number; status: string }>(
    db,
    `SELECT li.id, s.location_id, s.status FROM line_items li JOIN statements s ON s.id = li.statement_id
     WHERE li.bill_id = ?`,
    bill.id,
  );
  if (!line || line.status !== 'draft') return;
  const billable = bill.status === 'approved' && bill.amount != null && bill.location_id === line.location_id;
  if (!billable) await run(db, 'DELETE FROM line_items WHERE id = ?', line.id);
  else await run(db, 'UPDATE line_items SET description = ?, amount = ? WHERE id = ?', utilityLineDescription(bill), bill.amount, line.id);
  await applyCredits(db, line.location_id);
}

/** Bills from the same provider account share a credit balance. */
export function accountKey(b: Pick<Bill, 'contract_number' | 'utility_type' | 'provider'>): string {
  return b.contract_number ? `c:${b.contract_number}` : `t:${b.utility_type}:${(b.provider ?? '').toLowerCase()}`;
}

export interface CreditInput {
  key: string;
  amount: number; // the bill's real amount
  lineAmount: number; // what is currently charged on the statement
  locked: boolean; // statement already sent/paid: never change it
}

/**
 * Providers don't refund a negative bill; they keep it as credit on the account and the
 * landlord pays less on the following bills. So the tenant is charged max(0, bill − credit)
 * and the credit carries forward. Rows must be in billing order. Returns the charge per row.
 */
export function computeCharges(rows: CreditInput[]): { charge: number; creditUsed: number }[] {
  const credit = new Map<string, number>();
  return rows.map((r) => {
    const available = credit.get(r.key) ?? 0;
    const charge = r.locked ? r.lineAmount : Math.max(0, r.amount - available);
    // Credit left = what the tenant was charged above/below the real bill.
    credit.set(r.key, Math.max(0, available + charge - r.amount));
    return { charge, creditUsed: r.amount > 0 ? Math.max(0, r.amount - charge) : 0 };
  });
}

export function creditNote(amount: number, charge: number, creditUsed: number, currency: string): string {
  if (amount < 0) return ` · jóváírás ${formatMoney(-amount, currency)}, a következő számlákból levonva`;
  if (creditUsed > 0) return ` · számla ${formatMoney(amount, currency)}, korábbi jóváírás levonva: ${formatMoney(creditUsed, currency)}`;
  return '';
}

/** Recompute utility line amounts on the location's draft statements so credits carry forward. */
export async function applyCredits(db: D1Database, locationId: number): Promise<void> {
  const rows = await all<Bill & { line_id: number; line_amount: number; line_description: string; st_status: string; loc_currency: string }>(
    db,
    `SELECT b.*, li.id AS line_id, li.amount AS line_amount, li.description AS line_description,
            s.status AS st_status, l.currency AS loc_currency
     FROM line_items li JOIN bills b ON b.id = li.bill_id
       JOIN statements s ON s.id = li.statement_id JOIN locations l ON l.id = s.location_id
     WHERE s.location_id = ? AND li.kind = 'utility'
     ORDER BY s.month, b.issue_date, b.id`,
    locationId,
  );
  const charges = computeCharges(
    rows.map((r) => ({ key: accountKey(r), amount: r.amount ?? 0, lineAmount: r.line_amount, locked: r.st_status !== 'draft' })),
  );
  const updates = rows.flatMap((r, i) => {
    const { charge, creditUsed } = charges[i]!;
    if (r.st_status !== 'draft') return [];
    const description = utilityLineDescription(r) + creditNote(r.amount ?? 0, charge, creditUsed, r.loc_currency);
    if (charge === r.line_amount && description === r.line_description) return [];
    return [db.prepare('UPDATE line_items SET amount = ?, description = ? WHERE id = ?').bind(charge, description, r.line_id)];
  });
  if (updates.length) await db.batch(updates);
}

/** Cron (10th): create this month's draft for every location without an automatic schedule. */
export async function createMonthlyDrafts(db: D1Database, month: string): Promise<number> {
  const locations = await all<{ id: number }>(db, 'SELECT id FROM locations WHERE auto_day IS NULL');
  let created = 0;
  for (const l of locations) {
    const r = await ensureStatement(db, l.id, month);
    if (r.created) created++;
  }
  return created;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** True when the automatic statement for `today` (UTC) is due: day reached and not yet run this month. */
export function autoDue(loc: { auto_day: number | null; auto_last_month: string | null }, today: Date): boolean {
  if (!loc.auto_day) return false;
  return today.getUTCDate() >= loc.auto_day && loc.auto_last_month !== currentMonthOf(today);
}

const currentMonthOf = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;

/** Next run date (YYYY-MM-DD) for an enabled schedule. */
export function nextAutoRun(loc: { auto_day: number | null; auto_last_month: string | null }, today: Date): string | null {
  if (!loc.auto_day) return null;
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth(); // 0-based
  if (loc.auto_last_month === currentMonthOf(today)) {
    const next = new Date(Date.UTC(y, m + 1, loc.auto_day));
    return next.toISOString().slice(0, 10);
  }
  // Not run yet this month: on its day, or on the next cron run if the day already passed.
  return new Date(Date.UTC(y, m, Math.max(loc.auto_day, today.getUTCDate()))).toISOString().slice(0, 10);
}

/**
 * Month the schedule should treat as already done when it's (re)configured, so that turning it on
 * after this month's day doesn't immediately send a statement.
 */
export function initialAutoLastMonth(day: number, today: Date, previous: string | null): string | null {
  return today.getUTCDate() >= day ? currentMonthOf(today) : previous === currentMonthOf(today) ? previous : null;
}

/** Cron (daily): create and send the month's statement for every location whose day has come. */
export async function runAutoStatements(db: D1Database, today: Date): Promise<{ sent: number; skipped: number }> {
  const month = currentMonthOf(today);
  const locations = await all<{ id: number; auto_day: number | null; auto_last_month: string | null }>(
    db,
    'SELECT id, auto_day, auto_last_month FROM locations WHERE auto_day IS NOT NULL',
  );
  let sent = 0;
  let skipped = 0;
  for (const loc of locations.filter((l) => autoDue(l, today))) {
    const st = await ensureStatement(db, loc.id, month);
    const lines = await first<{ n: number }>(db, 'SELECT count(*) AS n FROM line_items WHERE statement_id = ?', st.id);
    if ((lines?.n ?? 0) > 0) {
      const res = await run(db, "UPDATE statements SET status = 'sent', sent_at = datetime('now') WHERE id = ? AND status = 'draft'", st.id);
      if (res.meta.changes) sent++;
    } else {
      skipped++; // nothing to bill: leave the empty draft for the admin
    }
    await run(db, 'UPDATE locations SET auto_last_month = ? WHERE id = ?', month, loc.id);
  }
  return { sent, skipped };
}
