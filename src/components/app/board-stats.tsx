"use client";

import { NumberTicker } from "@/components/motion/number-ticker";
import { formatTokens, formatUsdFromMicros } from "@/lib/format";

export function BoardStats({
  open,
  blocked,
  tokens,
  costMicros,
}: {
  open: number;
  blocked: number;
  tokens: number;
  costMicros: number;
}) {
  const tiles = [
    { label: "Open", value: open, format: (value: number) => String(value) },
    { label: "Plan blocked", value: blocked, format: (value: number) => String(value) },
    { label: "Tokens, 7d", value: tokens, format: formatTokens },
    { label: "Estimate, 7d", value: costMicros, format: formatUsdFromMicros },
  ];
  return (
    <dl className="grid gap-3 sm:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="card p-4">
          <dt className="text-sm text-muted-foreground">{tile.label}</dt>
          <dd className="num mt-2 text-2xl">
            <NumberTicker value={tile.value} format={tile.format} startOnView={false} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
