"use client";

/**
 * Screen 5 — Bulk Apply (02-screen-guide.md §7).
 *
 * Layout rules this preserves:
 *  - A narrow job list INSIDE the work area (separate from the far-left agent
 *    transcript), and a wider clean letter panel.
 *  - Match percentage in a fixed translucent green circle at the card's
 *    top-right, never wrapping.
 *  - ONE readiness badge per card. No second "Ready to auto-apply" row, and no
 *    "20 selected / 18 ready / 2 wait" summary strip.
 *  - The right panel is one letter with To, Subject, editable body and a small
 *    draft status. No tabs, no "Application details & auto-apply method", no
 *    "HOW WE'LL APPLY", no "Tailored resume attached", no work-authorization
 *    callout.
 *
 * Behavioural rules:
 *  - Card click changes the letter context; checkbox click changes inclusion
 *    only; the employer link keeps its native action.
 *  - This screen never packs away or auto-advances when preparation finishes.
 *  - Readiness comes from actual artifacts/capability, never from elapsed time.
 */

import { ExternalLink, Loader2 } from "lucide-react";
import type {
  ApplicationPackage,
  Job,
  JobId,
  LaunchProfile,
  MatchAssessment,
} from "@/lib/hirecute/contracts";
import { matchPresentation, MATCH_LABEL, NOT_SCORED_LABEL } from "@/lib/hirecute/match";
import { displayText, type LetterView } from "@/lib/hirecute/letters";
import { MatchRing } from "./job-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";

/** One readiness label, derived from the package — never from a timer. */
function readinessLabel(
  pkg: ApplicationPackage | undefined,
  launchProfile: LaunchProfile,
): { text: string; tone: "neutral" | "ready" | "warn" | "bad"; busy?: boolean } {
  if (!pkg) return { text: "In your agent's queue", tone: "neutral" };
  const r = pkg.readiness;
  if (r.status === "preparing") return { text: "Preparing application…", tone: "neutral", busy: true };
  if (r.status === "failed") return { text: "Couldn't prepare", tone: "bad" };
  if (r.status === "needs_input") return { text: "Needs your input", tone: "warn" };

  // Drafts are validated. Whether that means auto-apply depends entirely on a
  // verified adapter — material readiness alone never earns the stronger label.
  if (pkg.submission.status === "confirmed") return { text: "Submitted", tone: "ready" };
  if (launchProfile === "auto_apply_pilot" && pkg.capability.kind !== "manual_only") {
    return { text: "Ready to auto-apply", tone: "ready" };
  }
  return { text: "Ready to apply", tone: "ready" };
}

const TONE_CLASS = {
  neutral: "border-border text-muted-foreground",
  ready: "border-primary/40 bg-primary/10 text-primary",
  warn: "border-[var(--hc-warning)]/40 bg-[var(--hc-warning-soft)] text-[var(--hc-warning)]",
  bad: "border-destructive/40 bg-[var(--hc-danger-soft)] text-destructive",
} as const;

export function BulkApply({
  jobs,
  applications,
  assessments,
  selectedIds,
  activeJobId,
  letters,
  launchProfile,
  preparing,
  onSelectJob,
  onToggleInclude,
  onEditLetter,
  onSaveLetter,
}: {
  jobs: Job[];
  applications: Record<JobId, ApplicationPackage>;
  assessments: Record<JobId, MatchAssessment>;
  selectedIds: JobId[];
  activeJobId: JobId | null;
  letters: Record<JobId, LetterView>;
  launchProfile: LaunchProfile;
  preparing: boolean;
  onSelectJob: (id: JobId) => void;
  onToggleInclude: (id: JobId, included: boolean) => void;
  onEditLetter: (id: JobId, text: string) => void;
  onSaveLetter: (id: JobId) => void;
}) {
  const activeJob = jobs.find((j) => j.id === activeJobId) ?? null;
  const activePkg = activeJobId ? applications[activeJobId] : undefined;
  const activeLetter = activeJobId ? letters[activeJobId] : undefined;
  const selected = new Set(selectedIds);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      {/* ── Narrow job list ───────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between px-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            your batch
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {/* Derived from the actual selection, never a replaced "20". */}
            {selectedIds.length} selected
          </span>
        </div>

        <ul className="flex flex-col gap-2">
          {jobs.map((job) => {
            const pkg = applications[job.id];
            const badge = readinessLabel(pkg, launchProfile);
            const presentation = matchPresentation(assessments[job.id]);
            const isActive = job.id === activeJobId;
            return (
              <li key={job.id}>
                {/*
                  Clicking the card selects this job's letter. The checkbox and
                  the employer link each stop propagation so they keep their own
                  action, which is the §7 acceptance check.
                */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectJob(job.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectJob(job.id);
                    }
                  }}
                  data-hc-origin="card"
                  className={cn(
                    "cursor-pointer rounded-xl border p-3 transition-colors",
                    isActive
                      ? "border-primary/50 bg-secondary"
                      : "border-border bg-card hover:border-[var(--hc-border-strong)]",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span onClick={(e) => e.stopPropagation()} data-hc-origin="input">
                      <Checkbox
                        checked={selected.has(job.id)}
                        onCheckedChange={(c) => onToggleInclude(job.id, c === true)}
                        aria-label={`Include ${job.title} at ${job.company}`}
                      />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold">{job.title}</div>
                      <div className="truncate text-[12px] text-muted-foreground">
                        {job.company}
                        {job.location ? ` · ${job.location}` : ""}
                      </div>
                    </div>

                    {/* Fixed circle, top-right, never wrapping. */}
                    {presentation ? (
                      <MatchRing percent={presentation.matchPercent} />
                    ) : (
                      <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[10px] whitespace-nowrap text-muted-foreground">
                        {NOT_SCORED_LABEL}
                      </span>
                    )}
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    {/* Exactly one readiness badge. */}
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]",
                        TONE_CLASS[badge.tone],
                      )}
                    >
                      {badge.busy && <Loader2 className="size-2.5 animate-spin" />}
                      {badge.text}
                    </span>

                    <a
                      href={job.source.applicationUrl ?? job.source.canonicalPostingUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      onClick={(e) => e.stopPropagation()}
                      data-hc-origin="link"
                      className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      Open application <ExternalLink className="size-2.5" />
                    </a>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* ── Letter panel ──────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-4">
        {!activeJob ? (
          <p className="text-[13px] text-muted-foreground">
            Select a role to read and edit its letter.
          </p>
        ) : (
          <>
            <dl className="flex flex-col gap-1 border-b border-border pb-3 text-[13px]">
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-muted-foreground">To</dt>
                {/*
                  No invented address. An unverified contact is exactly
                  "Hiring team · Company" plus "Contact not listed".
                */}
                <dd className="min-w-0">
                  {activeJob.recruiter.status === "identified" &&
                  activeJob.recruiter.email.status === "known" ? (
                    <span>{activeJob.recruiter.email.value}</span>
                  ) : (
                    <span>
                      {activeJob.recruiter.status === "unknown"
                        ? activeJob.recruiter.displayName
                        : `Hiring team · ${activeJob.company}`}
                      <span className="ml-2 text-muted-foreground">Contact not listed</span>
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-muted-foreground">Subject</dt>
                <dd className="min-w-0 truncate">
                  {activePkg?.letter.current?.subject ?? `Application: ${activeJob.title}`}
                </dd>
              </div>
            </dl>

            {activeLetter?.error && (
              <p className="mt-3 rounded-md border border-destructive/40 bg-[var(--hc-danger-soft)] px-2.5 py-1.5 text-[12px] text-destructive">
                {activeLetter.error.message}
              </p>
            )}

            <Textarea
              // Keyed by job so switching cards cannot carry one letter's
              // editor state onto another.
              key={activeJob.id}
              value={displayText(activeLetter)}
              onChange={(e) => onEditLetter(activeJob.id, e.target.value)}
              data-hc-origin="editor"
              rows={16}
              className="mt-3 resize-none font-sans text-[13px] leading-relaxed"
              aria-label={`Cover letter for ${activeJob.title} at ${activeJob.company}`}
            />

            <div className="mt-3 flex items-center gap-3">
              <Button
                type="button"
                size="sm"
                disabled={!activeLetter?.dirty}
                onClick={() => onSaveLetter(activeJob.id)}
              >
                Save draft
              </Button>
              {/* A small draft status, not a claim that anything was sent. */}
              <span className="text-[12px] text-muted-foreground">
                {activeLetter?.streaming ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="size-3 animate-spin" /> Drafting…
                  </span>
                ) : activeLetter?.dirty ? (
                  "Unsaved changes"
                ) : activeLetter?.receivedText ? (
                  "Your draft saved · Not sent"
                ) : (
                  "No draft yet"
                )}
              </span>
              {preparing && (
                <span className="ml-auto inline-flex items-center gap-1 text-[12px] text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" /> Still preparing other roles
                </span>
              )}
            </div>

            {activePkg?.readiness.status === "needs_input" && (
              /*
                Removing the large callout does not authorize guessing. This is
                a compact job-level status that keeps the job manual-only.
              */
              <p className="mt-3 rounded-md border border-[var(--hc-warning)]/40 bg-[var(--hc-warning-soft)] px-2.5 py-1.5 text-[12px] text-[var(--hc-warning)]">
                {activePkg.readiness.explanation} This role stays manual — open the employer
                application to answer it yourself.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
