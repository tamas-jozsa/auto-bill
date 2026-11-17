import type { Context } from 'hono';
import { first, userHasLocation } from '../db';
import type { AppEnv, Statement, User } from '../types';

export type Ctx = Context<AppEnv>;

export function flash(c: Ctx) {
  return { ok: c.req.query('ok'), err: c.req.query('err') };
}

/** Post/redirect/get with an optional flash message. */
export function redirect(c: Ctx, path: string, msg?: { ok?: string; err?: string }) {
  const url = new URL(path, c.req.url);
  if (msg?.ok) url.searchParams.set('ok', msg.ok);
  if (msg?.err) url.searchParams.set('err', msg.err);
  return c.redirect(url.pathname + url.search, 303);
}

export function intParam(c: Ctx, name: string): number | null {
  const n = Number(c.req.param(name));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export type Form = Record<string, string | File | (string | File)[]>;

export async function form(c: Ctx): Promise<Form> {
  return (await c.req.parseBody({ all: true })) as Form;
}

export function field(f: Form, name: string): string {
  const v = f[name];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' ? s.trim() : '';
}

export function file(f: Form, name: string): File | null {
  const v = f[name];
  const s = Array.isArray(v) ? v[0] : v;
  return s instanceof File && s.size > 0 ? s : null;
}

export async function canSeeStatement(db: D1Database, user: User, st: Statement): Promise<boolean> {
  if (user.role === 'admin') return true;
  return st.status !== 'draft' && (await userHasLocation(db, user.id, st.location_id));
}

/** Tenants may see a bill's files only once it is on a non-draft statement of their location. */
export async function canSeeBill(db: D1Database, user: User, billId: number): Promise<boolean> {
  if (user.role === 'admin') return true;
  const row = await first(
    db,
    `SELECT 1 FROM line_items li
     JOIN statements s ON s.id = li.statement_id
     JOIN location_users lu ON lu.location_id = s.location_id
     WHERE li.bill_id = ? AND lu.user_id = ? AND s.status != 'draft'`,
    billId,
    user.id,
  );
  return !!row;
}

export const notFound = (c: Ctx) => c.text('Not found', 404);
