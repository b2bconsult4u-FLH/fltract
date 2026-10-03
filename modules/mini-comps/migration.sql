-- Optional MINI_COMP_DB only. No core CRM or Property Records tables are altered.
CREATE TABLE IF NOT EXISTS mini_comp_sources (
  id TEXT PRIMARY KEY, county TEXT NOT NULL, source_json TEXT NOT NULL,
  published_at TEXT NOT NULL, expected_profiles INTEGER NOT NULL, expected_sales INTEGER NOT NULL,
  complete INTEGER NOT NULL DEFAULT 0 CHECK(complete IN (0,1))
);
CREATE TABLE IF NOT EXISTS mini_comp_profiles (
  source_id TEXT NOT NULL REFERENCES mini_comp_sources(id), county TEXT NOT NULL,
  parcel_key TEXT NOT NULL, profile_json TEXT NOT NULL,
  PRIMARY KEY(source_id, county, parcel_key)
);
CREATE TABLE IF NOT EXISTS mini_comp_sales (
  source_id TEXT NOT NULL REFERENCES mini_comp_sources(id), id TEXT NOT NULL, county TEXT NOT NULL,
  property_use_code TEXT NOT NULL, improvement_type TEXT NOT NULL,
  latitude REAL NOT NULL, longitude REAL NOT NULL, sale_date TEXT NOT NULL, sale_json TEXT NOT NULL,
  PRIMARY KEY(source_id, id)
);
CREATE INDEX IF NOT EXISTS mini_comp_sale_search ON mini_comp_sales(source_id,county,property_use_code,improvement_type,sale_date,latitude,longitude);
CREATE TABLE IF NOT EXISTS mini_comp_jobs (
  id TEXT PRIMARY KEY, inquiry_id INTEGER NOT NULL, property_key TEXT NOT NULL,
  created_at TEXT NOT NULL, UNIQUE(inquiry_id,property_key)
);
CREATE TABLE IF NOT EXISTS mini_comp_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES mini_comp_jobs(id),
  status TEXT NOT NULL, reason TEXT NOT NULL, report_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mini_comp_report_job ON mini_comp_reports(job_id,id);
