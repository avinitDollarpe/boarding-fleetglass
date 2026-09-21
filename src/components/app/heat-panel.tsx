"use client";

import { HeatCalendar } from "@/components/charts/heat-calendar";

export function HeatPanel({
  values,
  maxCount,
  endDate,
}: {
  values: number[][];
  maxCount: number;
  endDate: string;
}) {
  return (
    <HeatCalendar
      unit="events"
      weeks={values.length}
      maxCount={Math.max(1, maxCount)}
      values={values}
      endDate={new Date(endDate)}
      color="var(--accent)"
    />
  );
}
