"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { StateBadge } from "@/components/app/state-badge";
import { formatTokens, formatUsdFromMicros, formatWhen } from "@/lib/format";

type EventRow = { id: string; kind: string; fromState: string | null; toState: string | null; note: string | null; actor: string; occurredAt: Date | string };
type Subtask = { id: string; name: string; state: string; trigger: string; bcId: string | null };
type Usage = {
  id: string;
  model: string;
  agentId: string | null;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  source: string;
  occurredAt: Date | string;
};

export function TaskPanels({ events, subtasks, usage }: { events: EventRow[]; subtasks: Subtask[]; usage: Usage[] }) {
  return (
    <Tabs defaultValue="timeline" variant="underline">
      <TabsList>
        <TabsTrigger value="timeline">Timeline</TabsTrigger>
        <TabsTrigger value="subtasks">Subtasks</TabsTrigger>
        <TabsTrigger value="tokens">Tokens</TabsTrigger>
      </TabsList>
      <TabsContent value="timeline">
        <ol className="flex flex-col gap-3">
          {events.length === 0 ? <li className="text-sm text-muted-foreground">No events yet.</li> : null}
          {events.map((event) => (
            <li key={event.id} className="grid grid-cols-[140px_1fr] gap-4 text-sm">
              <time className="num text-muted-foreground">{formatWhen(event.occurredAt)}</time>
              <div>
                <div className="font-medium">{event.kind.replaceAll("_", " ")}</div>
                <div className="text-muted-foreground">
                  {event.actor}
                  {event.fromState && event.toState ? ` · ${event.fromState} → ${event.toState}` : ""}
                  {event.note ? ` · ${event.note}` : ""}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </TabsContent>
      <TabsContent value="subtasks">
        <ul className="flex flex-col gap-2">
          {subtasks.length === 0 ? <li className="text-sm text-muted-foreground">No subtasks.</li> : null}
          {subtasks.map((task) => (
            <li key={task.id}>
              <a href={`/tasks/${task.id}`} className="card flex items-center justify-between gap-3 p-3">
                <span>{task.name}</span>
                <StateBadge state={task.state} />
              </a>
            </li>
          ))}
        </ul>
      </TabsContent>
      <TabsContent value="tokens">
        <table className="w-full text-sm">
          <thead className="text-start text-muted-foreground">
            <tr>
              <th className="py-2 text-start font-medium">When</th>
              <th className="py-2 text-start font-medium">Model</th>
              <th className="py-2 text-end font-medium">In</th>
              <th className="py-2 text-end font-medium">Out</th>
              <th className="py-2 text-end font-medium">Estimate</th>
            </tr>
          </thead>
          <tbody>
            {usage.map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="py-2">{formatWhen(row.occurredAt)}</td>
                <td className="py-2">
                  {row.model}
                  <span className="ms-2 text-muted-foreground">{row.source}</span>
                </td>
                <td className="num py-2 text-end">{formatTokens(row.inputTokens)}</td>
                <td className="num py-2 text-end">{formatTokens(row.outputTokens)}</td>
                <td className="num py-2 text-end">{formatUsdFromMicros(row.costMicros)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TabsContent>
    </Tabs>
  );
}
