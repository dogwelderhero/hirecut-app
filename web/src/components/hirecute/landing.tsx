"use client";

/**
 * Screen 1 — Landing and upload (02-screen-guide.md §3).
 *
 * Preserved from the prototype: hero, drop zone, sample link, activity panel,
 * company wordmarks, feature grid, pricing explanation, FAQs.
 *
 * Changed, deliberately, because §3 requires it:
 *  - Headline language matches the ACTUAL capability. With submission disabled
 *    the hero cannot promise auto-apply or "up to 100 jobs daily"; the brief
 *    says that copy "must become preparation/assistance copy".
 *  - The activity panel carries no invented aggregates. "28,746 boards",
 *    "130 boards checked" and "19 matches" were the provider table from a one-off
 *    test, not live facts about this visitor, so the rows are non-numeric.
 *  - The processing note says the resume is processed ON THE SERVER and sent to
 *    the configured AI provider. §3 forbids claiming it stays on the device.
 *  - Company wordmarks are captioned as prospective employers, never partners.
 *  - The reference "Sign in" placeholder is gone: no login in this MVP.
 */

import { useRef, useState } from "react";
import { Upload, FileText, ArrowRight } from "lucide-react";
import type { LaunchProfile } from "@/lib/hirecute/contracts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const ACCEPTED = [".pdf", ".docx"];
const ACCEPT_MIME =
  "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Non-numeric activity rows: real product activity, no fabricated counts. */
const ACTIVITY = [
  { agent: "job explorer", status: "ready", line: "Reads public ATS boards for open roles" },
  { agent: "match agent", status: "ready", line: "Scores each role against your own resume" },
  { agent: "resume agent", status: "ready", line: "Refines your wording without adding facts" },
  { agent: "letter agent", status: "ready", line: "Drafts one letter per role from your experience" },
];

const FEATURES = [
  ["Find roles that fit", "Your resume becomes the search, not a keyword box."],
  ["See why each role ranked", "Every score cites evidence from your resume and the posting."],
  ["A letter per role", "Written from your own experience, editable before you send it."],
  ["Resume refinement", "Clearer wording and formatting. No invented facts."],
  ["Your batch, your call", "Pick the roles worth applying to. Nothing is sent automatically."],
  ["Keep the originals", "Your uploaded file is preserved and downloadable."],
] as const;

const FAQS = [
  [
    "Does hirecute apply to jobs for me?",
    "Not in this version. It prepares a tailored resume and letter for each role you select, and links you to the employer's own application form. You press the button.",
  ],
  [
    "What happens to my resume?",
    "It is uploaded to our server, and the relevant text is sent to the AI provider we have configured in order to produce your results. You can delete your run at any time.",
  ],
  [
    "Do I need an account?",
    "No. Your work is tied to this browser session.",
  ],
  [
    "What do the $30 credits cover?",
    "Preparing up to 20 applications. Saving a card unlocks them and charges $0 today. There is no subscription.",
  ],
] as const;

export function Landing({
  launchProfile,
  maxUploadBytes,
  onUpload,
  onSample,
  error,
}: {
  launchProfile: LaunchProfile;
  maxUploadBytes: number;
  onUpload: (file: File) => void;
  onSample: () => void;
  error?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  /** Client-side validation. The server validates the ACTUAL file type again. */
  function accept(file: File | undefined) {
    setLocalError(null);
    if (!file) return;
    const named = ACCEPTED.some((ext) => file.name.toLowerCase().endsWith(ext));
    if (!named) {
      setLocalError("Please choose a PDF or DOCX file.");
      return;
    }
    if (file.size > maxUploadBytes) {
      setLocalError(`That file is larger than ${Math.floor(maxUploadBytes / 1024 / 1024)} MB.`);
      return;
    }
    if (file.size === 0) {
      setLocalError("That file is empty.");
      return;
    }
    onUpload(file);
  }

  const shown = error ?? localError;

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-10">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <div className="text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[12px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-primary" /> A little help. A big next step.
        </span>

        <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
          Build a better resume.
        </h1>
        {/* The serif italic second line, from the prototype's hero. */}
        <p className="font-display mt-1 text-4xl italic leading-[1.05] text-primary sm:text-5xl">
          {launchProfile === "auto_apply_pilot"
            ? "Auto-apply to the roles that fit."
            : "Then apply to the roles that actually fit."}
        </p>

        <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          {launchProfile === "auto_apply_pilot"
            ? "Upload your resume, approve your matches, and let your agent tailor and send every application."
            : "Upload your resume. Your agent refines it, finds real openings, ranks them against your experience, and prepares a tailored resume and letter for each one you pick."}
        </p>
      </div>

      {/* ── Agent activity panel ─────────────────────────────────────── */}
      <div className="mt-8 overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="inline-flex items-center gap-2 font-mono text-[12px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-primary" /> hirecute agent
          </span>
          <span className="font-mono text-[12px] text-muted-foreground">
            next job: <span className="text-foreground">your resume</span>
          </span>
        </div>
        <ul className="divide-y divide-border">
          {ACTIVITY.map((row) => (
            <li key={row.agent} className="flex items-center gap-3 px-4 py-2.5">
              <span className="font-mono text-[12px] text-muted-foreground">{row.line}</span>
              <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[12px] whitespace-nowrap">
                <span className="size-1.5 rounded-full bg-primary" />
                <span className="text-muted-foreground">{row.agent}</span>
                <span className="text-primary">· {row.status}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Upload ───────────────────────────────────────────────────── */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          accept(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "mt-5 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border bg-card",
        )}
      >
        <FileText className="mx-auto size-5 text-muted-foreground" />
        <p className="mt-2 text-[14px]">Drop your resume here, or choose a file.</p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          PDF or DOCX, up to {Math.floor(maxUploadBytes / 1024 / 1024)} MB.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_MIME}
          className="sr-only"
          onChange={(e) => accept(e.target.files?.[0] ?? undefined)}
        />

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button type="button" onClick={() => inputRef.current?.click()}>
            <Upload className="size-3.5" /> Choose file
          </Button>
          {/* An explicitly marked sample journey, excluded from live conversion. */}
          <Button type="button" variant="outline" onClick={onSample}>
            Try a sample resume <ArrowRight className="size-3.5" />
          </Button>
        </div>

        {shown && (
          /* A failure stays beside the drop zone. There is no error screen. */
          <p
            role="alert"
            className="mx-auto mt-3 max-w-sm rounded-md border border-destructive/40 bg-[var(--hc-danger-soft)] px-2.5 py-1.5 text-[12px] text-destructive"
          >
            {shown}
          </p>
        )}

        {/* The honest processing note required by §3. */}
        <p className="mx-auto mt-4 max-w-md text-[11px] leading-snug text-muted-foreground">
          Your resume is processed on our server, and the relevant text is sent to the AI provider
          we have configured to prepare your results. You can delete your run at any time.
        </p>
      </div>

      {/* ── Prospective employers ────────────────────────────────────── */}
      <div className="mt-12 text-center">
        <p className="text-[12px] text-muted-foreground">
          Our agent helps you go after jobs at companies like
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[15px] font-semibold text-muted-foreground">
          {["Revolut", "Wise", "Monzo", "Linear", "Notion"].map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        {/* Wordmarks are not partnerships, placements or endorsements. */}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Shown as examples of employers whose public job boards we read. Not partners or
          endorsements.
        </p>
      </div>

      {/* ── Features (light "paper" section) ─────────────────────────── */}
      <div
        className="mt-12 rounded-2xl p-6"
        style={{ background: "var(--hc-paper)", color: "var(--hc-ink)" }}
      >
        <h2 className="font-display text-2xl">How it works</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([title, body]) => (
            <div
              key={title}
              className="rounded-xl p-4"
              style={{
                background: "var(--hc-paper-card)",
                border: "1px solid var(--hc-paper-line)",
              }}
            >
              <h3 className="text-[14px] font-semibold">{title}</h3>
              <p className="mt-1 text-[13px] leading-snug" style={{ color: "var(--hc-ink-muted)" }}>
                {body}
              </p>
            </div>
          ))}
        </div>

        <h2 className="font-display mt-8 text-2xl">Pricing</h2>
        <p className="mt-2 max-w-xl text-[13px] leading-relaxed" style={{ color: "var(--hc-ink-muted)" }}>
          Finding and ranking roles is free. Saving a card unlocks $30 in credits and charges $0
          today, which covers preparing up to 20 applications. No subscription and no automatic
          top-up.
        </p>

        <h2 className="font-display mt-8 text-2xl">Questions</h2>
        <div className="mt-3 flex flex-col gap-2">
          {FAQS.map(([q, a]) => (
            <details
              key={q}
              className="rounded-xl p-3"
              style={{
                background: "var(--hc-paper-card)",
                border: "1px solid var(--hc-paper-line)",
              }}
            >
              <summary className="cursor-pointer text-[13px] font-semibold">{q}</summary>
              <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: "var(--hc-ink-muted)" }}>
                {a}
              </p>
            </details>
          ))}
        </div>
      </div>

      <div className="mt-10 text-center">
        <Button type="button" size="lg" onClick={() => inputRef.current?.click()}>
          <Upload className="size-4" /> Start with your resume
        </Button>
      </div>
    </div>
  );
}
