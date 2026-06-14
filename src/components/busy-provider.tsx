"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { busyReducer, BUSY_INITIAL, isBusy as computeBusy, busyLabel } from "@/lib/busy";
import { BusyBar } from "@/components/busy-bar";

interface BusyContextValue {
  /** Register an in-flight op; returns its id. Pair with end(id) in a finally. */
  begin: (label: string) => number;
  end: (id: number) => void;
  isBusy: boolean;
  /** Most-recently-started op's label, or null when idle. */
  label: string | null;
}

const BusyContext = createContext<BusyContextValue | null>(null);

export function BusyProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(busyReducer, BUSY_INITIAL);
  const seq = useRef(0);

  const begin = useCallback((label: string) => {
    const id = ++seq.current;
    dispatch({ type: "begin", id, label });
    return id;
  }, []);
  const end = useCallback((id: number) => dispatch({ type: "end", id }), []);

  const isBusy = computeBusy(state);
  const label = busyLabel(state);

  // Hard navigation (tab close / refresh / external) — native "leave site?" warning while busy only.
  useEffect(() => {
    if (!isBusy) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isBusy]);

  const value = useMemo<BusyContextValue>(() => ({ begin, end, isBusy, label }), [begin, end, isBusy, label]);

  return (
    <BusyContext.Provider value={value}>
      <BusyBar isBusy={isBusy} label={label} />
      {children}
    </BusyContext.Provider>
  );
}

export function useBusy(): BusyContextValue {
  const ctx = useContext(BusyContext);
  if (!ctx) throw new Error("useBusy must be used within <BusyProvider>");
  return ctx;
}
