# Fleetglass

Fleetglass is a multi-tenant SaaS. Each person signs up with email and tracks their own agent fleet. Postgres is the source of truth. Notion is not.

`main` is the default base branch. Feature work branches from `main` and opens a pull request into `main`.

## Product spine

After any intake trigger, the path is the same:

1. Chief (Grok Bot) receives the task.
2. Chief delegates to Gilfoyle with the trigger context.
3. Gilfoyle creates or updates the Fleetglass task before any Cloud Agent launch.
4. Gilfoyle verifies an active Cursor plan. Inactive plans set the task to `blocked:cursor_plan` and do not launch.
5. Gilfoyle launches a Cursor cloud agent and stores `bc_id` plus the agent URL.
6. Gilfoyle and watchers write state, subtasks, and token usage. The dashboard shows the board, task timeline, tokens, and heatmap.

The product is only usable with an active Cursor plan. Onboarding and every new launch are gated. Babysitting a task that already has a `bc_id` may continue if the plan later lapses. Sync and usage reads are not launches.

### Ownership

- Chief owns the GitHub and Slack listeners and the handoff to Gilfoyle.
- Gilfoyle owns the board, launch, and Fleetglass writes.
- Fleetglass stores tasks, verifies the plan, and serves the dashboard and ingest API. It does not subscribe to GitHub or Slack.

## Intake triggers

`tasks.trigger` and `tasks.source` share one enum:

| Trigger | When |
| --- | --- |
| `github_pr_mention` | A PR issue comment, review comment, or inline comment @mentions Chakravarti’s GitHub user, the Cursor bot, or `@cursor`. |
| `slack_bot_mention` | A Slack message mentions `@cursor`, the Cursor bot, or a name in the user’s alias list. |
| `chat_delegate` | The user tells Chief to delegate. The dashboard “Add task” form uses this trigger with `payload.via = dashboard`. |

`tasks.source_ref` is the normalized PR URL or the Slack permalink. `tasks.trigger_payload` keeps the rest: repo, PR number, comment body, commenter, mention targets, team, channel, text, user.

Idempotency is `(user_id, idempotency_key)`. Callers may send `idempotencyKey`. Otherwise GitHub uses `github_comment:{commentId}` and Slack uses `slack:{teamId}:{channelId}:{messageTs}`. A duplicate POST returns `200` and `{ deduped: true }` with the existing task.

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
- `GET/PUT /api/v1/aliases` — Slack alias list Chief should match, plus built-in `@cursor` and `Cursor`
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
npx tsx scripts/intake-check.ts
docker compose up --build
```

`GET /api/health` returns `{ ok: true }`. Sign in at `/login`. With `DEV_MAILBOX=1`, open the link at `/dev/mailbox`. Link a Cursor key on `/onboarding`, or set `DEV_PLAN_OVERRIDE=active` off Vercel to preview the board. Load the sample fleet only after the plan is active. `npm run test:rls` needs `DATABASE_URL` pointed at `fleetglass_app`.
