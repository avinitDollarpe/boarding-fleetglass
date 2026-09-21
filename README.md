# Fleetglass

Multi-tenant dashboard for a Cursor cloud-agent fleet. Sign up with email, link a Cursor account, and track tasks, states, tokens, and activity. Postgres is the source of truth.

The product is usable only with an active Cursor plan. If the plan is inactive, tasks land in `blocked:cursor_plan` and no cloud agent is launched.

## Spine

Chief receives a task from any of three triggers, then hands it to Gilfoyle:

1. `github_pr_mention` — a PR comment that @mentions Chakravarti’s GitHub user, the Cursor bot, or `@cursor`
2. `slack_bot_mention` — a Slack message that mentions `@cursor`, the Cursor bot, or a name in your alias list
3. `chat_delegate` — you tell Chief to delegate

Gilfoyle writes the Fleetglass task, checks the Cursor plan, launches the cloud agent, and keeps state and token usage current. Chief owns the listeners. Gilfoyle owns the board, the launch, and the writes.

Duplicate comment webhooks collapse on an idempotency key (`comment_id`, or Slack team + channel + message ts). A later mention on a pull request that already has a task becomes a follow-up on that parent.

## Local

Docker Compose runs Postgres 16 and the app. One command:

```bash
docker compose up --build
```

Open http://localhost:3000. `GET /api/health` returns `{ "ok": true }`.

Magic links are not mailed in this setup. With `DEV_MAILBOX=1`, the link is printed and listed at http://localhost:3000/dev/mailbox. That page 404s on Vercel.

The compose file sets `ALLOW_PLAN_OVERRIDE=1` and does not set `DEV_PLAN_OVERRIDE`, so the plan gate stays closed. To preview the board without a Cursor key, add this to the `app` service and recreate it:

```yaml
DEV_PLAN_OVERRIDE: "active"
```

The shell shows “Local plan override is on. This banner cannot appear on Vercel.” The override is ignored when `VERCEL` is set.

Without the override, sign in, open Settings or onboarding, and paste a Cursor user API key from Dashboard → API Keys. Fleetglass checks identity and plan. An unreadable plan is inactive.

After the plan is active, the board can load a sample fleet: a GitHub parent, a follow-up on the same PR, a Slack mention, and a chat task left in `blocked:cursor_plan`.

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
npx tsx scripts/intake-check.ts
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
    "sourceRef": "https://github.com/acme/app/pull/42",
    "payload": {
      "repo": "acme/app",
      "prNumber": 42,
      "prUrl": "https://github.com/acme/app/pull/42",
      "commentBody": "@cursor fix the flaky checkout test",
      "commenter": "chakravarti",
      "mentionTargets": ["cursor"],
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
| `DEV_MAILBOX` | unset |
| `ALLOW_PLAN_OVERRIDE` | unset |
| `DEV_PLAN_OVERRIDE` | unset |

3. Do not set `VERCEL` yourself; Vercel sets it, and that disables the plan override.

`output: "standalone"` is for the Docker image. Vercel builds Next.js itself.

## Layout

`AGENTS.md` is the agent contract. `FEATURE_MAP.md` maps triggers, the plan gate, and the API. `main` is the default base branch.
