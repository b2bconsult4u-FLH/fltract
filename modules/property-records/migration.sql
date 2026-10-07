-- Apply to optional PROPERTY_DB, not the core intake schema.
CREATE TABLE IF NOT EXISTS property_record_sources (
  id TEXT PRIMARY KEY,
  county TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  published_at TEXT,
  expected_records INTEGER NOT NULL CHECK (expected_records > 0),
  complete INTEGER NOT NULL CHECK (complete IN (0,1)) DEFAULT 0
);
CREATE TABLE IF NOT EXISTS property_record_cache (
  source_id TEXT NOT NULL REFERENCES property_record_sources(id),
  county TEXT NOT NULL,
  parcel_key TEXT NOT NULL,
  parcel_id TEXT NOT NULL,
  address_key TEXT NOT NULL,
  record_json TEXT NOT NULL,
  PRIMARY KEY (source_id, county, parcel_id)
);
CREATE INDEX IF NOT EXISTS property_record_parcel_lookup ON property_record_cache(county, parcel_key);
CREATE INDEX IF NOT EXISTS property_record_address_lookup ON property_record_cache(county, address_key);
CREATE TABLE IF NOT EXISTS property_record_jobs (
  id TEXT PRIMARY KEY,
  inquiry_id INTEGER NOT NULL,
  property_key TEXT NOT NULL,
  query_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(inquiry_id, property_key)
);
CREATE TABLE IF NOT EXISTS property_record_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES property_record_jobs(id),
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  result_json TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS property_record_job_events ON property_record_events(job_id, id);
