ALTER TABLE integrations
  ADD COLUMN signing_secret_encrypted text NOT NULL DEFAULT '',
  ADD COLUMN signing_secret_hint text NOT NULL DEFAULT '',
  ADD COLUMN api_app_id text,
  ADD COLUMN owner_slack_user_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN owner_emails text[] NOT NULL DEFAULT '{}';

DROP INDEX IF EXISTS integrations_user_bot_uidx;

CREATE UNIQUE INDEX integrations_user_github_uidx
  ON integrations (user_id)
  WHERE provider = 'github' AND revoked_at IS NULL;

CREATE UNIQUE INDEX integrations_slack_connection_uidx
  ON integrations (user_id, external_team_id, coalesce(api_app_id, ''))
  WHERE provider = 'slack' AND revoked_at IS NULL AND external_team_id IS NOT NULL;

CREATE INDEX integrations_slack_app_idx
  ON integrations (external_team_id, api_app_id)
  WHERE provider = 'slack' AND revoked_at IS NULL;

-- Event delivery has no session. The handler sets app.slack_resolve inside one transaction
-- so it can load connector rows and verify each row's own signing secret.
CREATE POLICY integrations_slack_resolve ON integrations
  FOR SELECT
  USING (
    provider = 'slack'
    AND revoked_at IS NULL
    AND current_setting('app.slack_resolve', true) = '1'
  );
