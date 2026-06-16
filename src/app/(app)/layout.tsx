import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { BusyProvider } from "@/components/busy-provider";
import { PassphraseProvider } from "@/components/passphrase-provider";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return (
    <BusyProvider>
      <PassphraseProvider>
        <AppShell email={user.email ?? "signed in"}>{children}</AppShell>
      </PassphraseProvider>
    </BusyProvider>
  );
}
