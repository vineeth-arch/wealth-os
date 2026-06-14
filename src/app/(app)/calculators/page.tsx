import { CalculatorsHub } from "@/components/calculators-hub";

export const dynamic = "force-dynamic";

export default function CalculatorsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Calculators</h1>
        <p className="text-sm text-muted-foreground">
          India-focused planning calculators. Each surfaces its assumptions; all are educational, not financial advice.
        </p>
      </div>
      <CalculatorsHub />
    </div>
  );
}
