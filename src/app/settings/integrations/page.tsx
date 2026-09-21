import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { disconnectGithubInstall, disconnectSlackInstall, saveGithub, saveSlack } from "@/app/actions";
import { Shell } from "@/components/app/shell";
import { blankSlack, listSlack, readGithub, type SlackPublic } from "@/server/installs";
import { GITHUB_MENTION_TARGETS, GITHUB_REPO_OWNERS, SLACK_ALIASES, SLACK_HANDLE } from "@/lib/bots";
import { appOrigin } from "@/server/oauth-state";
import { readPlan } from "@/server/plan";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ slack?: string; github?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const query = await searchParams;
  const [plan, slackBots, github] = await Promise.all([
    readPlan(session.user.id),
    listSlack(session.user.id),
    readGithub(session.user.id),
  ]);
  const origin = appOrigin();
  return (
    <Shell email={session.user.email} planActive={plan.status === "active"}>
      <div className="flex max-w-2xl flex-col gap-8">
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            <Link href="/settings">Settings</Link> / Integrations
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Integrations</h1>
          <p className="text-sm text-muted-foreground">
            Each Slack bot you own is a connector on this account. The signing secret, bot token, and who may mention it are stored encrypted here, not in deploy env.
          </p>
        </div>

        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-medium">Slack</h2>
            <p className="text-sm text-muted-foreground">
              Paste the credentials from the Slack app you own. Fleetglass verifies events with that bot’s signing secret and writes the task to your account. Another user can connect a different bot to the same request URL.
            </p>
          </div>
          {query.slack === "unconfigured" ? <p className="text-sm">Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET before using Add to Slack.</p> : null}
          {query.slack === "installed" ? <p className="text-sm">Slack workspace connected. Save the signing secret and the owner allowlist on that bot.</p> : null}
          {query.slack === "error" ? <p className="text-sm">Slack install did not finish.</p> : null}
          {query.slack === "incomplete" ? <p className="text-sm">Saved, but left disabled. A live bot needs a signing secret, bot token, team id, and at least one owner Slack user id or email.</p> : null}
          {query.slack === "duplicate" ? <p className="text-sm">This account already has a bot for that team and app id.</p> : null}
          {query.slack === "missing" ? <p className="text-sm">That Slack bot is no longer on this account.</p> : null}
          <div className="flex flex-col gap-2 rounded-[8px] border border-border p-3 text-sm">
            <p className="font-medium">Event Subscriptions request URL</p>
            <p className="num break-all">{origin}/api/slack/events</p>
            <p className="text-muted-foreground">Use this URL on every bot. Slack’s url_verification challenge is checked against the signing secret saved on the matching connector.</p>
          </div>
          {slackBots.map((bot) => (
            <SlackBotForm key={bot.id} bot={bot} />
          ))}
          <SlackBotForm bot={blankSlack()} />
          <a href="/api/slack/install" className="press btn btn-quiet w-fit">
            Add to Slack
          </a>
          <p className="text-xs text-muted-foreground">Add to Slack is optional. It needs the platform OAuth client and still stores the bot token on your account. The signing secret stays a field on the connector.</p>
        </section>

        <section className="card flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium">GitHub</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                A pull request comment becomes a task when it mentions {GITHUB_MENTION_TARGETS.join(", ")} on a repo under {GITHUB_REPO_OWNERS.join(" or ")}. Idempotency is the comment id.
              </p>
            </div>
            <span className="num text-sm text-muted-foreground">{github.installed ? "Installed" : "Not installed"}</span>
          </div>
          {query.github === "unconfigured" ? <p className="text-sm">Set GITHUB_APP_SLUG before installing.</p> : null}
          {query.github === "installed" ? <p className="text-sm">GitHub App installation saved.</p> : null}
          {query.github === "error" ? <p className="text-sm">GitHub install did not finish.</p> : null}
          {github.installationId ? <p className="num text-sm">Installation {github.installationId}</p> : null}
          <div className="flex flex-wrap gap-3">
            <a href="/api/github/install" className="press btn btn-primary">
              {github.installed ? "Reconnect GitHub App" : "Install GitHub App"}
            </a>
            {github.installed ? (
              <form action={disconnectGithubInstall}>
                <button type="submit" className="press btn btn-quiet">
                  Disconnect
                </button>
              </form>
            ) : null}
          </div>
          <form action={saveGithub} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Mention targets
              <textarea name="mentionTargets" defaultValue={github.mentionTargets.join("\n")} className="field" placeholder={GITHUB_MENTION_TARGETS.join("\n")} />
            </label>
            <p className="text-xs text-muted-foreground">GitHub logins, without @. avinitDollarpe, cursor, and cursoragent are always matched. Extra logins and GITHUB_APP_SLUG are added on top.</p>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" name="enabled" defaultChecked={github.enabled} className="size-4" />
              Enabled
            </label>
            <button type="submit" className="press btn btn-quiet w-fit">
              Save GitHub targets
            </button>
          </form>
          <p className="num break-all text-xs text-muted-foreground">Webhook URL {origin}/api/github/webhook</p>
        </section>
      </div>
    </Shell>
  );
}

function SlackBotForm({ bot }: { bot: SlackPublic }) {
  return (
    <form action={saveSlack} className="card flex flex-col gap-3 p-4">
      {bot.id ? <input type="hidden" name="id" value={bot.id} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-medium">{bot.id ? bot.displayName : "Add a Slack bot"}</h3>
        <span className="num text-sm text-muted-foreground">
          {bot.installed ? "Token saved" : "No token"}
          {bot.hasSigningSecret ? " · secret saved" : ""}
          {bot.enabled ? " · enabled" : " · disabled"}
        </span>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Display name
        <input name="displayName" defaultValue={bot.displayName} className="field" maxLength={80} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Handle
        <input name="handle" defaultValue={bot.handle} className="field" placeholder={SLACK_HANDLE} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Signing secret
        <input name="signingSecret" type="password" autoComplete="new-password" className="field" placeholder={bot.signingHint ? `Saved ···${bot.signingHint}` : "From Basic Information"} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Bot token
        <input name="botToken" type="password" autoComplete="new-password" className="field" placeholder={bot.tokenHint ? `Saved ···${bot.tokenHint}` : "xoxb-…"} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Team id
        <input name="teamId" defaultValue={bot.teamId ?? ""} className="field" placeholder="T0123456789" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        App id
        <input name="apiAppId" defaultValue={bot.apiAppId ?? ""} className="field" placeholder="A0123456789" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Bot user id
        <input name="botUserId" defaultValue={bot.botUserId ?? ""} className="field" placeholder="U0123456789" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Owner Slack user ids
        <textarea name="ownerSlackUserIds" defaultValue={bot.ownerSlackUserIds.join("\n")} className="field" placeholder="U08C40K4FHN" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Owner emails
        <textarea name="ownerEmails" defaultValue={bot.ownerEmails.join("\n")} className="field" placeholder="you@company.com" />
      </label>
      <p className="text-xs text-muted-foreground">Only these Slack users can trigger the bot. Leave a secret blank to keep the saved value.</p>
      <label className="flex flex-col gap-1 text-sm">
        Aliases
        <textarea name="aliases" defaultValue={bot.aliases.join("\n")} className="field" placeholder={SLACK_ALIASES.join("\n")} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Channel allowlist
        <textarea name="channelAllowlist" defaultValue={bot.channelAllowlist.join("\n")} className="field" placeholder="*" />
      </label>
      <p className="text-xs text-muted-foreground">* or an empty allowlist accepts every channel.</p>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={bot.enabled} className="size-4" />
        Enabled
      </label>
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="press btn btn-primary">
          {bot.id ? "Save Slack bot" : "Add Slack bot"}
        </button>
        {bot.id ? (
          <button type="submit" formAction={disconnectSlackInstall} className="press btn btn-quiet">
            Disconnect
          </button>
        ) : null}
      </div>
    </form>
  );
}
