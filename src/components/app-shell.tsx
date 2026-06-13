"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Upload, ListChecks, Landmark, Wallet, LogOut, Moon, Sun, Plug } from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/review", label: "Review", icon: ListChecks },
  { href: "/accounts", label: "Accounts", icon: Landmark },
  { href: "/integrations", label: "Integrations", icon: Plug },
];

export function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [dark, setDark] = useState(true);

  useEffect(() => { setDark(document.documentElement.classList.contains("dark")); }, []);
  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch {}
  }
  async function signOut() {
    await createSupabaseBrowser().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-card px-3 py-4 md:flex">
        <div className="flex items-center gap-2 px-2 pb-6 text-primary">
          <Wallet className="h-6 w-6" /><span className="text-lg font-semibold tracking-tight">wealth-os</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link key={href} href={href}
                className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground")}>
                <Icon className="h-4 w-4" />{label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-2 px-1">
          <div className="truncate px-2 text-xs text-muted-foreground">{email}</div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={toggleTheme}>
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}{dark ? "Light" : "Dark"}
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut}><LogOut className="h-4 w-4" /></Button>
          </div>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b bg-card/60 px-4 py-3 md:hidden">
          <div className="flex items-center gap-2 text-primary"><Wallet className="h-5 w-5" /><span className="font-semibold">wealth-os</span></div>
          <Button variant="ghost" size="sm" onClick={signOut}><LogOut className="h-4 w-4" /></Button>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b bg-card px-2 py-2 md:hidden">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link key={href} href={href}
                className={cn("flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm",
                  active ? "bg-secondary text-secondary-foreground" : "text-muted-foreground")}>
                <Icon className="h-4 w-4" />{label}
              </Link>
            );
          })}
        </nav>
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
