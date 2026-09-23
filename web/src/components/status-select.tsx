"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { CANONICAL_STATES } from "@/lib/format";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Status writeback control. Updates the existing tracker row (status cell) via
// /api/status — never adds rows. Reverts on failure; confirms with the
// terminal-popup animation.
export function StatusSelect({ n, current }: { n: string; current: string }) {
  const [status, setStatus] = useState(current);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function onValueChange(next: string) {
    const prev = status;
    setStatus(next);
    setBusy(true);
    try {
      const res = await fetch("/api/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n, status: next }),
      });
      if (!res.ok) throw new Error("write failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh();
    } catch {
      setStatus(prev); // revert on failure
    } finally {
      setBusy(false);
    }
  }

  // A tracker row can carry a non-canonical status (hand-edited, or written by
  // an older core). Keep it selectable so opening the control never silently
  // rewrites it.
  const known = (CANONICAL_STATES as readonly string[]).includes(status);
  const id = `status-${n}`;

  return (
    <span className="inline-flex items-center gap-2">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        status
      </Label>
      <Select value={status} onValueChange={onValueChange} disabled={busy}>
        <SelectTrigger id={id} size="sm" className="w-[9.5rem]">
          <SelectValue placeholder="status" />
        </SelectTrigger>
        <SelectContent>
          {!known && <SelectItem value={status}>{status}</SelectItem>}
          {CANONICAL_STATES.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {saved && (
        <span className="animate-terminal-popup inline-flex items-center gap-1 text-xs font-medium text-primary">
          <Check className="size-3" /> saved
        </span>
      )}
    </span>
  );
}
