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
    <dl className="flex flex-wrap gap-x-10 gap-y-4 border-b border-border pb-5">
      {tiles.map((tile) => (
        <div key={tile.label}>
          <dt className="text-xs text-muted-foreground">{tile.label}</dt>
          <dd className="num mt-1 text-lg">
            <NumberTicker value={tile.value} format={tile.format} startOnView={false} duration={0.16} stagger={0} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
