"use client";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { formatINR, formatINRCompact, formatMonth } from "@/lib/format";

export interface FlowPoint { month: string; income: number; spend: number; invest: number }

export function CashFlowChart({ data }: { data: FlowPoint[] }) {
  const rows = data.map((d) => ({ ...d, label: formatMonth(d.month) }));
  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis tickFormatter={(v: number) => formatINRCompact(v)} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={64} />
          <Tooltip
            formatter={(v: number, n: string) => [formatINR(v), n]}
            contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12, color: "hsl(var(--popover-foreground))" }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="income" name="Income" fill="hsl(152 60% 42%)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="spend" name="Spend" fill="hsl(0 72% 55%)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="invest" name="Invest" fill="hsl(173 58% 36%)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
