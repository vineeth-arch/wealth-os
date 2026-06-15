"use client";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useBusy } from "@/components/busy-provider";
import { ChevronDown, ChevronUp, Play, Trash2 } from "lucide-react";

export interface RuleCategory { name: string; parent: string | null }
export interface RuleRow { id: string; priority: number; matchText: string; categoryName: string; active: boolean; hitCount?: number | null }

/** Native grouped select — same approach as import/review (fast across hundreds of options × many rows). */
function CategorySelect({ value, options, onChange, includeBlank }: {
  value: string; options: RuleCategory[]; onChange: (v: string) => void; includeBlank?: boolean;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of options) {
      const g = c.parent ?? "—";
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(c.name);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [options]);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="h-8 w-full max-w-[16rem] rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring">
      {includeBlank && <option value="">Select category…</option>}
      {groups.map(([g, names]) => (
        <optgroup key={g} label={g}>
          {names.sort().map((n) => <option key={n} value={n}>{n}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/** Rough client-side mirror of normalizeDesc (util.ts can't be imported client-side — it pulls node:crypto). Used only to skip no-op saves; the server normalizes authoritatively. */
const roughNorm = (s: string) => s.replace(/\s+/g, " ").trim().toUpperCase();

function RuleLine({ rule, categories, isDuplicate, isFirst, isLast, onPatch, onDelete, onMove }: {
  rule: RuleRow;
  categories: RuleCategory[];
  isDuplicate: boolean;
  isFirst: boolean;
  isLast: boolean;
  onPatch: (id: string, patch: Partial<RuleRow>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onMove: (id: string, direction: "up" | "down") => Promise<void>;
}) {
  const [match, setMatch] = useState(rule.matchText);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setMatch(rule.matchText); }, [rule.matchText]); // re-sync to server-normalized value after save

  async function saveMatch() {
    if (!match.trim() || roughNorm(match) === rule.matchText) { setMatch(rule.matchText); return; }
    setBusy(true);
    await onPatch(rule.id, { matchText: match });
    setBusy(false);
  }

  return (
    <TableRow className={rule.active ? "" : "opacity-50"}>
      <TableCell>
        <div className="flex items-center gap-1">
          <div className="flex flex-col">
            <button onClick={() => onMove(rule.id, "up")} disabled={isFirst} aria-label="move rule up"
              className="text-muted-foreground hover:text-foreground disabled:opacity-30">
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => onMove(rule.id, "down")} disabled={isLast} aria-label="move rule down"
              className="text-muted-foreground hover:text-foreground disabled:opacity-30">
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">{rule.priority}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Input value={match} disabled={busy}
            onChange={(e) => setMatch(e.target.value)} onBlur={saveMatch}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className="h-8 max-w-[16rem] text-xs uppercase" />
          {isDuplicate && <Badge className="border-transparent bg-amber-500/15 text-amber-600">duplicate</Badge>}
        </div>
      </TableCell>
      <TableCell>
        <CategorySelect value={rule.categoryName} options={categories} onChange={(v) => onPatch(rule.id, { categoryName: v })} />
      </TableCell>
      <TableCell>
        <button onClick={() => onPatch(rule.id, { active: !rule.active })}
          className={cn("rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
            rule.active ? "bg-income/15 text-income" : "bg-muted text-muted-foreground hover:bg-muted/70")}>
          {rule.active ? "active" : "off"}
        </button>
      </TableCell>
      <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
        {rule.hitCount == null ? "—" : rule.hitCount}
      </TableCell>
      <TableCell className="text-right">
        <Button variant="ghost" size="sm" onClick={() => onDelete(rule.id)} aria-label="delete rule">
          <Trash2 className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function RulesManager({ rules, categories }: { rules: RuleRow[]; categories: RuleCategory[] }) {
  const [rows, setRows] = useState<RuleRow[]>(rules);
  const [matchText, setMatchText] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const { begin, end } = useBusy();

  // match_text is server-normalized (uppercased, whitespace-collapsed), so duplicates are identical
  // strings. Two rules can share a match (the constraint is on priority, not match_text); the lowest
  // priority wins and the rest are clutter to review. Recomputed from rows, so it updates live.
  const dupTexts = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of rows) count.set(r.matchText, (count.get(r.matchText) ?? 0) + 1);
    return new Set([...count.entries()].filter(([, n]) => n > 1).map(([t]) => t));
  }, [rows]);

  async function api(method: string, path: string, body?: unknown) {
    const res = await fetch(path, {
      method, headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "request failed");
    return json;
  }

  async function addRule(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setMsg(null);
    if (!matchText.trim() || !categoryName) { setError("Enter match text and pick a category."); return; }
    setBusy(true);
    const op = begin("Add rule");
    try {
      const { rule } = await api("POST", "/api/rules", { matchText, categoryName });
      setRows((rs) => [...rs, rule].sort((a, b) => a.priority - b.priority));
      setMatchText(""); setCategoryName("");
    } catch (err) { setError((err as Error).message); }
    finally { end(op); setBusy(false); }
  }

  async function patchRule(id: string, patch: Partial<RuleRow>) {
    setError(null); setMsg(null);
    const op = begin("Save rule");
    try {
      const { rule } = await api("PATCH", "/api/rules", { id, ...patch });
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch, ...rule } : r)));
    } catch (err) { setError((err as Error).message); }
    finally { end(op); }
  }

  async function deleteRule(id: string) {
    setError(null); setMsg(null);
    const op = begin("Delete rule");
    try {
      await api("DELETE", "/api/rules", { id });
      setRows((rs) => rs.filter((r) => r.id !== id));
    } catch (err) { setError((err as Error).message); }
    finally { end(op); }
  }

  async function moveRule(id: string, direction: "up" | "down") {
    setError(null); setMsg(null);
    const op = begin("Reorder rules");
    try {
      const res = await api("POST", "/api/rules/reorder", { id, direction });
      if (res.moved === false) return; // already at a boundary
      setRows((rs) => {
        const byId = new Map(rs.map((r) => [r.id, r] as const));
        for (const upd of [res.a, res.b] as Array<{ id: string; priority: number }>) {
          const r = byId.get(upd.id);
          if (r) byId.set(upd.id, { ...r, priority: upd.priority });
        }
        return [...byId.values()].sort((a, b) => a.priority - b.priority);
      });
    } catch (err) { setError((err as Error).message); }
    finally { end(op); }
  }

  async function rerun() {
    setError(null); setMsg(null); setBusy(true);
    const op = begin("Re-run rules");
    try {
      const r = await api("POST", "/api/rules/apply");
      const hits = (r.hits ?? {}) as Record<string, number>;
      setRows((rs) => rs.map((row) => (row.active ? { ...row, hitCount: hits[row.id] ?? 0 } : row)));
      setMsg(`Re-ran rules across all accounts: ${r.recategorized} newly categorized · ${r.matched} matched · ${r.remaining} still Uncategorized (of ${r.scanned} scanned).`);
    } catch (err) { setError((err as Error).message); }
    finally { end(op); setBusy(false); }
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {msg && <p className="text-sm text-income">{msg}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Add a rule</CardTitle>
          <CardDescription>
            These rules apply to <span className="font-medium text-foreground">all accounts</span>; they are
            evaluated top to bottom, <span className="font-medium text-foreground">first match wins</span>. Match
            text is normalized (uppercased, whitespace-collapsed) and matched as a substring of each
            transaction&apos;s description. Leakage (14) and Review (15) categories can&apos;t be auto-assigned —
            leakage is a tag you set at review.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={addRule} className="flex flex-wrap items-center gap-2">
            <Input value={matchText} onChange={(e) => setMatchText(e.target.value)} disabled={busy}
              placeholder="match text e.g. AMAZON" className="h-9 max-w-[18rem] uppercase" />
            <CategorySelect value={categoryName} options={categories} onChange={setCategoryName} includeBlank />
            <Button type="submit" size="sm" disabled={busy}>Add rule</Button>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {rows.filter((r) => r.active).length}/{rows.length} active
                {dupTexts.size > 0 && ` · ${dupTexts.size} duplicate match text${dupTexts.size > 1 ? "s" : ""}`}
              </span>
              <Button type="button" variant="outline" size="sm" onClick={rerun} disabled={busy}>
                <Play className="h-4 w-4" /> Re-run rules
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[96px]">Order</TableHead>
                <TableHead>Match text</TableHead>
                <TableHead className="w-[17rem]">Category</TableHead>
                <TableHead className="w-[88px]">Active</TableHead>
                <TableHead className="w-[72px] text-right">Hits</TableHead>
                <TableHead className="w-[56px] text-right">Delete</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <RuleLine key={r.id} rule={r} categories={categories} isDuplicate={dupTexts.has(r.matchText)}
                  isFirst={i === 0} isLast={i === rows.length - 1}
                  onPatch={patchRule} onDelete={deleteRule} onMove={moveRule} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
