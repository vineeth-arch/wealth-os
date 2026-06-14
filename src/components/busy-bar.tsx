"use client";

/**
 * Global indeterminate loading bar, fixed to the top of the viewport. Driven purely by the busy store
 * (ops have no percent, so the bar is indeterminate). Shows a small label pill naming the current op.
 * Rendered inside BusyProvider so it appears for every registered op automatically.
 */
export function BusyBar({ isBusy, label }: { isBusy: boolean; label: string | null }) {
  if (!isBusy) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-50" role="status" aria-live="polite">
      <div className="h-1 w-full overflow-hidden bg-primary/20">
        <div className="h-full w-1/3 rounded-full bg-primary animate-busybar" />
      </div>
      {label && (
        <div className="flex justify-center">
          <span className="mt-1 rounded-full border bg-card px-3 py-0.5 text-xs text-muted-foreground shadow-sm">
            {label}…
          </span>
        </div>
      )}
    </div>
  );
}
