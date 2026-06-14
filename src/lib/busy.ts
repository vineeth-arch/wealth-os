/**
 * Pure busy-state store for the global "an operation is running" guard. No React here so the gate can
 * test it directly. A count-based model (one entry per in-flight op) handles concurrent/nested ops;
 * `end` of an unknown id is a no-op, so the count can never go negative.
 */

export interface BusyOp { id: number; label: string }
export interface BusyState { ops: BusyOp[] }

export type BusyAction =
  | { type: "begin"; id: number; label: string }
  | { type: "end"; id: number };

export const BUSY_INITIAL: BusyState = { ops: [] };

export function busyReducer(state: BusyState, action: BusyAction): BusyState {
  switch (action.type) {
    case "begin":
      return { ops: [...state.ops, { id: action.id, label: action.label }] };
    case "end": {
      const ops = state.ops.filter((o) => o.id !== action.id);
      return ops.length === state.ops.length ? state : { ops }; // unknown id → no-op (count never negative)
    }
  }
}

export function isBusy(state: BusyState): boolean {
  return state.ops.length > 0;
}

/** Most-recently-started op's label (what the UI names), or null when idle. */
export function busyLabel(state: BusyState): string | null {
  return state.ops.length ? state.ops[state.ops.length - 1].label : null;
}
