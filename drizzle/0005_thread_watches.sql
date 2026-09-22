-- Thread watches. No RLS: Slack webhooks have no session.
CREATE TABLE IF NOT EXISTS thread_watches (
  channel_id text NOT NULL,
  thread_ts text NOT NULL,
  refs text[] NOT NULL DEFAULT '{}',
  owner_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, thread_ts)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleetglass_app') THEN
    GRANT SELECT, INSERT, UPDATE ON thread_watches TO fleetglass_app;
  END IF;
END $$;
