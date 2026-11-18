import type { Bill, Contract, LineItem, Location, RecurringItem, Statement, User } from './types';

export async function all<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const { results } = await db.prepare(sql).bind(...params).all<T>();
  return results;
}

export async function first<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return db.prepare(sql).bind(...params).first<T>();
}

export async function run(db: D1Database, sql: string, ...params: unknown[]): Promise<D1Result> {
  return db.prepare(sql).bind(...params).run();
}

// --- users -----------------------------------------------------------------

export const getUserByEmail = (db: D1Database, email: string) =>
  first<User>(db, 'SELECT * FROM users WHERE email = ?', email.toLowerCase());

export const getUser = (db: D1Database, id: number) => first<User>(db, 'SELECT * FROM users WHERE id = ?', id);

export const listUsers = (db: D1Database) => all<User>(db, 'SELECT * FROM users ORDER BY role, email');

// --- locations -------------------------------------------------------------

export const listLocations = (db: D1Database) => all<Location>(db, 'SELECT * FROM locations ORDER BY name');

export const getLocation = (db: D1Database, id: number) =>
  first<Location>(db, 'SELECT * FROM locations WHERE id = ?', id);

export const locationsForUser = (db: D1Database, userId: number) =>
  all<Location>(
    db,
    `SELECT l.* FROM locations l JOIN location_users lu ON lu.location_id = l.id
     WHERE lu.user_id = ? ORDER BY l.name`,
    userId,
  );

export const tenantsOfLocation = (db: D1Database, locationId: number) =>
  all<User>(
    db,
    `SELECT u.* FROM users u JOIN location_users lu ON lu.user_id = u.id
     WHERE lu.location_id = ? ORDER BY u.email`,
    locationId,
  );

export async function userHasLocation(db: D1Database, userId: number, locationId: number): Promise<boolean> {
  const row = await first(db, 'SELECT 1 FROM location_users WHERE user_id = ? AND location_id = ?', userId, locationId);
  return !!row;
}

export const contractsOfLocation = (db: D1Database, locationId: number) =>
  all<Contract>(db, 'SELECT * FROM contracts WHERE location_id = ? ORDER BY contract_number', locationId);

export const getContractByNumber = (db: D1Database, contractNumber: string) =>
  first<Contract>(db, 'SELECT * FROM contracts WHERE contract_number = ?', contractNumber);

export const recurringOfLocation = (db: D1Database, locationId: number) =>
  all<RecurringItem>(db, 'SELECT * FROM recurring_items WHERE location_id = ? ORDER BY kind, id', locationId);

// --- bills -----------------------------------------------------------------

export const getBill = (db: D1Database, id: number) => first<Bill>(db, 'SELECT * FROM bills WHERE id = ?', id);

export type BillRow = Bill & { location_name: string | null; statement_id: number | null; statement_month: string | null };

export function listBills(db: D1Database, filter: { status?: string; locationId?: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.status) {
    where.push('b.status = ?');
    params.push(filter.status);
  }
  if (filter.locationId) {
    where.push('b.location_id = ?');
    params.push(filter.locationId);
  }
  return all<BillRow>(
    db,
    `SELECT b.*, l.name AS location_name, s.id AS statement_id, s.month AS statement_month
     FROM bills b
     LEFT JOIN locations l ON l.id = b.location_id
     LEFT JOIN line_items li ON li.bill_id = b.id
     LEFT JOIN statements s ON s.id = li.statement_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY b.created_at DESC, b.id DESC LIMIT 200`,
    ...params,
  );
}

export async function countBills(db: D1Database, status: string): Promise<number> {
  const row = await first<{ n: number }>(db, 'SELECT count(*) AS n FROM bills WHERE status = ?', status);
  return row?.n ?? 0;
}

/** The statement a bill is on, if any. */
export const statementOfBill = (db: D1Database, billId: number) =>
  first<Statement>(
    db,
    'SELECT s.* FROM statements s JOIN line_items li ON li.statement_id = s.id WHERE li.bill_id = ?',
    billId,
  );

// --- statements ------------------------------------------------------------

export const getStatement = (db: D1Database, id: number) =>
  first<Statement>(db, 'SELECT * FROM statements WHERE id = ?', id);

export type StatementRow = Statement & { location_name: string; currency: string; total: number; lines: number };

const STATEMENT_ROW_SQL = `
  SELECT s.*, l.name AS location_name, l.currency AS currency,
         COALESCE((SELECT sum(amount) FROM line_items WHERE statement_id = s.id), 0) AS total,
         (SELECT count(*) FROM line_items WHERE statement_id = s.id) AS lines
  FROM statements s JOIN locations l ON l.id = s.location_id`;

export const listStatementsOfLocation = (db: D1Database, locationId: number, includeDrafts: boolean) =>
  all<StatementRow>(
    db,
    `${STATEMENT_ROW_SQL} WHERE s.location_id = ? ${includeDrafts ? '' : "AND s.status != 'draft'"}
     ORDER BY s.month DESC`,
    locationId,
  );

export const listRecentStatements = (db: D1Database, limit = 10) =>
  all<StatementRow>(db, `${STATEMENT_ROW_SQL} ORDER BY s.month DESC, l.name LIMIT ?`, limit);

export const getStatementRow = (db: D1Database, id: number) =>
  first<StatementRow>(db, `${STATEMENT_ROW_SQL} WHERE s.id = ?`, id);

export type LineRow = LineItem & {
  bill_pdf: string | null;
  bill_proof: string | null;
  bill_paid_at: string | null;
  bill_due_date: string | null;
  bill_utility: string | null;
};

export const linesOfStatement = (db: D1Database, statementId: number) =>
  all<LineRow>(
    db,
    `SELECT li.*, b.pdf_key AS bill_pdf, b.proof_key AS bill_proof, b.paid_at AS bill_paid_at,
            b.due_date AS bill_due_date, b.utility_type AS bill_utility
     FROM line_items li LEFT JOIN bills b ON b.id = li.bill_id
     WHERE li.statement_id = ?
     ORDER BY CASE li.kind WHEN 'rent' THEN 0 WHEN 'condo_fee' THEN 1 WHEN 'utility' THEN 2 ELSE 3 END, li.id`,
    statementId,
  );

export type CommentRow = { id: number; body: string; created_at: string; line_item_id: number | null; email: string; name: string | null; role: string };

export const commentsOfStatement = (db: D1Database, statementId: number) =>
  all<CommentRow>(
    db,
    `SELECT c.id, c.body, c.created_at, c.line_item_id, u.email, u.name, u.role
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.statement_id = ? ORDER BY c.created_at, c.id`,
    statementId,
  );
