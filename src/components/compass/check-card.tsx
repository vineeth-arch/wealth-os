import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Band } from "@/lib/compass";
import type { ReactNode } from "react";

const BAND_STYLES: Record<Band, { dot: string; text: string; ring: string; label: string }> = {
  green: { dot: "bg-emerald-500", text: "text-emerald-500", ring: "border-emerald-500/30", label: "On track" },
  amber: { dot: "bg-amber-500", text: "text-amber-500", ring: "border-amber-500/30", label: "Watch" },
  red: { dot: "bg-red-500", text: "text-red-500", ring: "border-red-500/40", label: "Act now" },
};
const NA_STYLE = { dot: "bg-muted-foreground/40", text: "text-muted-foreground", ring: "border-border", label: "Needs data" };

export function BandPill({ band }: { band: Band | null }) {
  const s = band ? BAND_STYLES[band] : NA_STYLE;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium", s.ring, s.text)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />{s.label}
    </span>
  );
}

/**
 * One Machine/Mirror check: a number, its R/A/G band, and one concrete next action.
 * `value` is pre-formatted (paise → rupees at the view boundary). band=null → insufficient data.
 */
export function CheckCard({
  tag, title, value, band, action, caption, children,
}: {
  tag: string; title: string; value: string; band: Band | null;
  action?: ReactNode; caption?: ReactNode; children?: ReactNode;
}) {
  const s = band ? BAND_STYLES[band] : NA_STYLE;
  return (
    <Card className={cn("flex h-full flex-col", band && s.ring)}>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{tag}</div>
          <div className="text-sm font-medium">{title}</div>
        </div>
        <BandPill band={band} />
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2">
        <div className={cn("text-2xl font-semibold tracking-tight", band ? s.text : "text-muted-foreground")}>{value}</div>
        {caption && <div className="text-xs text-muted-foreground">{caption}</div>}
        {children}
        {action && <div className="mt-auto pt-1 text-xs text-foreground/80">{action}</div>}
      </CardContent>
    </Card>
  );
}
