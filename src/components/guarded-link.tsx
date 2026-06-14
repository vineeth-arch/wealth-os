"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useBusy } from "@/components/busy-provider";
import { ConfirmDialog } from "@/components/confirm-dialog";

/**
 * A nav link that, while an operation is running, intercepts the click and asks before navigating
 * (App Router has no route-abort API — this is a guarded-link/confirm, not a router hack). The op is
 * never cancelled; on confirm we router.push the target. When idle it behaves like a plain <Link>.
 */
export function GuardedLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const router = useRouter();
  const { isBusy, label } = useBusy();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Link href={href} className={className}
        onClick={(e) => { if (isBusy) { e.preventDefault(); setOpen(true); } }}>
        {children}
      </Link>
      <ConfirmDialog
        open={open}
        title={`${label ?? "An operation"} is still running`}
        description="Leave this page anyway? It will keep running in the background — nothing is cancelled."
        onConfirm={() => { setOpen(false); router.push(href); }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
