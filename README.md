# Fleetglass

Fleetglass is a backend API. It accepts Slack and GitHub events and wakes Richard with one JSON brief. Richard routes the work. This app does not show a board and does not launch a Cursor agent.

## Wake Richard

Set `CHIEF_HANDOFF_URL` to the Webhook URL on Richard’s Grok Bot routine `fleetglass-slack-chief-webhook`. Set `CHIEF_HANDOFF_AUTHORIZATION` to the Authorization header from that same panel, full value, typically `Bearer <key>`. Fleetglass sends that string as the `Authorization` header and does not add or strip `Bearer`. Fleetglass sends `POST` with `Content-Type: application/json`. When `CHIEF_HANDOFF_AUTHORIZATION` is unset, the POST has no Authorization header.

Slack example:

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

GitHub example:

```json
{
  "type": "fleetglass.wake",
  "source": "github",
  "text": "@avinitDollarpe please",
  "url": "https://github.com/DollarPe-Infra/app/pull/3",
  "author": "ada",
  "ids": {
    "comment_id": "99",
    "repo": "DollarPe-Infra/app",
    "pr_number": 3
  }
}
```

`source` is `slack` or `github`. `text` is the mention or the comment. `url` is the Slack permalink or the PR URL. `author` is the Slack user id or the GitHub login. `ids` holds the raw ids.

A Slack brief can also include `reply` when `FLEETGLASS_PUBLIC_URL` is a host Richard can POST and `FLEETGLASS_REPLY_SECRET` is set. Mint and verify use that one secret. `SLACK_SIGNING_SECRET` does not sign `reply`. `VERCEL_URL` does not mint `reply`. If the public URL or the reply secret is unset, or the host is localhost or `*-git-*.vercel.app`, the wake still runs and `reply` is omitted.

```json
{
  "reply": {
    "url": "https://fleetglass.example/api/slack/reply",
    "exp": 1710001801,
    "sig": "<hmac sha256 hex>"
  }
}
```

`exp` is a Unix second, 15 minutes ahead. `sig` is HMAC-SHA256 hex of `JSON.stringify(["v1", channel_id, thread_ts, exp])`. The routine that receives the brief POSTs `{ "text", "channel_id", "thread_ts", "exp", "sig" }` to `reply.url`, using the channel, thread, exp, and sig from the brief. That routine must POST the reply to Fleetglass. It must not use a Slack connector. Fleetglass then calls `chat.postMessage` with `SLACK_BOT_TOKEN`.

| Response from Fleetglass | Meaning |
| --- | --- |
| 200 `{ "ok": true, "woke": true, "deduped": false }` | Richard returned 2xx |
| 200 `{ "ok": true, "woke": false, "deduped": true }` | This Slack ts or comment id was already delivered |
| 200 `{ "ok": true, "woke": false, "reason": "no_handoff" }` | `CHIEF_HANDOFF_URL` is unset |
| 502 `{ "error": "wake_failed" }` | The POST failed. Slack or GitHub can retry. |

## Slack

Request URL: `https://<host>/api/slack/events`

1. Set `SLACK_SIGNING_SECRET`, and set `SLACK_MENTION_USER_ID` if it is not `U08C40K4FHN`.
2. Paste the request URL into Event Subscriptions.
3. Slack sends `url_verification`. Fleetglass returns 200 and `{ "challenge": "<value>" }`.
4. Subscribe to `app_mention`. Mentions from other users are acknowledged and ignored.
5. Set `CHIEF_HANDOFF_URL` and `CHIEF_HANDOFF_AUTHORIZATION` from the `fleetglass-slack-chief-webhook` routine panel so a kept mention wakes Richard.

`SLACK_BOT_TOKEN` loads a permalink when you have it. The wake does not wait on that token. The same token posts thinking status and bot replies. Optional `SLACK_BOT_USER_ID` must match a bot user id on the payload when the payload lists any.

A missing signing secret is 503. A bad signature is 401.

### Ping

After the owner and bot checks, a mention whose text is exactly `ping` (mention tokens stripped, any case) is answered in Slack. Fleetglass sets the thinking status, then posts `pong` with `chat.postMessage` as the Richard bot. It does not call `CHIEF_HANDOFF_URL`. The event returns 200 `{ "ok": true, "woke": false, "answered": "pong" }`. If the post throws or Slack returns `ok: false`, Fleetglass clears the status with an empty `assistant.threads.setStatus` (or an empty `agents.sessions.setStatus` when that fallback was used) and still returns 200.

Any other mention still wakes Richard. The visible reply for that ask is the signed callback above, posted by the Richard bot. A successful bot message clears the Slack status. If the wake succeeds and Richard cannot call `reply.url`, Fleetglass clears the status itself. Set `FLEETGLASS_PUBLIC_URL` to the production origin so real replies still post. Fleetglass does not set `username`, `icon_emoji`, `icon_url`, or `as_user`.

### Slack app

1. Enable Agents & AI Apps so `assistant.threads.setStatus` can show "{bot} is thinking...".
2. Add the bot token scope `chat:write`.
3. Reinstall the app to the workspace after the scope change, and put the new bot token in `SLACK_BOT_TOKEN`.
4. Invite the bot to the channel.
5. Point the Richard webhook routine at the brief's `reply.url`. Do not attach a Slack connector to that routine.

## GitHub

Set `GITHUB_WEBHOOK_SECRET`. Send `issue_comment` and `pull_request_review_comment` to `https://<host>/api/github/webhook`.

Fleetglass keeps a comment when all of these are true.

- The signature matches.
- The action is `created`.
- The comment is on a pull request.
- The repo owner is `DollarPe-Infra` or `avinitDollarpe`.
- The body mentions `avinitDollarpe`, `cursor`, `cursoragent`, or `GITHUB_APP_SLUG`.

The idempotency key is `github_comment:{comment_id}`.

## Env

| Variable | Required to wake | Role |
| --- | --- | --- |
| `CHIEF_HANDOFF_URL` | Yes | Routine panel Webhook URL |
| `CHIEF_HANDOFF_AUTHORIZATION` | For the Grok Bot routine | Full Authorization header from the routine panel |
| `SLACK_SIGNING_SECRET` | For Slack | Request signature |
| `SLACK_MENTION_USER_ID` | No | Default `U08C40K4FHN` |
| `SLACK_BOT_TOKEN` | No | Permalink, thinking status, and `chat.postMessage` |
| `FLEETGLASS_PUBLIC_URL` | No | Only base URL for `reply.url`. `VERCEL_URL` is not used. |
| `FLEETGLASS_REPLY_SECRET` | For replies | Only HMAC key for mint and `POST /api/slack/reply`. No signing-secret fallback. |
| `SLACK_BOT_USER_ID` | No | Bot id check |
| `GITHUB_WEBHOOK_SECRET` | For GitHub | Request signature |
| `GITHUB_APP_SLUG` | No | Extra mention login |
| `DATABASE_URL` | No | Dedupe across processes via `wake_keys` |
| `DATABASE_URL_MIGRATE` | To create the table | Runs `npm run migrate` |

## Local

```bash
cp .env.example .env.local
npm install
npm run migrate
npm run dev
```

`GET /api/health` returns `{ "ok": true }`.

`npm run migrate` applies `drizzle/`, including `wake_keys`. Without `DATABASE_URL`, a single process still drops duplicate deliveries. Set the URL in production.

Docker Compose runs Postgres 16 and the app:

```bash
docker compose up --build
```

Open http://localhost:3000. Put the Slack and GitHub secrets, `CHIEF_HANDOFF_URL`, and `CHIEF_HANDOFF_AUTHORIZATION` in the `app` service environment before you expect a wake.

## Checks

```bash
npm run typecheck
npm run test:plan
npm run test:intake
npm run test:bots
npm run test:wake
npm run build
```

`npm run test:wake` signs a Slack challenge, a Slack mention, and a GitHub comment, and checks the brief posted to `CHIEF_HANDOFF_URL`.

## Deploy

Production is Vercel plus managed Postgres. Set the env table above and run `npm run migrate` with `DATABASE_URL_MIGRATE`. Point the Slack app at `https://<host>/api/slack/events` and the GitHub webhook at `https://<host>/api/github/webhook`.

For bot replies on Vercel, set `SLACK_BOT_TOKEN` to the reinstalled bot token, set `FLEETGLASS_PUBLIC_URL` to `https://boarding-fleetglass.vercel.app` with no trailing slash, and set one `FLEETGLASS_REPLY_SECRET`. Redeploy after either value changes. `VERCEL_URL` is not a reply host. `SLACK_SIGNING_SECRET` does not sign replies. The Richard routine must POST `reply.url`. It must not use a Cursor Slack connector. Reinstall the Slack app after adding `chat:write`, then invite the bot to the channel.

`output: "standalone"` is for the Docker image. Vercel builds Next.js itself.

## Layout

`AGENTS.md` is the agent contract. `FEATURE_MAP.md` is the route and wake reference. `main` is the default base branch.
