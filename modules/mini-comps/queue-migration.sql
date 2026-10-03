-- Apply after migration.sql, only to MINI_COMP_DB.
CREATE TABLE IF NOT EXISTS mini_comp_tasks (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES mini_comp_jobs(id),
  result_json TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','processing','completed','failed')),
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT, created_at INTEGER NOT NULL, completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS mini_comp_task_recovery ON mini_comp_tasks(state,next_attempt_at,lease_until);
