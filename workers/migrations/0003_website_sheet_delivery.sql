-- Retry-safe delivery ledger for private website-lead copies sent to the
-- Melbourne TVs Google Sheet. Customer values stay in the canonical leads
-- table; this queue stores only delivery state and a lead reference.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS lead_deliveries (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  destination TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'delivered', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT NOT NULL,
  last_attempt_at TEXT NOT NULL DEFAULT '',
  delivered_at TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (lead_id, destination)
);

CREATE INDEX IF NOT EXISTS idx_lead_deliveries_pending
  ON lead_deliveries(destination, status, next_attempt_at);
