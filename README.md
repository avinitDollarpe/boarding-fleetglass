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

`SLACK_BOT_TOKEN` loads a permalink when you have it. The wake does not wait on that token. Optional `SLACK_BOT_USER_ID` must match a bot user id on the payload when the payload lists any.

A missing signing secret is 503. A bad signature is 401.

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
| `SLACK_BOT_TOKEN` | No | Permalink lookup |
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

Production is Vercel plus managed Postgres. Deploy is on hold until this API is reviewed. When you do deploy, set the env table above and run `npm run migrate` with `DATABASE_URL_MIGRATE`. Point the Slack app at `https://<host>/api/slack/events` and the GitHub webhook at `https://<host>/api/github/webhook`.

`output: "standalone"` is for the Docker image. Vercel builds Next.js itself.

## Layout

`AGENTS.md` is the agent contract. `FEATURE_MAP.md` is the route and wake reference. `main` is the default base branch.
