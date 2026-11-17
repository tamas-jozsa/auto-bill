-- auto-bill initial schema. All money columns are integer minor units (cents).

CREATE TABLE users (
  id         INTEGER PRIMARY KEY,
  email      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  name       TEXT,
  role       TEXT    NOT NULL DEFAULT 'tenant' CHECK (role IN ('admin', 'tenant')),
  banned     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE locations (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  address    TEXT,
  currency   TEXT NOT NULL DEFAULT 'EUR',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE location_users (
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (location_id, user_id)
);

-- Bill identity number (contract / customer number) -> location.
CREATE TABLE contracts (
  id              INTEGER PRIMARY KEY,
  contract_number TEXT    NOT NULL UNIQUE,
  location_id     INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  utility_type    TEXT CHECK (utility_type IN ('electricity', 'gas', 'water', 'internet', 'other')),
  provider        TEXT,
  note            TEXT
);

CREATE TABLE recurring_items (
  id          INTEGER PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('rent', 'condo_fee', 'adjustment')),
  description TEXT    NOT NULL,
  amount      INTEGER NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE bills (
  id              INTEGER PRIMARY KEY,
  status          TEXT NOT NULL DEFAULT 'pending_review'
                  CHECK (status IN ('pending_review', 'approved', 'rejected', 'duplicate')),
  source          TEXT NOT NULL CHECK (source IN ('email', 'upload')),
  location_id     INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  contract_number TEXT,
  utility_type    TEXT NOT NULL DEFAULT 'other'
                  CHECK (utility_type IN ('electricity', 'gas', 'water', 'internet', 'other')),
  provider        TEXT,
  invoice_number  TEXT,
  amount          INTEGER,
  currency        TEXT,
  issue_date      TEXT,
  due_date        TEXT,
  period_start    TEXT,
  period_end      TEXT,
  notes           TEXT,
  pdf_key         TEXT,
  raw_email_key   TEXT,
  email_from      TEXT,
  email_subject   TEXT,
  extraction      TEXT, -- raw AI output / error, for debugging
  paid_at         TEXT,
  proof_key       TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX bills_status ON bills (status);
CREATE INDEX bills_location_status ON bills (location_id, status);
CREATE INDEX bills_contract_invoice ON bills (contract_number, invoice_number);

CREATE TABLE statements (
  id          INTEGER PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  month       TEXT    NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  status      TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid')),
  sent_at     TEXT,
  paid_at     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (location_id, month)
);

-- Positive amount = tenant owes the landlord; negative = landlord owes the tenant.
CREATE TABLE line_items (
  id           INTEGER PRIMARY KEY,
  statement_id INTEGER NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  kind         TEXT    NOT NULL CHECK (kind IN ('utility', 'rent', 'condo_fee', 'adjustment')),
  description  TEXT    NOT NULL,
  amount       INTEGER NOT NULL,
  bill_id      INTEGER UNIQUE REFERENCES bills(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX line_items_statement ON line_items (statement_id);

CREATE TABLE comments (
  id           INTEGER PRIMARY KEY,
  statement_id INTEGER NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
  line_item_id INTEGER REFERENCES line_items(id) ON DELETE SET NULL,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body         TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX comments_statement ON comments (statement_id);
