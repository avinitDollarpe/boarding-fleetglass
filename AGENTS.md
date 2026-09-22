# Fleetglass

## Cloud agents

Before any coding, load and follow `pstack` and `caveman`.

pstack means go deep on the existing path first, then write less. For this repo that path is Slack verify, GitHub verify, and `CHIEF_HANDOFF_URL`. Prefer that handoff over a new client.

caveman means terse communication, about a 75% token cut, with technical accuracy kept. Code, commits, and pull requests stay normal English.

Fleetglass is a backend API for one operator. It intakes Slack and GitHub and wakes Richard. Richard routes to specialists. This app does not launch Cursor agents and does not invent a chat API.

`main` is the default base branch. Feature work branches from `main` and opens a pull request into `main`.

## Spine

1. Slack `app_mention` hits `POST /api/slack/events`.
2. A GitHub PR comment hits `POST /api/github/webhook`.
3. Fleetglass checks the signature, then the owner or the mention.
4. It POSTs one `fleetglass.wake` brief to `CHIEF_HANDOFF_URL`.
5. Richard receives the brief and routes. Routing stays outside this app.

`SLACK_BOT_TOKEN` is optional. When it is set, Fleetglass asks Slack for the permalink. When it is unset, the brief still goes out with `https://slack.com/archives/{channel}/p{ts}`.

There is no Slack OAuth and no settings form.

## Richard wake

`deliverRichardWake` in `src/server/wake.ts` POSTs the brief.

```json
{
  "type": "fleetglass.wake",
  "source": "slack",
  "text": "ship the api",
  "url": "https://slack.com/archives/C9/p1710000001000100",
  "author": "U08C40K4FHN",
  "ids": {
    "slack_ts": "1710000001.000100",
    "event_id": "Ev9",
    "team_id": "T1",
    "channel_id": "C9"
  }
}
```

GitHub uses the same `type` with `source` `github`. `url` is the PR URL. `author` is the commenter login. `ids` carries `comment_id`, `repo`, and `pr_number`.

The request is `POST` with `Content-Type: application/json`. When `CHIEF_HANDOFF_AUTHORIZATION` is set, that trimmed value is sent as the `Authorization` header, unchanged. Unset, the POST has no Authorization header.

| Result | HTTP | Body |
| --- | --- | --- |
| Richard accepted the brief | 200 | `{ "ok": true, "woke": true, "deduped": false }` |
| Same idempotency key again | 200 | `{ "ok": true, "woke": false, "deduped": true }` |
| `CHIEF_HANDOFF_URL` unset | 200 | `{ "ok": true, "woke": false, "reason": "no_handoff" }` |
| Richard did not return 2xx, or the POST failed | 502 | `{ "error": "wake_failed" }` |

A missing handoff URL does not store the key, so a later deploy can still wake. A failed POST deletes the key so the platform retry can wake. A duplicate does not POST again.

## Idempotency

`normalizeIntake` builds the key. Slack is `slack:{team}:{channel}:{slack_ts}`, or `slack_ts:{slack_ts}` when team or channel is missing. `event_id` does not win. GitHub is `github_comment:{comment_id}`.

When `DATABASE_URL` is set, the key is inserted into `wake_keys` (`drizzle/0004_wake_keys.sql`). Run `npm run migrate` so the table exists. The table has no RLS, because these webhooks have no session. Old task tables stay in place. Do not add a migration to drop them.

## Slack

`POST /api/slack/events`

| Case | HTTP |
| --- | --- |
| `SLACK_SIGNING_SECRET` unset | 503 `slack_unconfigured` |
| Bad `X-Slack-Signature` | 401 `invalid_signature` |
| `url_verification` with `challenge` | 200 `{ "challenge": "<value>" }` |
| `app_mention` from anyone except `SLACK_MENTION_USER_ID` | 200 `{ "ok": true, "ignored": "owner" }` |
| Mention text is exactly `ping` after mention tokens are stripped | 200 `{ "ok": true, "woke": false, "answered": "pong" }` and no handoff |

Default mention user is `U08C40K4FHN`. Optional `SLACK_BOT_USER_ID` must be one of the payload bot user ids when those ids are present. Only `app_mention` is ingested.

`ping` is case-insensitive. Fleetglass posts `pong` with `chat.postMessage` and `SLACK_BOT_TOKEN` in `decision.threadTs`. It does not call `deliverRichardWake`. A failed post still returns 200 and clears Slack status with an empty status string.

Other Slack mentions still wake Richard. When `FLEETGLASS_PUBLIC_URL` is a host Richard can POST and `FLEETGLASS_REPLY_SECRET` is set, the Slack brief includes `reply` (`url`, `exp`, `sig`). `VERCEL_URL` does not mint `reply`. `SLACK_SIGNING_SECRET` does not sign `reply`. Mint and verify both use `slackReplySecret()`. `POST /api/slack/reply` checks that HMAC and posts with the bot token. The routine must POST there. It must not use a Slack connector. GitHub briefs have no `reply`. An unset public URL, a missing reply secret, localhost, or a `*-git-*.vercel.app` host omits `reply` and still wakes. After that wake succeeds, Fleetglass clears assistant status. A usable `reply.url` stays up until the bot posts.

## GitHub

`POST /api/github/webhook` with `X-Hub-Signature-256` and `GITHUB_WEBHOOK_SECRET`.

Events are `issue_comment` and `pull_request_review_comment`, action `created`, on a pull request. Repo owners are `DollarPe-Infra` and `avinitDollarpe`. Mention targets are `avinitDollarpe`, `cursor`, `cursoragent`, plus `GITHUB_APP_SLUG` when set. Anything else is 200 with `ignored`.

Unset secret is 503 `github_unconfigured`. A bad signature is 401 `invalid_signature`.

## Env

| Variable | Role |
| --- | --- |
| `SLACK_SIGNING_SECRET` | Verifies Slack. Required for `POST /api/slack/events`. |
| `SLACK_BOT_TOKEN` | Optional permalink, thinking status, and `chat.postMessage`. |
| `FLEETGLASS_PUBLIC_URL` | Optional. Only base URL for the Slack reply callback. `VERCEL_URL` is not used. |
| `FLEETGLASS_REPLY_SECRET` | Required to mint and verify `reply`. One value on Production. No fallback to `SLACK_SIGNING_SECRET`. Redeploy after a change. |
| `SLACK_MENTION_USER_ID` | Only this Slack user wakes Richard. |
| `SLACK_BOT_USER_ID` | Optional bot id check. |
| `GITHUB_WEBHOOK_SECRET` | Verifies GitHub. Required for the webhook. |
| `GITHUB_APP_SLUG` | Extra mention target. |
| `CHIEF_HANDOFF_URL` | Richard wake URL. Routine panel Webhook URL. Required to actually wake. |
| `CHIEF_HANDOFF_AUTHORIZATION` | Optional. Full Authorization header from routine `fleetglass-slack-chief-webhook`. |
| `DATABASE_URL` | Optional. Enables `wake_keys` dedupe across processes. |
| `DATABASE_URL_MIGRATE` | Role that can create `wake_keys`. |

## Out of scope

Kanban, magic-link auth, organizations, a Notion importer, a fake chat API, and an invented `bc_id`. `src/lib/plan.ts` remains so `npm run test:plan` still runs. The request path does not call it.

## Repo

Branches: `fix/`, `feat/`, `perf/`, `docs/`, `test/`, `chore/`, `refactor/`. Short, specific slugs.

Commits: Conventional Commits, one concern each. Sole author Chakravarti Avinit `<avinit@dollarpe.com>`. No `Co-authored-by` trailers.

## Verify

```bash
npm run typecheck
npm run test:plan
npm run test:intake
npm run test:bots
npm run test:wake
npm run build
```

`GET /api/health` returns `{ "ok": true }`. `/` lists the routes. `npm run test:rls` still needs `DATABASE_URL` pointed at `fleetglass_app` and the old task tables.
