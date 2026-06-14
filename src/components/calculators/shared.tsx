"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const RUPEE = 100;

/** Rupee string → integer paise (0 when blank/invalid). */
export function toPaise(rupees: string): number {
  const n = Number(rupees.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * RUPEE) : 0;
}

/** Non-negative number from a string input (0 when blank/invalid). */
export function toNum(s: string): number {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function NumberField({ id, label, value, onChange, hint, placeholder, mode = "numeric" }: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  hint?: string; placeholder?: string; mode?: "numeric" | "decimal";
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} inputMode={mode} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ResultTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${accent ? "text-income" : ""}`}>{value}</div>
    </div>
  );
}

/** Assumptions list + the standard "not financial advice" note, shown under every calculator. */
export function AssumptionsCard({ items }: { items: string[] }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Assumptions</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {items.map((it, i) => <li key={i}>{it}</li>)}
        </ul>
        <p className="text-xs text-muted-foreground">Educational, not financial advice. Figures are estimates; verify before acting.</p>
      </CardContent>
    </Card>
  );
}
