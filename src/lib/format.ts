export function formatTokens(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatUsdFromMicros(micros: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: micros >= 1_000_000 ? 2 : 4,
  }).format(micros / 1_000_000);
}

export function formatWhen(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function utcDay(value: Date = new Date()): string {
  return value.toISOString().slice(0, 10);
}
