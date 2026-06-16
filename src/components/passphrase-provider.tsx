"use client";
/**
 * Holds the user's master passphrase IN MEMORY for the tab session only (never localStorage, cookies,
 * or the network). Cleared on refresh/close by nature of React state. `requestPassphrase()` returns the
 * passphrase, prompting once via a modal if the session is locked; subsequent calls reuse it silently.
 * Used by the statement-passwords settings panel (to encrypt) and the import wizard (to decrypt).
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound } from "lucide-react";

interface PassphraseContextValue {
  isUnlocked: boolean;
  /** Resolve the master passphrase, prompting once if locked. Rejects if the user cancels. */
  requestPassphrase: () => Promise<string>;
  /** Forget the in-memory passphrase (e.g. a "lock" affordance). */
  lock: () => void;
}

const PassphraseContext = createContext<PassphraseContextValue | null>(null);

type Pending = { resolve: (v: string) => void; reject: (e: Error) => void };

export function PassphraseProvider({ children }: { children: React.ReactNode }) {
  const [passphrase, setPassphrase] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [entry, setEntry] = useState("");
  const pending = useRef<Pending[]>([]);

  const settleResolve = useCallback((value: string) => {
    for (const p of pending.current) p.resolve(value);
    pending.current = [];
  }, []);
  const settleReject = useCallback(() => {
    for (const p of pending.current) p.reject(new Error("passphrase entry cancelled"));
    pending.current = [];
  }, []);

  const requestPassphrase = useCallback(() => {
    if (passphrase !== null) return Promise.resolve(passphrase);
    return new Promise<string>((resolve, reject) => {
      pending.current.push({ resolve, reject });
      setEntry("");
      setOpen(true);
    });
  }, [passphrase]);

  const lock = useCallback(() => setPassphrase(null), []);

  const submit = useCallback(() => {
    if (!entry) return;
    setPassphrase(entry);
    setOpen(false);
    settleResolve(entry);
    setEntry("");
  }, [entry, settleResolve]);

  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next && pending.current.length) settleReject(); // dismissed without submitting
  }, [settleReject]);

  const value = useMemo<PassphraseContextValue>(
    () => ({ isUnlocked: passphrase !== null, requestPassphrase, lock }),
    [passphrase, requestPassphrase, lock],
  );

  return (
    <PassphraseContext.Provider value={value}>
      {children}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Master passphrase</DialogTitle>
            <DialogDescription>
              Unlocks your saved statement passwords for this session. It never leaves your browser. If you
              forget it, saved passwords can&apos;t be recovered — you&apos;d re-enter them.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="master-passphrase">Passphrase</Label>
            <Input
              id="master-passphrase"
              type="password"
              autoFocus
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="Your master passphrase"
              autoComplete="off"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!entry}>Unlock</Button>
          </div>
        </DialogContent>
      </Dialog>
    </PassphraseContext.Provider>
  );
}

export function usePassphrase(): PassphraseContextValue {
  const ctx = useContext(PassphraseContext);
  if (!ctx) throw new Error("usePassphrase must be used within <PassphraseProvider>");
  return ctx;
}
