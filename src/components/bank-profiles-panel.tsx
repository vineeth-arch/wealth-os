"use client";
/**
 * "Statement passwords" settings panel. Saves a PDF password per bank, encrypted in the browser with the
 * master passphrase (bank_profiles). The plaintext password never leaves the browser — only the ciphertext
 * is POSTed. A filename glob (e.g. *HDFC*statement*) lets the import wizard auto-suggest the right password.
 */
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePassphrase } from "@/components/passphrase-provider";
import { encryptPassword } from "@/lib/convert/crypto";
import { KeyRound, Plus, Pencil, Trash2, Loader2 } from "lucide-react";

interface Profile {
  id: string;
  name: string;
  filenameMatchPattern: string | null;
  passwordCiphertext: string;
  kdfSalt: string;
  kdfIterations: number;
}

export function BankProfilesPanel() {
  const { requestPassphrase } = usePassphrase();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [glob, setGlob] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/bank-profiles");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "failed to load");
      setProfiles(json.profiles as Profile[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  function openCreate() {
    setEditing(null); setName(""); setGlob(""); setPassword(""); setError(null); setOpen(true);
  }
  function openEdit(p: Profile) {
    setEditing(p); setName(p.name); setGlob(p.filenameMatchPattern ?? ""); setPassword(""); setError(null); setOpen(true);
  }

  async function save() {
    if (!name.trim()) { setError("Name is required."); return; }
    if (!editing && !password) { setError("Enter the PDF password to save."); return; }
    setSaving(true); setError(null);
    try {
      let secret: { passwordCiphertext: string; kdfSalt: string; kdfIterations: number };
      if (password) {
        const passphrase = await requestPassphrase();
        const enc = await encryptPassword(password, passphrase);
        secret = { passwordCiphertext: enc.ciphertext, kdfSalt: enc.salt, kdfIterations: enc.iterations };
      } else if (editing) {
        // Editing without changing the password: keep the stored ciphertext.
        secret = { passwordCiphertext: editing.passwordCiphertext, kdfSalt: editing.kdfSalt, kdfIterations: editing.kdfIterations };
      } else {
        setError("Enter the PDF password to save."); setSaving(false); return;
      }
      const res = await fetch("/api/bank-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), filenameMatchPattern: glob.trim() || null, ...secret }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "save failed");
      setPassword(""); setOpen(false);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: Profile) {
    if (!confirm(`Delete the saved password for "${p.name}"?`)) return;
    try {
      const res = await fetch("/api/bank-profiles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "delete failed");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" /> Statement passwords</CardTitle>
        <CardDescription>
          Save passwords for password-protected statement PDFs. Each is encrypted in your browser with a
          master passphrase and auto-suggested by filename at import. The password never leaves your browser
          in plaintext, and a forgotten master passphrase can&apos;t be recovered — you&apos;d re-enter it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Loading…</p>
        ) : profiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">No saved statement passwords yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {profiles.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {p.filenameMatchPattern ? <>matches <code>{p.filenameMatchPattern}</code></> : "no filename auto-match"} · password saved
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(p)} aria-label="Edit"><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(p)} aria-label="Delete"><Trash2 className="h-4 w-4" /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {error && !open && <p className="text-sm text-destructive">{error}</p>}
        <Button onClick={openCreate}><Plus className="h-4 w-4" /> Add statement password</Button>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit statement password" : "Add statement password"}</DialogTitle>
            <DialogDescription>Stored encrypted in your browser. Plaintext is never sent to the server.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bp-name">Bank / statement name</Label>
              <Input id="bp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="HDFC" disabled={!!editing} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bp-glob">Filename match (glob, optional)</Label>
              <Input id="bp-glob" value={glob} onChange={(e) => setGlob(e.target.value)} placeholder="*HDFC*statement*" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bp-pw">PDF password{editing ? " (leave blank to keep current)" : ""}</Label>
              <Input id="bp-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" placeholder="PDF password" />
            </div>
            {error && open && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : "Save"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
