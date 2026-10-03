-- Dedicated SECURITY_DB; do not apply to the live CRM database.
PRAGMA foreign_keys=ON;
CREATE TABLE businesses(id TEXT PRIMARY KEY,name TEXT NOT NULL);
CREATE TABLE users(id TEXT PRIMARY KEY,issuer TEXT NOT NULL,subject TEXT NOT NULL,UNIQUE(issuer,subject));
CREATE TABLE memberships(business_id TEXT NOT NULL,user_id TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),PRIMARY KEY(business_id,user_id),FOREIGN KEY(business_id) REFERENCES businesses(id),FOREIGN KEY(user_id) REFERENCES users(id));
CREATE TABLE roles(business_id TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,PRIMARY KEY(business_id,id),FOREIGN KEY(business_id) REFERENCES businesses(id));
CREATE TABLE role_grants(business_id TEXT NOT NULL,role_id TEXT NOT NULL,permission TEXT NOT NULL,scope TEXT NOT NULL CHECK(scope IN('business','team','assigned')),PRIMARY KEY(business_id,role_id,permission),FOREIGN KEY(business_id,role_id) REFERENCES roles(business_id,id));
CREATE TABLE member_roles(business_id TEXT NOT NULL,user_id TEXT NOT NULL,role_id TEXT NOT NULL,PRIMARY KEY(business_id,user_id,role_id),FOREIGN KEY(business_id,user_id) REFERENCES memberships(business_id,user_id),FOREIGN KEY(business_id,role_id) REFERENCES roles(business_id,id));
CREATE TABLE team_members(business_id TEXT NOT NULL,team_id TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(business_id,team_id,user_id),FOREIGN KEY(business_id,user_id) REFERENCES memberships(business_id,user_id));
-- Resource ownership is registered by trusted ingestion/admin operations, never public input.
CREATE TABLE resources(business_id TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,team_id TEXT,assigned_user_id TEXT,PRIMARY KEY(business_id,kind,id),FOREIGN KEY(business_id) REFERENCES businesses(id),FOREIGN KEY(business_id,assigned_user_id) REFERENCES memberships(business_id,user_id));
CREATE TABLE sessions(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,business_id TEXT NOT NULL,user_id TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,ended_at INTEGER,end_reason TEXT CHECK(end_reason IN('logout','expired','revoked')),FOREIGN KEY(business_id,user_id) REFERENCES memberships(business_id,user_id));
CREATE INDEX session_expiry ON sessions(expires_at) WHERE ended_at IS NULL;
CREATE TABLE access_events(id INTEGER PRIMARY KEY AUTOINCREMENT,business_id TEXT,user_id TEXT,session_id TEXT,event TEXT NOT NULL,occurred_at INTEGER NOT NULL,resource_kind TEXT,resource_id TEXT);
CREATE INDEX access_event_business_time ON access_events(business_id,occurred_at,id);
-- Append-only through application interfaces and normal SQL writes. Infrastructure owners can still modify storage.
CREATE TRIGGER access_events_no_update BEFORE UPDATE ON access_events BEGIN SELECT RAISE(ABORT,'audit events are append-only'); END;
CREATE TRIGGER access_events_no_delete BEFORE DELETE ON access_events BEGIN SELECT RAISE(ABORT,'audit events are append-only'); END;
-- Platform owners are provisioned outside customer-facing administration.
CREATE TABLE platform_owners(user_id TEXT PRIMARY KEY REFERENCES users(id),active INTEGER NOT NULL CHECK(active IN(0,1)));
CREATE TABLE support_sessions(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,business_id TEXT NOT NULL REFERENCES businesses(id),user_id TEXT NOT NULL REFERENCES platform_owners(user_id),reason TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,ended_at INTEGER,end_reason TEXT);
CREATE INDEX support_expiry ON support_sessions(expires_at) WHERE ended_at IS NULL;
