CREATE SCHEMA IF NOT EXISTS pilore;

CREATE TABLE IF NOT EXISTS pilore.schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pilore.sessions (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  user_id text NOT NULL,
  course_id text,
  title text NOT NULL DEFAULT '',
  revision bigint NOT NULL CHECK (revision >= 0),
  snapshot_version integer NOT NULL,
  snapshot_algorithm text NOT NULL,
  snapshot_ciphertext bytea NOT NULL,
  snapshot_nonce bytea NOT NULL,
  snapshot_key_id text NOT NULL,
  active_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_identity_idx ON pilore.sessions (tenant_id, user_id, course_id);

CREATE TABLE IF NOT EXISTS pilore.runs (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES pilore.sessions(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  provider_id text NOT NULL,
  model_id text NOT NULL,
  persona_key text,
  audit_algorithm text NOT NULL,
  audit_ciphertext bytea NOT NULL,
  audit_nonce bytea NOT NULL,
  audit_key_id text NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS runs_session_started_idx ON pilore.runs (session_id, started_at DESC);

INSERT INTO pilore.schema_migrations(version) VALUES (1) ON CONFLICT (version) DO NOTHING;
