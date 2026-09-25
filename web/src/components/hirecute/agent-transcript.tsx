"use client";

/**
 * The left column: a chronological work transcript.
 *
 * 02-screen-guide.md §2 "Persistent shell" — this is deliberately NOT a
 * candidate-profile card. The removed "Alex Morgan / Product Designer", "Your
 * workspace / A new chapter" and "Private by default" panels do not come back.
 *
 * It contains, in order: the upload receipt with the real file name, completed
 * actions from earlier stages, one current action with an in-progress
 * indicator, and a compact saved-result receipt per successful stage.
 *
 * Actions are rendered only once they have STARTED. The future action list is
 * never printed up front, which is why this component takes `actions` straight
 * from the run store rather than a per-stage template.
 */

import { Check, Loader2, TriangleAlert, FileText } from "lucide-react";
import type { ActionProgress, StageId } from "@/lib/hirecute/contracts";
import { cn } from "@/lib/cn";

export interface StageReceipt {
  stage: StageId;
  /** Real copy built from real counts — see lib/hirecute/actions.ts. */
  label: string;
  /** Opens the persisted result read-only. Absent until the artifact exists. */
  onOpen?: () => void;
}

export function AgentTranscript({
  fileName,
  actions,
  receipts,
  queued,
  className,
}: {
  fileName: string | null;
  actions: ActionProgress[];
  receipts: StageReceipt[];
  queued: boolean;
  className?: string;
}) {
  return (
    <aside
      className={cn("flex w-full flex-col gap-3 text-sm", className)}
      aria-label="Agent activity"
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        your agent
      </div>

      {fileName && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2">
          <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          {/* The actual file name, not a placeholder. */}
          <span className="break-all text-[13px] text-muted-foreground">{fileName}</span>
        </div>
      )}

      {/*
        A genuinely queued worker says it is queued. It must never display an
        action ("Checking jobs") before that action has started.
      */}
      {queued && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-[13px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Your agent is queued
        </div>
      )}

      <ol className="flex flex-col gap-1.5">
        {actions.map((action) => (
          <li key={action.id} className="flex items-start gap-2 px-1 py-0.5">
            <span className="mt-0.5 shrink-0" aria-hidden>
              {action.status === "completed" && <Check className="size-3.5 text-primary" />}
              {action.status === "in_progress" && (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              )}
              {action.status === "failed" && (
                <TriangleAlert className="size-3.5 text-destructive" />
              )}
            </span>
            <span
              className={cn(
                "text-[13px] leading-snug",
                action.status === "completed" && "text-muted-foreground",
                action.status === "in_progress" && "text-foreground",
                action.status === "failed" && "text-destructive",
              )}
            >
              {action.label}
              {action.status === "failed" && action.error && (
                <span className="mt-0.5 block text-[12px] text-muted-foreground">
                  {action.error.message}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>

      {receipts.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {receipts.map((receipt) => (
            <li key={receipt.stage}>
              {/*
                A receipt opens the PERSISTED result in a read-only dialog. It
                never restarts work or changes the live stage, so it is a
                button, and it is disabled until the artifact exists.
              */}
              <button
                type="button"
                onClick={receipt.onOpen}
                disabled={!receipt.onOpen}
                data-hc-zone="chat_receipt"
                className={cn(
                  "w-full rounded-lg border border-border bg-card px-3 py-2 text-left text-[13px] transition-colors",
                  receipt.onOpen
                    ? "hover:border-[var(--hc-border-strong)] hover:bg-secondary"
                    : "cursor-default opacity-70",
                )}
              >
                <span className="flex items-start gap-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                  <span className="text-muted-foreground">{receipt.label}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
