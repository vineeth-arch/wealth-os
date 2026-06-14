import { createSupabaseServer } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HoldingsPanel } from "@/components/holdings-panel";
import { UpstoxPanel } from "@/components/upstox-panel";

export const dynamic = "force-dynamic";

export interface HoldingView {
  accountId: string;
  asOf: string;
  isin: string;
  name: string;
  symbol: string;
  assetClass: string;
  qty: number;
  avgPricePaise: number | null;
  lastPricePaise: number;
  amfiSchemeCode: string | null;
  yahooSymbol: string | null;
}

type InstrumentJoin = {
  name: string; asset_class: string; symbol: string | null;
  amfi_scheme_code: string | null; yahoo_symbol: string | null;
} | null;

export default async function HoldingsPage() {
  const supabase = await createSupabaseServer();
  const [{ data: accountsRaw }, { data: snapsRaw }] = await Promise.all([
    supabase.from("accounts").select("id,name,institution").in("institution", ["ZERODHA", "UPSTOX"]).order("name"),
    supabase.from("holdings_snapshots")
      .select("account_id,as_of,isin,qty,avg_price_paise,last_price_paise,instruments(name,asset_class,symbol,amfi_scheme_code,yahoo_symbol)")
      .order("as_of", { ascending: false }),
  ]);

  const accounts = (accountsRaw ?? []).map((a) => ({ id: a.id as string, name: a.name as string }));
  const upstoxAccounts = (accountsRaw ?? [])
    .filter((a) => (a.institution as string) === "UPSTOX")
    .map((a) => ({ id: a.id as string, name: a.name as string }));

  // latest as_of per account → current holdings
  const latestByAccount = new Map<string, string>();
  for (const s of snapsRaw ?? []) {
    const acc = s.account_id as string, asOf = s.as_of as string;
    if (!latestByAccount.has(acc) || asOf > latestByAccount.get(acc)!) latestByAccount.set(acc, asOf);
  }
  const holdings: HoldingView[] = (snapsRaw ?? [])
    .filter((s) => latestByAccount.get(s.account_id as string) === (s.as_of as string))
    .map((s) => {
      const raw = s.instruments as unknown;
      const inst = (Array.isArray(raw) ? raw[0] : raw) as InstrumentJoin;
      return {
        accountId: s.account_id as string, asOf: s.as_of as string, isin: s.isin as string,
        name: inst?.name ?? (s.isin as string), symbol: inst?.symbol ?? "",
        assetClass: inst?.asset_class ?? "equity",
        qty: Number(s.qty), avgPricePaise: (s.avg_price_paise as number | null) ?? null, lastPricePaise: s.last_price_paise as number,
        amfiSchemeCode: inst?.amfi_scheme_code ?? null, yahooSymbol: inst?.yahoo_symbol ?? null,
      };
    });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Holdings</h1>
        <p className="text-sm text-muted-foreground">
          Import your broker holdings workbook (Zerodha or Upstox). Instrument identity is the ISIN;
          mappings to price sources auto-resolve where possible and ask you to confirm the rest.
        </p>
      </div>

      {accounts.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No broker account</CardTitle>
            <CardDescription>Set up your workspace first — it creates the broker accounts (Zerodha, Upstox) this page imports into.</CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      ) : (
        <HoldingsPanel accounts={accounts} holdings={holdings} />
      )}

      {upstoxAccounts.length > 0 && (
        <div className="space-y-4 border-t pt-6">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Upstox reports</h2>
            <p className="text-sm text-muted-foreground">
              Import Upstox dividend and tax (realized capital-gains) reports. Dividends post as income
              transactions; the tax report is stored as a realized-gains record for the tax view.
            </p>
          </div>
          <UpstoxPanel accounts={upstoxAccounts} />
        </div>
      )}
    </div>
  );
}
