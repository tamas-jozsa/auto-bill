-- Per-property automatic monthly statements: on day `auto_day` the month's statement is
-- created and marked as sent. `auto_last_month` (YYYY-MM) prevents running twice a month.
ALTER TABLE locations ADD COLUMN auto_day INTEGER CHECK (auto_day BETWEEN 1 AND 28);
ALTER TABLE locations ADD COLUMN auto_last_month TEXT;
