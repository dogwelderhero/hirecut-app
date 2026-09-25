"use client";

/**
 * The four-step progress line (02-screen-guide.md §2 "Persistent shell").
 *
 * It reflects real stage status from the run store. There are deliberately no
 * advance controls here: §1 forbids reintroducing "Preview what's next",
 * "Explore jobs now", "See my best matches" or "Preview applications now".
 * Successful work continues without asking the visitor to press Next.
 */

import type { StageId, StageState } from "@/lib/hirecute/contracts";
import { STAGE_ORDER } from "@/lib/hirecute/screens";
import { cn } from "@/lib/cn";

const STAGE_TITLES: Record<StageId, string> = {
  refine: "Finetune Resume",
  explore: "Explore Jobs",
  match: "Top matches",
  prepare: "Bulk Apply",
};

export function StageProgress({
  stages,
  visible,
  className,
}: {
  stages: Record<StageId, StageState | null>;
  /** The stage the visitor is looking at — may lag the worker during a dwell. */
  visible: StageId | null;
  className?: string;
}) {
  return (
    <nav className={cn("flex items-center gap-1", className)} aria-label="Progress">
      {STAGE_ORDER.map((stage, i) => {
        const status = stages[stage]?.status ?? "pending";
        const done = status === "completed";
        const active = visible === stage;
        const failed = status === "failed" || status === "interrupted";
        return (
          <div key={stage} className="flex min-w-0 flex-1 items-center gap-1">
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  "h-[3px] w-full rounded-full transition-colors",
                  done && "bg-primary",
                  active && !done && "bg-primary/50",
                  failed && "bg-destructive/60",
                  !done && !active && !failed && "bg-border",
                )}
              />
              <div
                className={cn(
                  "mt-1.5 truncate font-mono text-[10px] uppercase tracking-[0.1em]",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span className="tabular-nums">{i + 1}</span> {STAGE_TITLES[stage]}
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
