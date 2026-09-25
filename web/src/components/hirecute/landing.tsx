"use client";

/**
 * Screen 1 — Landing and upload.
 *
 * Ported from `MVP architecture and screens/hirecute-screens/screens/
 * 01-upload-resume@desktop.html`: the same structure, the same `hc-*` classes,
 * the same copy. The stylesheet is that file's own, imported by globals.css, so
 * layout, type scale, spacing and colour come from the design rather than from
 * an approximation of it.
 *
 * Two places where the reference copy is made CONDITIONAL rather than
 * reproduced verbatim, both flagged inline:
 *
 *  1. Auto-apply claims. The design promises "Auto-apply for up to 100 jobs
 *     daily" and "let your agent handle the applications". Submission is
 *     disabled (`HIRECUTE_SUBMISSION_ENABLED=false`), so today that would be a
 *     false statement to a visitor. 04-coding-agent-brief.md is explicit: "For
 *     the activation pilot, 'Auto-apply to up to 100 jobs daily' must become
 *     preparation/assistance copy." These strings therefore switch on
 *     `launchProfile`, which is derived server-side from whether an adapter is
 *     actually enabled — so the original wording returns by itself once
 *     milestone 8 ships, with no edit here.
 *  2. The agent activity panel's counts. "28,746 company boards to explore" and
 *     "130 boards checked · 19 matches" came from a one-off provider test, not
 *     from live data. 02-screen-guide.md §3 forbids carrying them over as
 *     facts. The rows keep their exact layout and use the real curated-board
 *     count instead.
 */

import { useRef, useState } from "react";
import type { LaunchProfile } from "@/lib/hirecute/contracts";
import { CURATED_BOARDS } from "@/lib/hirecute/boards.mjs";

const ACCEPT_MIME =
  "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const FEATURES = [
  [
    "Auto-apply to jobs",
    "Spend less time filling forms and more time preparing for interviews. Choose the jobs you like, approve your batch, and let your agent handle the applications.",
    // Activation-profile wording: preparation, not submission.
    "Spend less time filling forms and more time preparing for interviews. Choose the jobs you like and your agent prepares each application for you to send.",
  ],
  [
    "Smart resume optimization",
    "Give your experience the clarity it deserves. Sharpen your bullet points, surface your strongest skills, and build a resume that’s easier for people and hiring systems to read.",
    null,
  ],
  [
    "AI cover letters",
    "Start with something more personal than a blank page. Get a thoughtful introduction that connects your experience to each role, ready for your final touches.",
    null,
  ],
  [
    "AI resume tailor",
    "One career. Different opportunities. Adapt your resume to each job’s priorities and keywords, while keeping your experience and achievements true to you.",
    null,
  ],
  [
    "Set your match threshold",
    "You decide what a good fit looks like. Set a minimum match score so your agent focuses on the roles that line up with your skills and goals.",
    null,
  ],
  [
    "Job application tracker",
    "Know where every application stands. See what’s ready, what’s been submitted, and what needs your input—all in one place, without another spreadsheet.",
    "Know where every application stands. See what’s ready and what needs your input—all in one place, without another spreadsheet.",
  ],
] as const;

const CONTROL = [
  [
    "01",
    "You choose the direction.",
    "Change your preferences, skip a job, or refine your shortlist. Your next move should feel like yours.",
  ],
  [
    "02",
    "You see the work.",
    "Read the resume changes, match explanations and cover letters before making a decision.",
  ],
  [
    "03",
    "You keep the final say.",
    "Applications that need a personal answer come back to you. Your agent handles the admin; you make the calls.",
  ],
] as const;

const FAQS = [
  [
    "What do I need to get started?",
    "A PDF or DOCX resume up to 10 MB. Your agent starts refining it as soon as you upload. You can adjust job preferences while it works, or try the sample resume first.",
  ],
  [
    "What does hirecute change in my resume?",
    "The structure, wording and emphasis. The aim is to make your relevant experience easier to understand, while keeping your facts intact. You can review the original and refined versions before continuing.",
  ],
  [
    "How do I know why a job is a good match?",
    "Each match shows how your experience and preferences line up with the role, plus areas to check. A match score is a guide to fit, not a prediction that you’ll get an interview.",
  ],
  [
    "Will applications go out without my approval?",
    "No. Review your selected jobs and prepared applications first. Anything needing information only you can provide is flagged for your attention.",
  ],
  [
    "When do I pay?",
    "Preview your resume and matches for free, then activate $30 in credits for your first applications. Nothing is charged today. When your credits run out, you decide whether to top up; there are no automatic charges.",
  ],
  [
    "Does hirecute guarantee an interview or a job?",
    "No. Hiring decisions belong to employers. hirecute is designed to help you focus your search, present your experience clearly and handle repetitive application work.",
  ],
  [
    "Can I explore without sharing a resume?",
    "Yes. Choose “Try a sample resume” to see the full experience. This preview uses sample jobs and outcomes; it doesn’t upload files, take payments or submit applications.",
  ],
] as const;

const WORDMARKS = ["Revolut", "Wise", "Monzo", "Linear", "Notion"] as const;

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

  const autoApply = launchProfile === "auto_apply_pilot";
  const maxMb = Math.floor(maxUploadBytes / 1024 / 1024);

  /** Client-side validation. The server re-checks the ACTUAL file bytes. */
  function accept(file: File | undefined) {
    setLocalError(null);
    if (!file) return;
    if (!/\.(pdf|docx)$/i.test(file.name)) {
      setLocalError("Please choose a PDF or DOCX file.");
      return;
    }
    if (file.size === 0) {
      setLocalError("That file is empty.");
      return;
    }
    if (file.size > maxUploadBytes) {
      setLocalError(`That file is larger than ${maxMb} MB.`);
      return;
    }
    onUpload(file);
  }

  const shown = error ?? localError;
  const choose = () => inputRef.current?.click();

  return (
    <main className="hc-landing">
      <header className="hc-nav">
        <a className="hc-brand" href="#top">
          <span>hirecute</span>
        </a>
        <nav className="hc-navlinks">
          <a href="#how-it-works">How it works</a>
          <a href="#privacy">Your privacy</a>
          {/*
            The reference has a "Sign in" placeholder. §3: "Remove any
            functional dependency on the reference 'Sign in' placeholder; it
            must not start an authentication project." This MVP has no accounts,
            so it is not rendered at all rather than shown and broken.
          */}
        </nav>
      </header>

      <section className="hc-hero hc-hero--landing" id="top">
        <div className="hc-eyebrow">
          <i className="hc-dot" />
          <span>A little help. A big next step.</span>
        </div>
        <h1>
          <span>Build a better resume.</span>
          {/* The reference breaks the headline explicitly here. */}
          <br />
          {/*
            `hc-hero--landing h1 em` is `white-space: nowrap`, so this line
            must stay close to the original's length or it overflows the hero.
          */}
          <em>
            {autoApply ? "Auto-apply for up to 100 jobs daily." : "Then apply where you actually fit."}
          </em>
        </h1>
        <p>
          {autoApply
            ? "Upload your resume, approve your matches, and let your agent tailor and send every application."
            : "Upload your resume, approve your matches, and let your agent tailor a resume and letter for every application."}
        </p>
      </section>

      <div className="hc-upload">
        {/*
          The agent activity panel. Same rows and layout as the reference; the
          invented aggregates are replaced with what we can actually stand
          behind (§3: "Do not carry over '28,746 boards', '130 boards checked',
          '19 matches' ... as real facts").
        */}
        <section className="hc-agent-activity">
          <header className="hc-agent-header">
            <div className="hc-agent-title">
              <i className="hc-agent-dot" />
              <span>hirecute agent · ready when you are</span>
            </div>
            <div className="hc-agent-next">
              <span>next job: </span>
              <strong>your resume</strong>
            </div>
          </header>
          <div className="hc-agent-feed">
            <div className="hc-agent-row">
              <div className="hc-agent-task">
                <span className="hc-agent-marker">✓</span>
                <span>{CURATED_BOARDS.length} company boards to explore</span>
              </div>
              <div className="hc-agent-state">
                <i className="hc-agent-dot" />
                <span>job explorer · </span>
                <strong>ready</strong>
              </div>
            </div>
            <div className="hc-agent-row">
              <div className="hc-agent-task">
                <span className="hc-agent-marker">✓</span>
                <span>scores each role against your own resume</span>
              </div>
              <div className="hc-agent-state">
                <i className="hc-agent-dot" />
                <span>match agent · </span>
                <strong>ready</strong>
              </div>
            </div>
            <div className="hc-agent-row">
              <div className="hc-agent-task">
                <span className="hc-agent-marker">›</span>
                <span>refines your wording without adding facts</span>
              </div>
              <div className="hc-agent-state">
                <i className="hc-agent-dot" />
                <span>resume agent · </span>
                <strong>ready</strong>
              </div>
            </div>
            <div className="hc-agent-row">
              <div className="hc-agent-task">
                <span className="hc-agent-marker">›</span>
                <span>drafts a personal cover letter per role</span>
              </div>
              <div className="hc-agent-state">
                <i className="hc-agent-dot" />
                <span>cover letter agent · </span>
                <strong>ready</strong>
              </div>
            </div>
            <div className="hc-agent-prompt">
              <div className="hc-agent-task">
                <span className="hc-agent-marker">›</span>
                <strong>next up: your resume…</strong>
              </div>
            </div>
          </div>
        </section>

        <div
          className={`hc-drop${dragging ? " is-dragging" : ""}`}
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
        >
          <div className="hc-letter" aria-hidden />
          <div className="hc-grow">
            <h3>Drop your resume here</h3>
            <p className="hc-small hc-muted">or choose a file to get started</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_MIME}
            className="hc-visually-hidden"
            onChange={(e) => accept(e.target.files?.[0] ?? undefined)}
          />
          <button type="button" className="hc-button" onClick={choose}>
            <span>Upload resume</span>
          </button>
        </div>

        <div className="hc-upload-bottom">
          <span>PDF or DOCX · up to {maxMb} MB</span>
          <span>No account. No card. Just your next step.</span>
        </div>

        {shown && (
          /* A failure stays beside the drop zone — there is no error screen. */
          <p role="alert" className="hc-small hc-danger hc-center">
            {shown}
          </p>
        )}

        <div className="hc-center hc-landing-note">
          <span>Just looking around? </span>
          <button type="button" className="hc-button hc-button--quiet" onClick={onSample}>
            <span>Try a sample resume →</span>
          </button>
        </div>

        {/* The honest processing note §3 requires. */}
        <p className="hc-small hc-muted hc-center" id="privacy">
          Your resume is processed on our server, and the relevant text is sent to the AI provider
          we have configured to prepare your results. You can delete your run at any time.
        </p>
      </div>

      <section className="hc-startups">
        <p>Our agent helps you go after jobs at companies like</p>
        <div className="hc-startup-row">
          {WORDMARKS.map((name) => (
            <div className="hc-startup-brand" key={name}>
              <i className={`hc-startup-mark hc-logo-${name.toLowerCase()}`} aria-hidden />
              <span>{name}</span>
            </div>
          ))}
        </div>
        {/* Wordmarks are not partnerships, placements or endorsements. */}
        <p className="hc-small hc-muted">
          Shown as examples of employers whose public job boards we read. Not partners or
          endorsements.
        </p>
      </section>

      <section className="hc-land-section hc-features" id="how-it-works">
        <header className="hc-land-section-head">
          <div className="hc-land-kicker">A little less admin. A lot more possibility.</div>
          <h2>
            <span>Job hunting is a lot.</span> <em>You don’t have to do it all.</em>
          </h2>
          <p className="hc-land-lead">
            From the first resume edit to your next application, meet the tools that help you move
            forward.
          </p>
        </header>
        <div className="hc-feature-grid">
          {FEATURES.map(([title, original, assisted]) => (
            <article className="hc-feature-card" key={title}>
              <div className="hc-feature-illustration" aria-hidden />
              <h3>
                <span>{title}</span>
              </h3>
              {/* Assisted wording wins whenever submission is disabled. */}
              <span>{!autoApply && assisted ? assisted : original}</span>
            </article>
          ))}
        </div>
        <div className="hc-feature-outro">
          <p>Your experience. Your ambitions. A little help with everything in between.</p>
          <button type="button" className="hc-button" onClick={onSample}>
            <span>See your agent at work →</span>
          </button>
        </div>
      </section>

      <section className="hc-land-section hc-land-control">
        <div className="hc-land-kicker">A helping hand. You’re still in charge.</div>
        <div className="hc-land-control-grid">
          {CONTROL.map(([num, title, body]) => (
            <div key={num}>
              <span className="hc-land-control-num">{num}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="hc-land-section hc-land-pricing" id="pricing">
        <header className="hc-land-section-head">
          <div className="hc-land-kicker">See the value first</div>
          <h2>
            <span>Start with a little help.</span> <em>Make your first move on us.</em>
          </h2>
          <p className="hc-land-lead">
            Get to know your resume and your matches before you decide what comes next.
          </p>
        </header>
        <div className="hc-land-price-grid">
          <article className="hc-land-price-card">
            <span className="hc-land-badge">GET YOUR BEARINGS</span>
            <h3>Your first look</h3>
            <div className="hc-land-price">
              <strong>Free</strong>
            </div>
            <p>A clearer picture of your next move.</p>
            <ul>
              {[
                "Resume feedback and a refined preview",
                "A search based on your preferences",
                "Ranked matches with reasons for the fit",
                "An application preview before checkout",
              ].map((t) => (
                <li key={t}>
                  <span className="hc-land-tick" aria-hidden />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <button type="button" className="hc-button" onClick={choose}>
              <span>Upload resume</span>
              <span className="hc-land-arrow">→</span>
            </button>
            <p className="hc-land-price-foot">No account or card to start.</p>
          </article>

          <article className="hc-land-price-card hc-land-price-featured">
            <span className="hc-land-badge">LET’S MAKE YOUR NEXT MOVE</span>
            <h3>Your first applications</h3>
            <div className="hc-land-price">
              <strong>$30</strong>
              <span>in free credits</span>
            </div>
            <p>Start with your approved batch of up to 20 applications.</p>
            <ul>
              {[
                "The jobs you review and select",
                "A resume tailored to each role",
                "A personal cover letter for each application",
                // The reference says "Submission tracking and follow-up
                // actions", which submission-disabled cannot deliver.
                autoApply
                  ? "Submission tracking and follow-up actions"
                  : "Every package ready to download and send",
              ].map((t) => (
                <li key={t}>
                  <span className="hc-land-tick" aria-hidden />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <button type="button" className="hc-button" onClick={onSample}>
              <span>Try a sample first</span>
              <span className="hc-land-arrow">→</span>
            </button>
            <p className="hc-land-price-foot">
              $0 due today. No subscription or automatic charges.
            </p>
          </article>
        </div>
      </section>

      <section className="hc-land-section hc-land-faq" id="faqs">
        <div className="hc-land-faq-heading">
          <div className="hc-land-kicker">A few good questions</div>
          <h2>
            <span>Before your</span> <em>next chapter.</em>
          </h2>
          <p className="hc-land-lead">
            The small details that make it easier to take the first step.
          </p>
        </div>
        <div className="hc-land-questions">
          {FAQS.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="hc-land-section hc-land-finale">
        <div className="hc-land-final-card">
          <div className="hc-land-kicker">Your next chapter starts with you</div>
          <h2>
            <span>Bring your experience.</span> <em>We’ll help with what’s next.</em>
          </h2>
          <p className="hc-land-lead">
            One resume. A clearer direction. A little less doing it all yourself.
          </p>
          <div className="hc-land-final-actions">
            <button type="button" className="hc-button" onClick={choose}>
              <span>Upload resume</span>
              <span className="hc-land-arrow">→</span>
            </button>
            <button type="button" className="hc-button hc-button--quiet" onClick={onSample}>
              <span>Try a sample resume</span>
              <span className="hc-land-arrow">→</span>
            </button>
          </div>
          <p className="hc-land-final-note">Start free · No card required</p>
        </div>
      </section>

      <footer className="hc-land-footer">
        <a className="hc-brand" href="#top">
          <span>hirecute</span>
        </a>
        <p>A little help for your next big thing.</p>
        <nav>
          <a href="#how-it-works">How it works</a>
          <a href="#pricing">Pricing</a>
          <a href="#faqs">FAQs</a>
        </nav>
        <span className="hc-land-copyright">© hirecute</span>
      </footer>
    </main>
  );
}
