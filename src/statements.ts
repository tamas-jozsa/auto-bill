import { all, first, run } from './db';
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
  if (!billable) {
    await run(db, 'DELETE FROM line_items WHERE id = ?', line.id);
    return;
  }
  await run(db, 'UPDATE line_items SET description = ?, amount = ? WHERE id = ?', utilityLineDescription(bill), bill.amount, line.id);
}

/** Cron: create this month's draft for every location. */
export async function createMonthlyDrafts(db: D1Database, month: string): Promise<number> {
  const locations = await all<{ id: number }>(db, 'SELECT id FROM locations');
  let created = 0;
  for (const l of locations) {
    const r = await ensureStatement(db, l.id, month);
    if (r.created) created++;
  }
  return created;
}
