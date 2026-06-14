"use client";
import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sparkles, Play } from "lucide-react";

export interface AiCategory { name: string; parent: string | null }
interface Suggestion { key: string; sample: string; txnIds: string[]; txnCount: number; suggestedCategory: string }

/** Grouped native select — same pattern as import/review/rules. */
function CategorySelect({ value, options, onChange }: { value: string; options: AiCategory[]; onChange: (v: string) => void }) {
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
      {groups.map(([g, names]) => (
        <optgroup key={g} label={g}>
          {names.sort().map((n) => <option key={n} value={n}>{n}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/** Heuristic stable substring for a rule, pre-filled and editable. Server normalizes authoritatively on save. */
function proposeMatch(sample: string): string {
  const norm = sample.replace(/\s+/g, " ").trim().toUpperCase();
  const tokens = norm.split(/[^A-Z0-9]+/).filter((t) => t.length >= 4 && /[A-Z]/.test(t));
  return tokens.length ? tokens.sort((a, b) => b.length - a.length)[0] : norm.slice(0, 16);
}

function SuggestionLine({ s, categories, onApplied, onError }: {
  s: Suggestion;
  categories: AiCategory[];
  onApplied: (key: string, updated: number, ruleCreated: boolean) => void;
  onError: (msg: string | null) => void;
}) {
  const [categoryName, setCategoryName] = useState(s.suggestedCategory);
  const [createRule, setCreateRule] = useState(true);
  const [matchText, setMatchText] = useState(() => proposeMatch(s.sample));
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true); onError(null);
    try {
      const res = await fetch("/api/ai/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txnIds: s.txnIds, categoryName, createRule: createRule && matchText.trim() ? { matchText } : undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "apply failed");
      onApplied(s.key, json.updated ?? 0, json.ruleCreated ?? false);
    } catch (e) { onError((e as Error).message); setBusy(false); }
  }

  return (
    <TableRow>
      <TableCell className="max-w-[20rem] align-top text-xs"><div className="whitespace-normal break-words">{s.sample}</div></TableCell>
      <TableCell className="align-top text-xs text-muted-foreground">{s.txnCount}</TableCell>
      <TableCell className="align-top"><CategorySelect value={categoryName} options={categories} onChange={setCategoryName} /></TableCell>
      <TableCell className="align-top">
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={createRule} onChange={(e) => setCreateRule(e.target.checked)} aria-label="create rule" />
          <Input value={matchText} disabled={!createRule || busy} onChange={(e) => setMatchText(e.target.value)}
            className="h-8 max-w-[12rem] text-xs uppercase" />
        </div>
      </TableCell>
      <TableCell className="align-top text-right">
        <Button size="sm" disabled={busy} onClick={confirm}>{busy ? "…" : "Confirm"}</Button>
      </TableCell>
    </TableRow>
  );
}

export function AiSuggestPanel({ categories, providerLabel }: { categories: AiCategory[]; providerLabel: string }) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);

  async function runSuggest() {
    setLoading(true); setError(null); setInfo(null); setPrompt(null);
    try {
      const res = await fetch("/api/ai/suggest", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "request failed");
      if (json.disabled) { setSuggestions([]); setInfo(json.reason ?? "AI suggestions are disabled."); }
      else {
        setSuggestions(json.suggestions ?? []);
        setModel(json.model ?? null);
        setPrompt(json.prompt || null);
        setInfo(`${json.suggested ?? 0} suggestion(s) from ${json.groups ?? 0} distinct descriptions (${json.scanned ?? 0} uncategorized transactions).`);
      }
    } catch (e) { setError((e as Error).message); }
    setLoading(false);
  }

  async function runRerun() {
    setError(null); setInfo(null);
    try {
      const res = await fetch("/api/rules/apply", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "request failed");
      setInfo(`Re-ran rules: ${json.recategorized} recategorized, ${json.remaining} still Uncategorized (of ${json.scanned} scanned).`);
    } catch (e) { setError((e as Error).message); }
  }

  function onApplied(key: string, updated: number, ruleCreated: boolean) {
    setSuggestions((ss) => ss.filter((s) => s.key !== key));
    setInfo(`Applied to ${updated} transaction(s)${ruleCreated ? " and created a rule" : ""}.`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5" /> AI category assist</CardTitle>
        <CardDescription>
          For vendors no rule matched, ask {providerLabel} for a category — only the description text is sent, never amounts,
          dates, balances or account. Confirm each suggestion; optionally save a rule so the next import is deterministic.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={runSuggest} disabled={loading}>
            <Sparkles className="h-4 w-4" /> {loading ? `Asking ${providerLabel}…` : "AI-suggest for uncategorized"}
          </Button>
          <Button size="sm" variant="outline" onClick={runRerun} disabled={loading}>
            <Play className="h-4 w-4" /> Re-run rules
          </Button>
          {model && <span className="text-xs text-muted-foreground">model: {model}</span>}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {info && <p className="text-sm text-muted-foreground">{info}</p>}
        {prompt && (
          <details className="rounded-md border p-2 text-xs">
            <summary className="cursor-pointer text-muted-foreground">Show the exact prompt sent to {providerLabel}</summary>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap">{prompt}</pre>
          </details>
        )}
        {suggestions.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="w-[56px]">Txns</TableHead>
                <TableHead className="w-[17rem]">Suggested category</TableHead>
                <TableHead className="w-[16rem]">Save rule from</TableHead>
                <TableHead className="w-[88px] text-right">Confirm</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suggestions.map((s) => (
                <SuggestionLine key={s.key} s={s} categories={categories} onApplied={onApplied} onError={setError} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
