# Fleetglass

Multi-tenant dashboard for a Cursor cloud-agent fleet. Sign up with email, link a Cursor account, and track tasks, states, tokens, and activity. Postgres is the source of truth.

The product is usable only with an active Cursor plan. If the plan is inactive, tasks land in `blocked:cursor_plan` and no cloud agent is launched.

## Spine

Chief wakes on a mention and hands Gilfoyle the context. Fleetglass writes the task, then the plan gate launches a cloud agent:

1. `github_pr_mention` — a PR comment on a repo under `DollarPe-Infra` or `avinitDollarpe` that @mentions `avinitDollarpe`, `cursor`, or `cursoragent`. Idempotency is the comment id. `source_ref` is the PR URL.
2. `slack_bot_mention` — an `app_mention` of a Slack bot that user saved under Settings → Integrations. The connector’s owner allowlist decides who may trigger it. Idempotency is `slack_ts`. `source_ref` is the permalink.
3. `chat_delegate` — you delegate in chat

An inactive Cursor plan stores the task as `blocked:cursor_plan` and does not launch. The board is a six-column kanban: Pending, In progress, In review, Blocked, Done, and Cancelled. Plan-blocked tasks sit in Blocked. The board does not create tasks. Settings → Integrations stores each Slack bot on the signed-in account.

## Slack Event Subscriptions

Request URL:

```text
https://<your-host>/api/slack/events
```

Locally that is `http://localhost:3000/api/slack/events`. On Vercel it is `https://<project>.vercel.app/api/slack/events`.

Sign in, open Settings → Integrations → Slack, and save the bot you own. The signing secret, bot token, team id, app id, and owner allowlist are encrypted on your account. They are not environment variables. Several users can point different Slack apps at the same request URL.

1. Paste the signing secret, bot token, team id, app id, and at least one owner Slack user id or email. Enable the connector.
2. In that Slack app, open Event Subscriptions and paste the request URL.
3. Slack posts `url_verification`. Fleetglass matches a saved signing secret and returns `200` and `{ "challenge": "<the challenge>" }`. A wrong signature is `401`. If nobody has saved a signing secret, the response is `503`.
4. Subscribe to `app_mention`. Events are routed by `team_id` and `api_app_id` (or the bot user id). Only the connector’s owner allowlist creates a task.
5. Optional: set `CHIEF_HANDOFF_URL`. Fleetglass POSTs `{ "type": "fleetglass.slack_mention", "taskId", "sourceRef", "slackUser", "slackTs", "text" }`. An active Cursor plan also launches from this app.

`SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` are optional, for Add to Slack. The OAuth bot token is still stored on the user row. Pointing a live Slack app, and the Cursor Grok Bot webhook challenge, are later.

GitHub: set `GITHUB_WEBHOOK_SECRET` and send `issue_comment` or `pull_request_review_comment` to `/api/github/webhook`. Repos outside `DollarPe-Infra` and `avinitDollarpe` are ignored. A mention of `avinitDollarpe`, `cursor`, or `cursoragent` creates a task keyed by `comment_id`.

Duplicate events collapse on that idempotency key. A later mention on a pull request that already has a task becomes a follow-up on that parent.

## Local

Docker Compose runs Postgres 16 and the app. One command:

```bash
docker compose up --build
```

Open http://localhost:3000. `GET /api/health` returns `{ "ok": true }`.

Magic links are not mailed in this setup. After you send one, the app opens `/login/check-email`. With `DEV_MAILBOX=1`, the link is printed and listed at http://localhost:3000/dev/mailbox. That page 404s on Vercel. On Vercel, set `EMAIL_SERVER` so Nodemailer delivers the same link.

The compose file sets `ALLOW_PLAN_OVERRIDE=1` and does not set `DEV_PLAN_OVERRIDE`, so the plan gate stays closed. To preview the board without a Cursor key, add this to the `app` service and recreate it:

```yaml
DEV_PLAN_OVERRIDE: "active"
```

The shell shows “Local plan override is on. This banner cannot appear on Vercel.” The override is ignored when `VERCEL` is set.

Without the override, sign in, open Settings or onboarding, and paste a Cursor user API key from Dashboard → API Keys. Fleetglass checks identity and plan. An unreadable plan is inactive.

A sample fleet can be loaded from `loadSampleFleet` in code: a GitHub parent, a follow-up on the same PR, a Slack mention, and a chat task left in `blocked:cursor_plan`. It is not a board button.

### App role

Migrations use the superuser `fleetglass`. The app connects as `fleetglass_app` (`NOBYPASSRLS`). Domain tables force row level security. Auth tables do not, because magic-link lookup happens before a session.

```bash
DATABASE_URL=postgres://fleetglass_app:fleetglass_app@localhost:5432/fleetglass npm run test:rls
```

## Without Docker

```bash
cp .env.example .env.local
npm install
npm run migrate
npm run dev
```

Point `DATABASE_URL` at the app role and `DATABASE_URL_MIGRATE` at a role that can create tables.

## Checks

```bash
npm run typecheck
npm run test:plan
npm run test:intake
npm run test:bots
```

## Ingest

Create an ingest key in Settings. It is shown once. Send `Authorization: Bearer fg_…`.

```bash
curl -s -X POST http://localhost:3000/api/v1/tasks \
  -H "Authorization: Bearer $FLEETGLASS_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "trigger": "github_pr_mention",
    "commentId": "ic_123",
    "sourceRef": "https://github.com/DollarPe-Infra/app/pull/42",
    "payload": {
      "repo": "DollarPe-Infra/app",
      "prNumber": 42,
      "prUrl": "https://github.com/DollarPe-Infra/app/pull/42",
      "commentBody": "@avinitDollarpe fix the flaky checkout test",
      "commenter": "chakravarti",
      "mentionTargets": ["avinitDollarpe", "cursor", "cursoragent"],
      "commentId": "ic_123"
    }
  }'
```

`201` creates the task. The same `commentId` again returns `200` and `{ "deduped": true }`. A second comment id on the same PR URL creates a child of the existing parent.

`POST /api/v1/tasks/:id/launch` with `{ "prompt": "…" }` checks the plan, then calls the Cursor Cloud Agents API. `POST /api/v1/usage` records tokens. `POST /api/v1/agent-status` updates state by task id or idempotency key. `sdk/fleetglass.ts` is a small client for Gilfoyle.

## Deploy

Production is Vercel plus managed Postgres (Neon or Vercel Postgres).

1. Create a Postgres database and run `npm run migrate` with `DATABASE_URL_MIGRATE`. On Neon, the table owner is still subject to `FORCE ROW LEVEL SECURITY`; the app role must not bypass RLS.
2. Import the repo in Vercel. Set:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | App role connection string |
| `AUTH_SECRET` | Long random string |
| `AUTH_URL` | `https://your-domain` |
| `AUTH_TRUST_HOST` | `true` |
| `EMAIL_SERVER` | SMTP URL for magic links |
| `EMAIL_FROM` | From address |
| `INTEGRATION_SECRET_KEY` | 64 hex characters |
| `SLACK_CLIENT_ID` | Optional platform Slack OAuth client. Not a tenant secret |
| `SLACK_CLIENT_SECRET` | Optional Slack OAuth client secret |
| `CHIEF_HANDOFF_URL` | Optional POST target after a Slack task is created |
| `GITHUB_APP_SLUG` | Extra GitHub mention target |
| `GITHUB_WEBHOOK_SECRET` | GitHub webhook secret |
| `DEV_MAILBOX` | unset |
| `ALLOW_PLAN_OVERRIDE` | unset |
| `DEV_PLAN_OVERRIDE` | unset |

3. Do not set `VERCEL` yourself; Vercel sets it, and that disables the plan override.

`output: "standalone"` is for the Docker image. Vercel builds Next.js itself.

## Layout

`AGENTS.md` is the agent contract. `FEATURE_MAP.md` maps triggers, the plan gate, and the API. `main` is the default base branch.
