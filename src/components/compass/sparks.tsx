import { cn } from "@/lib/utils";

/** Magnitude bars; a zero value renders as a muted "gap" bar (used for skipped invest months). */
export function Sparkbars({ values, labels }: { values: number[]; labels?: string[] }) {
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  return (
    <div className="flex h-10 items-end gap-1">
      {values.map((v, i) => (
        <div
          key={i}
          title={labels?.[i]}
          className={cn("flex-1 rounded-sm", v === 0 ? "bg-muted" : "bg-foreground/50")}
          style={{ height: `${Math.max(2, Math.round((Math.abs(v) / max) * 40))}px` }}
        />
      ))}
    </div>
  );
}

/** Trajectory bars normalized between the series min and max, so the shape shows even on a large base. */
export function SparkTrend({ values, labels }: { values: number[]; labels?: string[] }) {
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  return (
    <div className="flex h-10 items-end gap-1">
      {values.map((v, i) => (
        <div
          key={i}
          title={labels?.[i]}
          className="flex-1 rounded-sm bg-foreground/50"
          style={{ height: `${4 + Math.round(((v - min) / span) * 36)}px` }}
        />
      ))}
    </div>
  );
}
