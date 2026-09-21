CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  email text NOT NULL UNIQUE,
  email_verified timestamptz,
  image text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type text NOT NULL,
  provider text NOT NULL,
  provider_account_id text NOT NULL,
  refresh_token text,
  access_token text,
  expires_at integer,
  token_type text,
  scope text,
  id_token text,
  session_state text,
  PRIMARY KEY (provider, provider_account_id)
);

CREATE TABLE sessions (
  session_token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires timestamptz NOT NULL
);

CREATE TABLE verification_tokens (
  identifier text NOT NULL,
  token text NOT NULL,
  expires timestamptz NOT NULL,
  PRIMARY KEY (identifier, token)
);

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workspace_id uuid,
  parent_id uuid REFERENCES tasks (id) ON DELETE CASCADE,
  external_id text,
  idempotency_key text,
  name text NOT NULL,
  owner text NOT NULL DEFAULT '',
  state text NOT NULL,
  trigger text NOT NULL,
  source text NOT NULL,
  source_ref text,
  trigger_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  prs text,
  pr_url text,
  cloud_agent_url text,
  bc_id text,
  cursor_run_id text,
  repo_url text,
  last_commit text,
  is_sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_state_check CHECK (state IN (
    'Working', 'Watching 1/3', 'Watching 2/3', 'Watching 3/3',
    'Ready for review', 'Holding', 'Blocked', 'blocked:cursor_plan',
    'Done', 'Cancelled'
  )),
  CONSTRAINT tasks_trigger_check CHECK (trigger IN (
    'github_pr_mention', 'slack_bot_mention', 'chat_delegate'
  )),
  CONSTRAINT tasks_source_check CHECK (source IN (
    'github_pr_mention', 'slack_bot_mention', 'chat_delegate'
  ))
);

CREATE UNIQUE INDEX tasks_user_idempotency_uidx
  ON tasks (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX tasks_user_external_uidx
  ON tasks (user_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX tasks_user_state_idx ON tasks (user_id, state);
CREATE INDEX tasks_user_source_ref_idx ON tasks (user_id, source_ref);
CREATE INDEX tasks_parent_idx ON tasks (parent_id);

CREATE TABLE task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workspace_id uuid,
  task_id uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  kind text NOT NULL,
  from_state text,
  to_state text,
  note text,
  actor text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_events_task_idx ON task_events (task_id, occurred_at);

CREATE TABLE token_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workspace_id uuid,
  task_id uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  agent_id text,
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  cost_micros bigint NOT NULL DEFAULT 0,
  source text NOT NULL,
  external_ref text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX token_usage_user_ref_uidx
  ON token_usage (user_id, external_ref)
  WHERE external_ref IS NOT NULL;

CREATE INDEX token_usage_task_idx ON token_usage (task_id, occurred_at);
CREATE INDEX token_usage_user_time_idx ON token_usage (user_id, occurred_at);

CREATE TABLE daily_rollups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workspace_id uuid,
  day date NOT NULL,
  task_id uuid REFERENCES tasks (id) ON DELETE CASCADE,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cache_read_tokens bigint NOT NULL DEFAULT 0,
  cache_write_tokens bigint NOT NULL DEFAULT 0,
  cost_micros bigint NOT NULL DEFAULT 0,
  event_count integer NOT NULL DEFAULT 0,
  tasks_done integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX daily_rollups_task_uidx
  ON daily_rollups (user_id, day, task_id)
  WHERE task_id IS NOT NULL;

CREATE UNIQUE INDEX daily_rollups_account_uidx
  ON daily_rollups (user_id, day)
  WHERE task_id IS NULL;

CREATE TABLE integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workspace_id uuid,
  provider text NOT NULL,
  name text NOT NULL,
  secret_hash text NOT NULL,
  secret_encrypted text NOT NULL,
  secret_hint text NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX integrations_user_idx ON integrations (user_id, provider);

CREATE TABLE cursor_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  workspace_id uuid,
  api_key_encrypted text,
  api_key_hint text,
  cursor_user_id text,
  cursor_email text,
  plan_status text NOT NULL DEFAULT 'unlinked',
  plan_reason text,
  plan_checked_at timestamptz,
  plan_raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mention_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workspace_id uuid,
  kind text NOT NULL,
  alias text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mention_aliases_kind_check CHECK (kind IN ('slack')),
  UNIQUE (user_id, kind, alias)
);

CREATE TABLE dev_mailbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

-- Auth tables stay open to the app role: magic-link lookup happens before a session exists.
-- users.id is the tenant key. Domain tables below are forced through RLS.

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tasks_tenant ON tasks
  USING (user_id = app_user_id())
  WITH CHECK (user_id = app_user_id());

ALTER TABLE task_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_events FORCE ROW LEVEL SECURITY;
CREATE POLICY task_events_tenant ON task_events
  USING (user_id = app_user_id())
  WITH CHECK (user_id = app_user_id());

ALTER TABLE token_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_usage FORCE ROW LEVEL SECURITY;
CREATE POLICY token_usage_tenant ON token_usage
  USING (user_id = app_user_id())
  WITH CHECK (user_id = app_user_id());

ALTER TABLE daily_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_rollups FORCE ROW LEVEL SECURITY;
CREATE POLICY daily_rollups_tenant ON daily_rollups
  USING (user_id = app_user_id())
  WITH CHECK (user_id = app_user_id());

ALTER TABLE cursor_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cursor_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY cursor_accounts_tenant ON cursor_accounts
  USING (user_id = app_user_id())
  WITH CHECK (user_id = app_user_id());

ALTER TABLE mention_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE mention_aliases FORCE ROW LEVEL SECURITY;
CREATE POLICY mention_aliases_tenant ON mention_aliases
  USING (user_id = app_user_id())
  WITH CHECK (user_id = app_user_id());

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations FORCE ROW LEVEL SECURITY;
CREATE POLICY integrations_tenant ON integrations
  USING (user_id = app_user_id())
  WITH CHECK (user_id = app_user_id());
CREATE POLICY integrations_key_lookup ON integrations
  FOR SELECT
  USING (
    provider = 'ingest'
    AND revoked_at IS NULL
    AND NULLIF(current_setting('app.key_hash', true), '') IS NOT NULL
    AND secret_hash = current_setting('app.key_hash', true)
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleetglass_app') THEN
    GRANT USAGE ON SCHEMA public TO fleetglass_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fleetglass_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fleetglass_app;
    GRANT EXECUTE ON FUNCTION app_user_id() TO fleetglass_app;
  END IF;
END $$;
