# Feature map

Fleetglass Postgres is the source of truth. The dashboard is per user. Chief owns the live listeners. Gilfoyle writes and launches. Cursor cloud agents do the work, and only when the Cursor plan is active.

## Spine

```
Chief (Richard @richard | GitHub mention | chat_delegate)
        → handoff Gilfoyle
        → Fleetglass task (create, follow-up, or dedupe)
        → Cursor plan gate
        → Cloud Agent
        → state / token / subtask updates
        → board, task detail, heatmap
```

## Triggers

| Feature | Where | Behavior |
| --- | --- | --- |
| `github_pr_mention` | `tasks.trigger`, `src/lib/bots.ts`, `POST /api/github/webhook` | User `avinitDollarpe`. Repos under `DollarPe-Infra` and `avinitDollarpe`. Mentions `avinitDollarpe`, `cursor`, or `cursoragent`. `source_ref` is the PR URL. Idempotency is `github_comment:{comment_id}`. |
| `slack_bot_mention` | `POST /api/slack/events` | Resolved by `team_id` plus `api_app_id` or bot user id. Owner allowlist is on that connector. `source_ref` is the permalink. Idempotency is `slack_ts`, not `event_id`. |
| `chat_delegate` | ingest API | User delegates in chat. The dashboard does not create tasks. |
| Idempotency | `tasks.idempotency_key`, unique `(user_id, idempotency_key)` | GitHub key is the comment id. Slack key is `slack:{team}:{channel}:{slack_ts}`. Duplicate webhook returns the existing task. |
| PR follow-up | `tasks.parent_id` | A later GitHub mention on a PR that already has a top-level task links a child. Dedupe wins. |
| Slack events | `POST /api/slack/events` | One URL for every bot. `url_verification` tries each saved signing secret and returns `{ challenge }`. `app_mention` is ingested only when that connector’s owner allowlist matches. |
| Slack settings | Settings → Integrations → Slack | Per-user connectors. Signing secret, bot token, team id, app id, and owner ids/emails are encrypted on the row. Multiple bots per account. Optional Add to Slack when `SLACK_CLIENT_ID` is set. |
| GitHub webhook | `POST /api/github/webhook` | Signed `issue_comment` and `pull_request_review_comment`. Out-of-scope owners are ignored. Env owner fallback until an App install is stored. |

## Plan gate

| Feature | Where | Behavior |
| --- | --- | --- |
| Account link | `cursor_accounts`, `POST /api/cursor/link` | Cursor user API key, encrypted at rest. |
| Verify | `src/lib/plan.ts`, `GET/POST /api/v1/plan` | `GetPlanInfo` plus `interpretPlan`. Fail closed. |
| Blocked state | `blocked:cursor_plan` | Exact state when the plan is inactive. Task still exists. No spin-up. |
| Launch | `POST /api/v1/tasks/:id/launch` | Re-checks the plan. Stores `bc_id` and agent URL from Cursor. 402 or billing refusal blocks. Other errors stay `Holding`. |
| Local override | `DEV_PLAN_OVERRIDE` | Off Vercel only, and only when `ALLOW_PLAN_OVERRIDE=1`. Banner on the signed-in shell. |

## Board and ingest

| Feature | Where | Behavior |
| --- | --- | --- |
| Auth | Auth.js magic link | Database sessions. After send, the browser lands on `/login/check-email`. Dev mailbox at `/dev/mailbox` when `DEV_MAILBOX=1` and not on Vercel. |
| Tenancy | `user_id` + RLS | Personal accounts. `workspace_id` nullable. No orgs in v1. |
| Tasks | `/board`, `/api/v1/tasks` | Drag-and-drop kanban with six columns: Pending, In progress, In review, Blocked, Done, Cancelled. `blocked:cursor_plan` sits in Blocked. A drop writes that column’s canonical stored state. Same-column drops do nothing. Tasks are created by ingest, not by the board. Card health is Queued (`Holding`), On track (`Working`, `Ready for review`, `Done`), At risk (`Watching 1/3`–`3/3`), or Blocked (`Blocked`, `blocked:cursor_plan`). |
| Subtasks | task detail, `POST /api/v1/tasks/:id/subtasks` | One level. Timeline, subtasks, and tokens use beui tabs. |
| Tokens | `token_usage`, `POST /api/v1/usage`, `POST /api/v1/tasks/:id/sync` | Per task. Cursor sync upserts `cursor:{bcId}:{runId}` and rolls the delta. Cost is an estimate in micros. |
| Heatmap | `/activity` | Account-level daily event counts, 20 weeks, Monday-first UTC, beui HeatCalendar. |
| Agent status | `POST /api/v1/agent-status` | Gilfoyle updates state, `bc_id`, PR URL by task id or idempotency key. New `bc_id` requires an active plan. |
| Ingest keys | `/settings` | `fg_` bearer tokens. SHA-256 lookup, AES-256-GCM at rest. Shown once. |
| Sample fleet | `loadSampleFleet` | GitHub parent + follow-up on one PR, a Slack mention, and a chat task left at `blocked:cursor_plan`. Marked `is_sample`. Not exposed on the board. |

## Roles

| Role | Owns |
| --- | --- |
| Chief | Live listeners. Hands off to Gilfoyle. `pr-comment` allowlist is `avinitDollarpe` plus a mention body filter. |
| Gilfoyle | Board, Cursor launch, Fleetglass writes |
| Richard | Slack app (`@richard`). Events URL lives in this repo; pointing the app is later. |
| Fleetglass | Source of truth, plan gate, dashboard, ingest API |
| Cursor Cloud | Worker. Refused when the plan is inactive |

A Grok teammate named Fleetglass is an interim intake persona only.

## Out of scope

Organizations, Notion as source of truth, invented cloud-agent ids, pointing Richard’s Slack app at the request URL, and making Slack’s `url_verification` challenge succeed against the Cursor Grok Bot webhook.
