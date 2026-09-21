ALTER TABLE integrations
  ADD COLUMN display_name text,
  ADD COLUMN handle text,
  ADD COLUMN aliases text[] NOT NULL DEFAULT '{}',
  ADD COLUMN channel_allowlist text[] NOT NULL DEFAULT '{}',
  ADD COLUMN mention_targets text[] NOT NULL DEFAULT '{}',
  ADD COLUMN enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN external_team_id text,
  ADD COLUMN external_id text,
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX integrations_user_bot_uidx
  ON integrations (user_id, provider)
  WHERE provider IN ('slack', 'github') AND revoked_at IS NULL;

CREATE INDEX integrations_slack_team_idx
  ON integrations (external_team_id)
  WHERE provider = 'slack' AND revoked_at IS NULL;

CREATE INDEX integrations_github_install_idx
  ON integrations (external_id)
  WHERE provider = 'github' AND revoked_at IS NULL;

INSERT INTO integrations (
  user_id, provider, name, secret_hash, secret_encrypted, secret_hint,
  display_name, handle, aliases, enabled
)
SELECT
  user_id,
  'slack',
  'Fleetglass',
  encode(digest('pending:slack:' || user_id::text, 'sha256'), 'hex'),
  '',
  '',
  'Fleetglass',
  'Fleetglass',
  array_agg(alias ORDER BY alias),
  false
FROM mention_aliases
WHERE kind = 'slack'
GROUP BY user_id;

DROP TABLE mention_aliases;

CREATE POLICY integrations_slack_lookup ON integrations
  FOR SELECT
  USING (
    provider = 'slack'
    AND revoked_at IS NULL
    AND NULLIF(current_setting('app.slack_team', true), '') IS NOT NULL
    AND external_team_id = current_setting('app.slack_team', true)
  );

CREATE POLICY integrations_github_lookup ON integrations
  FOR SELECT
  USING (
    provider = 'github'
    AND revoked_at IS NULL
    AND NULLIF(current_setting('app.github_installation', true), '') IS NOT NULL
    AND external_id = current_setting('app.github_installation', true)
  );
