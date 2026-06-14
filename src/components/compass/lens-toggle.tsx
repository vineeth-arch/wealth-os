import Link from "next/link";
import { cn } from "@/lib/utils";

/** Personal (Halan) vs Business (P&L) lens. URL-driven so the server renders the chosen view. */
export function LensToggle({ current }: { current: "personal" | "business" }) {
  const items = [
    { key: "personal", label: "Personal", href: "/compass" },
    { key: "business", label: "Business", href: "/compass?lens=business" },
  ] as const;
  return (
    <div className="inline-flex rounded-md border p-0.5">
      {items.map((it) => (
        <Link
          key={it.key}
          href={it.href}
          className={cn(
            "rounded px-3 py-1 text-sm font-medium transition-colors",
            current === it.key ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {it.label}
        </Link>
      ))}
    </div>
  );
}
