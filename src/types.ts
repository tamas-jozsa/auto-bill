export const UTILITY_TYPES = ['electricity', 'gas', 'water', 'internet', 'other'] as const;
export type UtilityType = (typeof UTILITY_TYPES)[number];

export const BILL_STATUSES = ['pending_review', 'approved', 'rejected', 'duplicate'] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

export const STATEMENT_STATUSES = ['draft', 'sent', 'paid'] as const;
export type StatementStatus = (typeof STATEMENT_STATUSES)[number];

export const LINE_KINDS = ['utility', 'rent', 'condo_fee', 'adjustment'] as const;
export type LineKind = (typeof LINE_KINDS)[number];

export const RECURRING_KINDS = ['rent', 'condo_fee', 'adjustment'] as const;
export type RecurringKind = (typeof RECURRING_KINDS)[number];

export type Role = 'admin' | 'tenant';

export interface User {
  id: number;
  email: string;
  name: string | null;
  role: Role;
  banned: number;
  created_at: string;
}

export interface Location {
  id: number;
  name: string;
  address: string | null;
  currency: string;
  created_at: string;
}

export interface Contract {
  id: number;
  contract_number: string;
  location_id: number;
  utility_type: UtilityType | null;
  provider: string | null;
  note: string | null;
}

export interface RecurringItem {
  id: number;
  location_id: number;
  kind: RecurringKind;
  description: string;
  amount: number;
  active: number;
}

export interface Bill {
  id: number;
  status: BillStatus;
  source: 'email' | 'upload';
  location_id: number | null;
  contract_number: string | null;
  utility_type: UtilityType;
  provider: string | null;
  invoice_number: string | null;
  amount: number | null;
  currency: string | null;
  issue_date: string | null;
  due_date: string | null;
  period_start: string | null;
  period_end: string | null;
  notes: string | null;
  pdf_key: string | null;
  raw_email_key: string | null;
  email_from: string | null;
  email_subject: string | null;
  extraction: string | null;
  paid_at: string | null;
  proof_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface Statement {
  id: number;
  location_id: number;
  month: string;
  status: StatementStatus;
  sent_at: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface LineItem {
  id: number;
  statement_id: number;
  kind: LineKind;
  description: string;
  amount: number;
  bill_id: number | null;
  created_at: string;
}

export interface Comment {
  id: number;
  statement_id: number;
  line_item_id: number | null;
  user_id: number;
  body: string;
  created_at: string;
}

/** `user` is who the UI renders for; `realUser` is set when an admin previews as a tenant. */
export type AppEnv = { Bindings: Env; Variables: { user: User; realUser?: User } };

export const UTILITY_LABELS: Record<UtilityType, string> = {
  electricity: 'Áram',
  gas: 'Gáz',
  water: 'Víz',
  internet: 'Internet',
  other: 'Egyéb',
};

export const LINE_KIND_LABELS: Record<LineKind, string> = {
  utility: 'Rezsi',
  rent: 'Bérleti díj',
  condo_fee: 'Közös költség',
  adjustment: 'Korrekció',
};

export const STATUS_LABELS: Record<string, string> = {
  pending_review: 'Ellenőrzésre vár',
  approved: 'Jóváhagyva',
  rejected: 'Elutasítva',
  duplicate: 'Duplikált',
  draft: 'Piszkozat',
  sent: 'Kiküldve',
  paid: 'Fizetve',
};

export const ROLE_LABELS: Record<string, string> = { admin: 'Admin', tenant: 'Bérlő' };
