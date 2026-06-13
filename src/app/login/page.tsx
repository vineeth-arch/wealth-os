"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wallet } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setMsg(null);
    const supabase = createSupabaseBrowser();
    const fn = mode === "signin"
      ? supabase.auth.signInWithPassword({ email, password })
      : supabase.auth.signUp({ email, password });
    const { error } = await fn;
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    if (mode === "signup") { setMsg("Account created. If email confirmation is on, confirm then sign in."); setMode("signin"); return; }
    router.push("/dashboard");
    router.refresh();
  }

  async function magicLink() {
    if (!email) { setMsg("Enter your email first."); return; }
    setBusy(true); setMsg(null);
    const supabase = createSupabaseBrowser();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    setMsg(error ? error.message : "Magic link sent — check your inbox.");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-2 text-primary"><Wallet className="h-6 w-6" /><span className="text-lg font-semibold">wealth-os</span></div>
          <CardTitle>{mode === "signin" ? "Sign in" : "Create your account"}</CardTitle>
          <CardDescription>Your private, import-only Wealth OS.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signin" ? "current-password" : "new-password"}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
          </div>
          {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
          <Button className="w-full" onClick={submit} disabled={busy}>{busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}</Button>
          <div className="flex items-center justify-between text-sm">
            <button className="text-muted-foreground hover:text-foreground" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
              {mode === "signin" ? "Create an account" : "Have an account? Sign in"}
            </button>
            <button className="text-muted-foreground hover:text-foreground" onClick={magicLink} disabled={busy}>Email magic link</button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
