# Fleetglass

Fleetglass is a multi-tenant SaaS. Each person signs up with email and tracks their own agent fleet. Postgres is the source of truth. Notion is not.

`main` is the default base branch. Feature work branches from `main` and opens a pull request into `main`.

## Product spine

After any intake trigger, the path is the same:

1. Chief wakes on the mention and hands the context to Gilfoyle.
2. Fleetglass creates or updates the task before any Cloud Agent launch.
3. Gilfoyle, or the built-in orchestrator on the webhook, verifies an active Cursor plan. Inactive plans set the task to `blocked:cursor_plan` and do not launch.
4. A launch stores `bc_id` plus the agent URL.
5. State, subtasks, and token usage land on the dashboard.

The product is only usable with an active Cursor plan. Onboarding and every new launch are gated. Babysitting a task that already has a `bc_id` may continue if the plan later lapses. Sync and usage reads are not launches.

### Ownership

- Chief owns the live listeners. Fleetglass stores the contract, the task, and `POST /api/slack/events` so Richard’s Slack app can be pointed here later.
- Gilfoyle owns the board, launch, and Fleetglass writes after intake. The webhook orchestrator may launch when the plan is active.
- Richard (`@richard`) is the Slack app configured in Settings → Integrations. A Grok teammate named Fleetglass is optional and interim. Pointing Richard’s app, and making Slack’s challenge succeed against the Cursor Grok Bot webhook, is later work and does not block this app.

## Intake triggers

`tasks.trigger` and `tasks.source` share one enum:

| Trigger | When |
| --- | --- |
| `github_pr_mention` | A PR comment on a repo under `DollarPe-Infra` or `avinitDollarpe` @mentions GitHub user `avinitDollarpe`, or `cursor` / `cursoragent` / `@cursor`. |
| `slack_bot_mention` | Richard receives `app_mention`. Only Slack user `U08C40K4FHN` is accepted (`SLACK_MENTION_USER_ID` overrides). |
| `chat_delegate` | The user delegates in chat. The dashboard “Add task” form uses this trigger with `payload.via = dashboard`. |

`tasks.source_ref` is the PR URL for GitHub and the Slack permalink for Slack.

### GitHub values

- User: `avinitDollarpe`
- Repo owners: `DollarPe-Infra`, `avinitDollarpe` (every repo under those owners)
- Mention targets: `avinitDollarpe`, `cursor`, `cursoragent` (plus any extras saved on the install, plus `GITHUB_APP_SLUG`)
- Idempotency key: `github_comment:{comment_id}`
- `source_ref`: the PR URL, lowercased, without query or hash

GitHub’s routine `pr-comment` automation gates on the PR author via `userAllowlist`, not on the mention. Chief listens with allowlist `avinitDollarpe` and a body filter for those mentions. `POST /api/github/webhook` covers org-wide mention intake when `GITHUB_WEBHOOK_SECRET` is set. Until a GitHub App install is stored, the webhook attributes the task to `GITHUB_FLEETGLASS_USER_ID` / `GITHUB_OWNER_EMAIL`, then `SLACK_FLEETGLASS_USER_ID` / `SLACK_OWNER_EMAIL`.

### Slack values

- Display name: Richard. Handle: `@richard`
- Channel scope: `*` (every channel). An empty allowlist means the same thing.
- Aliases, besides the handle: `@cursoragent`, `cursoragent`, `@cursor`, `cursor bot`, `@Cursor`
- Idempotency key: the message timestamp `slack_ts`, stored as `slack:{teamId}:{channelId}:{slackTs}` (or `slack_ts:{slackTs}` when team or channel is missing). `event_id` is kept on the payload and does not win the key.
- `source_ref`: the Slack permalink

Idempotency is unique on `(user_id, idempotency_key)`. Callers may send `idempotencyKey`. A duplicate POST returns `200` and `{ deduped: true }`.

## Slack Event Subscriptions

Request URL: `POST {AUTH_URL}/api/slack/events`

The route is implemented so Richard can be pointed at it later. Live Event Subscriptions pointing, and the Cursor Grok Bot webhook challenge, are not part of this release.

1. Set `SLACK_SIGNING_SECRET` from Richard’s Slack app (Basic Information → App Credentials) when you point it.
2. Set `SLACK_BOT_TOKEN` (`xoxb-…`) for permalinks, and `SLACK_FLEETGLASS_USER_ID` or `SLACK_OWNER_EMAIL` until that workspace is connected with OAuth.
3. Paste `https://<host>/api/slack/events` into Event Subscriptions.
4. Slack sends `url_verification`. Fleetglass checks `X-Slack-Signature` and `X-Slack-Request-Timestamp`, then responds `200` with `{ "challenge": "<value>" }`. A bad signature is `401`. A missing signing secret is `503`.
5. Subscribe to the bot event `app_mention`. Mentions from anyone except `U08C40K4FHN` are acknowledged and ignored.
6. A kept mention creates a `slack_bot_mention` task (`source_ref` is the permalink, idempotency is `slack_ts`). Optional `CHIEF_HANDOFF_URL` receives `{ "type": "fleetglass.slack_mention", ... }` so Chief can hand the task to Gilfoyle. If the Cursor plan is active, the built-in orchestrator launches.

Settings → Integrations → Slack shows that request URL, the display name Richard, handle `@richard`, the alias list, and the channel allowlist. OAuth install (`SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET`) is wired and waits on those secrets.

A new `github_pr_mention` whose normalized PR URL already belongs to a top-level task becomes a follow-up child of that parent (`follow_up_linked`). Dedupe wins over follow-up. Subtasks are one level deep. Slack and chat do not link through `source_ref`.

## Plan gate

Link a Cursor user API key from Dashboard → API Keys. Identity is `GET https://api.cursor.com/v1/me`. Entitlement is `POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetPlanInfo`. A working key is not proof of a paid plan. Unreadable, free, hobby, canceled, or past-due plans are inactive.

Local override: `ALLOW_PLAN_OVERRIDE=1` and `DEV_PLAN_OVERRIDE=active|inactive`, and only when `VERCEL` is unset. The override banner must be visible. Compose enables the flag and does not set the override, so the gate stays closed until you opt in.

Launch calls `POST https://api.cursor.com/v1/agents`. Persist `agent.id` as `bc_id`. HTTP 402 or a plan/billing refusal sets `blocked:cursor_plan`. Other launch failures stay `Holding` and return `cursor_launch_failed`. Never invent a `bc_id`.

## Tenancy

Personal accounts in v1. Every domain table has `user_id`. `workspace_id` is nullable for later teams. Do not build organizations.

Postgres RLS is forced on domain tables. The app sets `app.user_id` with `set_config` inside a transaction. The migrate role may bypass RLS. The app role `fleetglass_app` is `NOBYPASSRLS`.

Auth tables (`users`, `accounts`, `sessions`, `verification_tokens`) have no RLS because magic-link lookup happens before a session. `dev_mailbox` has no RLS, is written only when `DEV_MAILBOX=1`, and 404s when `VERCEL` is set or the flag is off.

Ingest-key lookup uses policy `integrations_key_lookup`: one unrevoked ingest row whose `secret_hash` equals `app.key_hash`.

## Stack

- Next.js App Router, Auth.js v5 database sessions, Nodemailer provider id `nodemailer`.
- Drizzle for queries. SQL migrations in `drizzle/` applied by `scripts/migrate.mjs`.
- Tailwind v4. UI follows better-ui, emil-design-eng, and beui.dev. Heat calendar and tabs are vendored from the beui registry.
- Docker Compose is local only. Production is Vercel plus managed Postgres.

## API

Bearer ingest keys (`fg_…`), shown once. Session cookie routes are the dashboard.

- `GET/POST /api/v1/plan` — live plan check
- `GET/PUT /api/v1/integrations` — Slack bot and GitHub App settings, without secrets
- `GET/PUT /api/v1/aliases` — Richard’s handle and aliases
- `POST /api/slack/events` — Richard’s Event Subscriptions URL. `url_verification` returns the challenge. `app_mention` from `U08C40K4FHN` ingests a task
- `POST /api/github/webhook` — signed GitHub listener for `DollarPe-Infra` and `avinitDollarpe`. Idempotency is `comment_id`
- `GET/POST /api/v1/tasks` — list; create with trigger metadata. `201` new, `200` deduped. `?sourceRef=` filters parents
- `GET/PATCH/DELETE /api/v1/tasks/:id`
- `POST /api/v1/tasks/:id/subtasks`
- `POST /api/v1/tasks/:id/transition`
- `POST /api/v1/tasks/:id/launch`
- `POST /api/v1/tasks/:id/sync` — pull Cursor usage
- `GET /api/v1/tasks/:id/status`
- `POST /api/v1/usage`
- `POST /api/v1/agent-status` — poll-friendly update by `taskId` or `idempotencyKey`
- `POST /api/cursor/link` and `POST /api/cursor/verify` — session cookie

Inactive plan on create still inserts the task as `blocked:cursor_plan`. Inactive plan on launch or on a new `bc_id` returns `409` `{ error: "cursor_plan_inactive", state: "blocked:cursor_plan" }` after the blocked state is committed.

## States

`Working`, `Watching 1/3`, `Watching 2/3`, `Watching 3/3`, `Ready for review`, `Holding`, `Blocked`, `blocked:cursor_plan`, `Done`, `Cancelled`.

Create with an active plan starts at `Holding`, then `Working` after launch.

## Repo

Branches: `fix/`, `feat/`, `perf/`, `docs/`, `test/`, `chore/`, `refactor/`. Short, specific slugs.

Commits: Conventional Commits, one concern each. Sole author Chakravarti Avinit `<avinit@dollarpe.com>`. No `Co-authored-by` trailers.

## Verify

```bash
npm run typecheck
npm run test:plan
npm run test:intake
npm run test:bots
docker compose up --build
```

`GET /api/health` returns `{ ok: true }`. Sign in at `/login`. With `DEV_MAILBOX=1`, open the link at `/dev/mailbox`. Link a Cursor key on `/onboarding`, or set `DEV_PLAN_OVERRIDE=active` off Vercel to preview the board. Load the sample fleet only after the plan is active. `npm run test:rls` needs `DATABASE_URL` pointed at `fleetglass_app`.
