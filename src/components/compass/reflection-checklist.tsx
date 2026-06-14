"use client";
import { useState } from "react";
import { createSupabaseBrowser } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { REFLECTIONS, emptyProfile, type CompassProfile } from "@/lib/compass";
import { Check } from "lucide-react";

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * The Mirror's reflection checklist. Calm, non-scoring yes/no prompts + a goal-return assumption,
 * persisted to public.profile (RLS-scoped, one row per user). Saves on every change.
 */
export function ReflectionChecklist({ userId, initial }: { userId: string; initial: CompassProfile | null }) {
  const [profile, setProfile] = useState<CompassProfile>(initial ?? emptyProfile());
  const [save, setSave] = useState<SaveState>("idle");

  async function persist(next: CompassProfile) {
    setProfile(next);
    setSave("saving");
    const supabase = createSupabaseBrowser();
    const { error } = await supabase
      .from("profile")
      .upsert({ user_id: userId, data: next, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    setSave(error ? "error" : "saved");
  }

  function toggle(key: string, value: boolean) {
    persist({ ...profile, checklist: { ...profile.checklist, [key]: value }, asOf: new Date().toISOString().slice(0, 10) });
  }

  const saveLabel = save === "saving" ? "Saving…" : save === "saved" ? "Saved" : save === "error" ? "Couldn’t save — apply migration 0006?" : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reflection checklist</CardTitle>
        <CardDescription>
          A calm monthly/quarterly check-in — this is for reflection, not a score. No right answers; just notice.
          {saveLabel && <span className={cn("ml-2 text-xs", save === "error" ? "text-red-500" : "text-muted-foreground")}>· {saveLabel}</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          {REFLECTIONS.map(({ key, text }) => {
            const val = profile.checklist[key];
            return (
              <div key={key} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                <span className="text-sm">{text}</span>
                <div className="flex shrink-0 gap-1">
                  {([["Yes", true], ["No", false]] as const).map(([label, v]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => toggle(key, v)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                        val === v ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary",
                      )}
                    >
                      {val === v && <Check className="h-3 w-3" />}{label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <label className="text-sm text-muted-foreground" htmlFor="goal-return">Goal-return assumption</label>
          <Input
            id="goal-return"
            type="number"
            inputMode="decimal"
            value={Number.isFinite(profile.goalReturnAssumption) ? profile.goalReturnAssumption : ""}
            onChange={(e) => setProfile({ ...profile, goalReturnAssumption: Number(e.target.value) })}
            onBlur={() => persist(profile)}
            className="h-8 w-20"
          />
          <span className="text-sm text-muted-foreground">% real, used by goal planning</span>
          {profile.asOf && <span className="ml-auto text-xs text-muted-foreground">Last reviewed {profile.asOf}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
