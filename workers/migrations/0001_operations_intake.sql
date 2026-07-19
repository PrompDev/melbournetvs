-- Melbourne TVs secure operations store.
-- This schema stores lead and mail records only. It does not configure or
-- authorize email delivery.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  identity_key TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  postcode TEXT NOT NULL DEFAULT '',
  suburb TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  received_day TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  postcode TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  tv_size TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  suburb TEXT NOT NULL DEFAULT '',
  service TEXT NOT NULL DEFAULT '',
  wall_type TEXT NOT NULL DEFAULT '',
  preferred_date TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  page_url TEXT NOT NULL DEFAULT '',
  campaign TEXT NOT NULL DEFAULT '',
  tracking_json TEXT NOT NULL DEFAULT '{}',
  details_json TEXT NOT NULL DEFAULT '{}',
  marketing_consent INTEGER NOT NULL DEFAULT 0 CHECK (marketing_consent IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_leads_received_day ON leads(received_day);
CREATE INDEX IF NOT EXISTS idx_leads_received_at ON leads(received_at);
CREATE INDEX IF NOT EXISTS idx_leads_contact_id ON leads(contact_id);
CREATE INDEX IF NOT EXISTS idx_leads_status_received_at ON leads(status, received_at);

CREATE TABLE IF NOT EXISTS lead_uploads (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lead_uploads_lead_id ON lead_uploads(lead_id);

CREATE TABLE IF NOT EXISTS intake_events (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL,
  request_id TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_intake_events_lead_id ON intake_events(lead_id);
CREATE INDEX IF NOT EXISTS idx_intake_events_occurred_at ON intake_events(occurred_at);

-- Replay/idempotency records for authenticated Apps Script sync batches.
-- request_hash is a SHA-256 digest of the signed body, not the body itself.
CREATE TABLE IF NOT EXISTS sync_requests (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  accepted_count INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_requests_expires_at ON sync_requests(expires_at);

-- Mailbox foundation only. There is intentionally no sending queue, mail
-- binding, route, or delivery code in this migration.
CREATE TABLE IF NOT EXISTS mail_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL DEFAULT '',
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_address TEXT NOT NULL DEFAULT '',
  to_address TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  plain_text TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'stored' CHECK (status IN ('stored', 'archived', 'blocked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mail_messages_thread_id ON mail_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_mail_messages_received_at ON mail_messages(received_at);
CREATE INDEX IF NOT EXISTS idx_mail_messages_lead_id ON mail_messages(lead_id);

CREATE TABLE IF NOT EXISTS mail_drafts (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  to_address TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  plain_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_mail_drafts_status_updated_at ON mail_drafts(status, updated_at);

CREATE TABLE IF NOT EXISTS mail_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT REFERENCES mail_messages(id) ON DELETE CASCADE,
  draft_id TEXT REFERENCES mail_drafts(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (
    (message_id IS NOT NULL AND draft_id IS NULL)
    OR (message_id IS NULL AND draft_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_mail_attachments_message_id ON mail_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_mail_attachments_draft_id ON mail_attachments(draft_id);
