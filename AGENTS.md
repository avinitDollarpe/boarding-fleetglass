# Fleetglass

## Cloud agents

Before any coding, load and follow `pstack` and `caveman`. pstack means go deep first, then write less. caveman means terse communication. Code, commits, and pull requests stay normal English.

Fleetglass is one operator’s Cursor fleet board. Chakravarti runs it locally, on Vercel, or in Docker. Postgres is the source of truth. Notion is not. There is no signup-for-anyone and no connector marketplace.

`main` is the default base branch. Feature work branches from `main` and opens a pull request into `main`.

## Product spine

After any intake trigger, the path is the same:

1. Chief wakes on the mention and hands the context to Gilfoyle.
2. Fleetglass creates or updates the task before any Cloud Agent launch.
3. Gilfoyle, or the built-in orchestrator on the webhook, verifies an active Cursor plan. Inactive plans set the task to `blocked:cursor_plan` and do not launch.
4. A launch stores `bc_id` plus the agent URL.
5. State, subtasks, and token usage land on the dashboard.

The board is visible without an active Cursor plan. New launches are gated. Babysitting a task that already has a `bc_id` may continue if the plan later lapses. Sync and usage reads are not launches.

### Ownership

- Chief owns the live listeners. Fleetglass stores the contract, the task, and `POST /api/slack/events` so Richard’s Slack app can be pointed here later.
- Gilfoyle owns the board, launch, and Fleetglass writes after intake. The webhook orchestrator may launch when the plan is active.
- Richard (`@richard`) is the Slack app named in deploy env. A Grok teammate named Fleetglass is optional and interim. Pointing Richard’s app at `POST /api/slack/events` is later work and does not block this app.

## Intake triggers

`tasks.trigger` and `tasks.source` share one enum:

| Trigger | When |
| --- | --- |
| `github_pr_mention` | A PR comment on a repo under `DollarPe-Infra` or `avinitDollarpe` @mentions GitHub user `avinitDollarpe`, or `cursor` / `cursoragent` / `@cursor`. |
| `slack_bot_mention` | An `app_mention` from `SLACK_MENTION_USER_ID` (default `U08C40K4FHN`). Slack secrets live in deploy env. |
| `chat_delegate` | The user delegates in chat, or another client posts the trigger to the ingest API. The dashboard does not create tasks. |

`tasks.source_ref` is the PR URL for GitHub and the Slack permalink for Slack.

### GitHub values

- User: `avinitDollarpe`
- Repo owners: `DollarPe-Infra`, `avinitDollarpe` (every repo under those owners)
- Mention targets: `avinitDollarpe`, `cursor`, `cursoragent` (plus any extras saved on the install, plus `GITHUB_APP_SLUG`)
- Idempotency key: `github_comment:{comment_id}`
- `source_ref`: the PR URL, lowercased, without query or hash

GitHub’s routine `pr-comment` automation gates on the PR author via `userAllowlist`, not on the mention. Chief listens with allowlist `avinitDollarpe` and a body filter for those mentions. `POST /api/github/webhook` covers org-wide mention intake when `GITHUB_WEBHOOK_SECRET` is set. Until a GitHub App install is stored, the webhook attributes the task to `GITHUB_FLEETGLASS_USER_ID`, then `OWNER_EMAIL`, then `GITHUB_OWNER_EMAIL`.

### Slack values

Slack is deploy env only. There is no Settings form and no Add to Slack.

- `SLACK_SIGNING_SECRET` verifies `POST /api/slack/events`. Unset returns `503`. A bad signature is `401`.
- `SLACK_BOT_TOKEN` fetches the permalink. Without it, a verified mention is acknowledged and ignored.
- `SLACK_MENTION_USER_ID` is the only Slack user who may create a task. Default `U08C40K4FHN`.
- `SLACK_BOT_USER_ID` is optional. When set, and the payload lists bot user ids, that id must be one of them.
- Display name stays Richard. Handle stays `@richard`.
- Idempotency key: the message timestamp `slack_ts`, stored as `slack:{teamId}:{channelId}:{slackTs}` (or `slack_ts:{slackTs}` when team or channel is missing). `event_id` is kept on the payload and does not win the key.
- `source_ref`: the Slack permalink
- The task is written to the owner account: `GITHUB_FLEETGLASS_USER_ID`, else the user row for `OWNER_EMAIL` or `GITHUB_OWNER_EMAIL`.

Idempotency is unique on `(user_id, idempotency_key)`. Callers may send `idempotencyKey`. A duplicate POST returns `200` and `{ deduped: true }`.

## Slack Event Subscriptions

Request URL: `POST {AUTH_URL}/api/slack/events`

One Slack app uses this URL. Fleetglass verifies `X-Slack-Signature` with `SLACK_SIGNING_SECRET`. If that env is unset, the response is `503`. A bad signature is `401`. `url_verification` returns `200` with `{ "challenge": "<value>" }`.

1. Set `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, and `SLACK_MENTION_USER_ID` on the deploy. Production also sets `OWNER_EMAIL`.
2. Paste `https://<host>/api/slack/events` into that app’s Event Subscriptions.
3. Subscribe to `app_mention`. Mentions from anyone else are acknowledged and ignored.
4. A kept mention creates a `slack_bot_mention` task on the owner account. Optional `CHIEF_HANDOFF_URL` receives `{ "type": "fleetglass.slack_mention", ... }`. If the Cursor plan is active, the built-in orchestrator launches.

Live pointing of a Slack app is later. Old connector rows in Postgres are unused. Do not add a migration to drop them.

A new `github_pr_mention` whose normalized PR URL already belongs to a top-level task becomes a follow-up child of that parent (`follow_up_linked`). Dedupe wins over follow-up. Subtasks are one level deep. Slack and chat do not link through `source_ref`.

## Plan gate

Link a Cursor user API key from Dashboard → API Keys. Identity is `GET https://api.cursor.com/v1/me`. Entitlement is `POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetPlanInfo`. A working key is not proof of a paid plan. Unreadable, free, hobby, canceled, or past-due plans are inactive.

Local override: `ALLOW_PLAN_OVERRIDE=1` and `DEV_PLAN_OVERRIDE=active|inactive`, and only when `VERCEL` is unset. The override banner must be visible. Compose enables the flag and does not set the override, so the gate stays closed until you opt in.

Launch calls `POST https://api.cursor.com/v1/agents`. Persist `agent.id` as `bc_id`. HTTP 402 or a plan/billing refusal sets `blocked:cursor_plan`. Other launch failures stay `Holding` and return `cursor_launch_failed`. Never invent a `bc_id`.

## Owner

One operator. `OWNER_EMAIL`, when set, is the only address that may request a magic link or complete sign-in. Unset, local compose still allows whoever signs in. Production must set it. Every domain table still has `user_id`. `workspace_id` stays nullable. Do not build organizations.

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
- `GET/PUT /api/v1/integrations` — GitHub App settings. Slack on this route is a note that secrets are env-only
- `GET/PUT /api/v1/aliases` — read-only note. PUT returns `410` `slack_env_only`
- `POST /api/slack/events` — Event Subscriptions URL. Verifies `SLACK_SIGNING_SECRET`. `app_mention` from `SLACK_MENTION_USER_ID` ingests into the owner account
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

Stored states stay: `Holding`, `Working`, `Watching 1/3`, `Watching 2/3`, `Watching 3/3`, `Ready for review`, `Blocked`, `blocked:cursor_plan`, `Done`, `Cancelled`.

The board shows six columns. A drop writes the column’s canonical state. A drop inside the same column is a no-op, so a watching stage is kept until the card leaves that column. `blocked:cursor_plan` stays in Blocked; the plan gate still writes that stored state.

Card health, separate from the column: Queued is `Holding`, On track is `Working`, `Ready for review`, and `Done`, At risk is `Watching 1/3`, `Watching 2/3`, and `Watching 3/3`, Blocked is `Blocked` and `blocked:cursor_plan`. The ring is subtask completion, or a fixed reading of the stored state when the task has no subtasks.

| Column | Id | Stored states | Drop writes |
| --- | --- | --- | --- |
| Pending | `PENDING` | `Holding` | `Holding` |
| In progress | `IN_PROGRESS` | `Working`, `Watching 1/3`, `Watching 2/3`, `Watching 3/3` | `Working` |
| In review | `IN_REVIEW` | `Ready for review` | `Ready for review` |
| Blocked | `BLOCKED` | `Blocked`, `blocked:cursor_plan` | `Blocked` |
| Done | `DONE` | `Done` | `Done` |
| Cancelled | `CANCELLED` | `Cancelled` | `Cancelled` |

Create with an active plan starts at `Holding` (Pending), then `Working` (In progress) after launch.

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

`GET /api/health` returns `{ ok: true }`. Sign in at `/login`. With `DEV_MAILBOX=1`, open the link at `/dev/mailbox`. The board is `/board` even when the plan is inactive. The Cursor key sits in the plan disclosure on that page. `/activity`, `/settings`, `/onboarding`, and `/signup` redirect to `/board`. `npm run test:rls` needs `DATABASE_URL` pointed at `fleetglass_app`.
