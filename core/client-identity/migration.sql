-- Additive core migration; retain inquiries, consent and report history unchanged.
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_uuid TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL,
  email_normalized TEXT NOT NULL, identity_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS clients_email_search ON clients(email_normalized);
CREATE TABLE IF NOT EXISTS inquiry_client_links (
  inquiry_id INTEGER PRIMARY KEY REFERENCES inquiries(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  link_basis TEXT NOT NULL, review_required INTEGER NOT NULL DEFAULT 0 CHECK(review_required IN (0,1)),
  linked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS inquiry_client_lookup ON inquiry_client_links(client_id,inquiry_id);
CREATE TABLE IF NOT EXISTS client_identity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id INTEGER NOT NULL REFERENCES inquiries(id), client_id INTEGER NOT NULL REFERENCES clients(id),
  action TEXT NOT NULL, reason TEXT NOT NULL,
  candidate_client_ids_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
);
