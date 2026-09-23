"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, History } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { WorkerCard, pillTone, TONE } from "@/components/jobs/worker-card";
import { cn } from "@/lib/cn";

// Back-compat re-exports (app/jobs/page.tsx imports pillTone from here).
export { pillTone, TONE };

// Collapsed "worker" pills in the sidebar — each the shared <WorkerCard> wrapped
// in a Link to its detail. Same component the assistant chat renders inline.
export function WorkerPills() {
  const { jobs, removeJob, clearFinished } = useJobs();
  const pathname = usePathname();
  if (jobs.length === 0) return null;
  const running = jobs.filter((j) => j.status === "running").length;
  const finished = jobs.length - running;

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Workers</span>
        {running > 0 && <span className="text-[10px] tabular-nums text-primary">{running} running</span>}
        <Link href="/jobs" className="ml-auto text-muted-foreground transition-colors hover:text-foreground" title="History" aria-label="Worker history">
          <History className="size-3.5" />
        </Link>
        {finished > 0 && (
          <button onClick={clearFinished} className="text-[10px] text-muted-foreground transition-colors hover:text-foreground" title="Clear finished">
            clear
          </button>
        )}
      </div>
      <ul className="space-y-1.5">
        {jobs.slice(0, 6).map((j) => {
          const active = pathname === `/jobs/${j.id}`;
          return (
            <li key={j.id}>
              <Link
                href={`/jobs/${j.id}`}
                className={cn(
                  "group block rounded-lg border px-2.5 py-2 transition-colors",
                  active ? "border-primary/50 bg-accent" : "border-border bg-card/60 hover:bg-accent",
                )}
              >
                <WorkerCard
                  job={j}
                  variant="tray"
                  trailing={
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        removeJob(j.id);
                      }}
                      className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                      aria-label="Dismiss job"
                    >
                      <X className="size-3" />
                    </button>
                  }
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
