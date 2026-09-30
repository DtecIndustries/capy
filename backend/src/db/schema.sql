-- Taxonomy
CREATE TABLE IF NOT EXISTS app (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  app_id TEXT NOT NULL REFERENCES app(id)
);

CREATE TABLE IF NOT EXISTS domain (
  id            TEXT PRIMARY KEY,
  app_id        TEXT NOT NULL REFERENCES app(id),
  name          TEXT NOT NULL,
  owner_team_id TEXT NOT NULL REFERENCES team(id)
);

CREATE TABLE IF NOT EXISTS domain_link (
  from_domain_id TEXT NOT NULL REFERENCES domain(id),
  to_domain_id   TEXT NOT NULL REFERENCES domain(id),
  type           TEXT NOT NULL,
  PRIMARY KEY (from_domain_id, to_domain_id)
);

-- Org directory
CREATE TABLE IF NOT EXISTS client (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  country TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS person (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  team_id  TEXT NOT NULL REFERENCES team(id),
  status   TEXT NOT NULL DEFAULT 'active',
  left_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS client_binding (
  person_id TEXT NOT NULL REFERENCES person(id),
  client_id TEXT NOT NULL REFERENCES client(id),
  PRIMARY KEY (person_id, client_id)
);

-- Documents
CREATE TABLE IF NOT EXISTS document (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  current_version_id TEXT,
  status             TEXT NOT NULL DEFAULT 'current'
);

CREATE TABLE IF NOT EXISTS document_version (
  id           TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES document(id),
  version      TEXT NOT NULL,
  author_id    TEXT NOT NULL REFERENCES person(id),
  modified_by  TEXT NOT NULL REFERENCES person(id),
  modified_at  TIMESTAMPTZ NOT NULL,
  content_hash TEXT NOT NULL,
  pointer      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approval (
  document_version_id TEXT NOT NULL REFERENCES document_version(id),
  status              TEXT NOT NULL,
  by_person_id        TEXT NOT NULL REFERENCES person(id),
  at                  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (document_version_id)
);

CREATE TABLE IF NOT EXISTS document_area (
  document_version_id TEXT NOT NULL REFERENCES document_version(id),
  domain_id           TEXT NOT NULL REFERENCES domain(id),
  client_id           TEXT REFERENCES client(id),
  country             TEXT,
  confidence          REAL NOT NULL DEFAULT 1.0,
  tagged_by           TEXT NOT NULL,
  confirmed_by        TEXT,
  PRIMARY KEY (document_version_id, domain_id)
);

-- Mail metadata (body not retained)
CREATE TABLE IF NOT EXISTS mail_meta (
  id               TEXT PRIMARY KEY,
  thread_id        TEXT NOT NULL,
  from_id          TEXT NOT NULL REFERENCES person(id),
  sent_at          TIMESTAMPTZ NOT NULL,
  domain_id        TEXT REFERENCES domain(id),
  client_id        TEXT REFERENCES client(id),
  references_doc_id TEXT REFERENCES document(id)
);

-- Ledger (append-only, hash-chained)
CREATE TABLE IF NOT EXISTS event (
  id           TEXT PRIMARY KEY,
  ts           TIMESTAMPTZ NOT NULL,
  actor_id     TEXT NOT NULL,
  type         TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id   TEXT NOT NULL,
  domain_id    TEXT REFERENCES domain(id),
  client_id    TEXT REFERENCES client(id),
  country      TEXT,
  payload      JSONB,
  prev_hash    TEXT,
  hash         TEXT NOT NULL
);

-- Housekeeping
CREATE TABLE IF NOT EXISTS housekeeping_task (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL,
  subject_id       TEXT NOT NULL,
  domain_id        TEXT NOT NULL REFERENCES domain(id),
  status           TEXT NOT NULL DEFAULT 'open',
  suggested_action TEXT NOT NULL,
  assigned_team_id TEXT NOT NULL REFERENCES team(id)
);
