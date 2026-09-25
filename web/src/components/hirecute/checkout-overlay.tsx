"use client";

/**
 * Screen 11 — the checkout overlay.
 *
 * Ported to the reference tree exactly: `div.hc-credit-layer` IS the dialog
 * (it carries `role="dialog"`), holding `button.hc-credit-close` and
 * `div.hc-credit-grid` > (`div.hc-credit-left` > `section.hc-credit-offer` +
 * `section.hc-credit-stories`) + `section.hc-checkout-form`.
 *
 * The blurred workspace behind it (`hc-credit-stage` / `hc-credit-background`)
 * is the caller's job — here the layer is the scrim.
 *
 * Four things the reference contains that §8 forbids shipping, each handled
 * rather than reproduced:
 *
 *  1. **Card fields.** "Card number 4242 4242 4242 4242 / 12 / 30 / 123" as
 *     read-only inputs with VISA and AMEX marks. §8: "Remove 4242, sample
 *     expiry/CVC and read-only prototype fields ... Card numbers/CVC go
 *     directly to Stripe, never into hirecute inputs, logs or run artifacts."
 *     The `hc-credit-card-input` slot is kept and reserved for Stripe's
 *     Payment Element, which also collects country. Until keys exist it says
 *     so instead of pretending.
 *  2. **Scarcity.** `hc-credit-capacity` — "Only 6 free trial spots left this
 *     hour" over a twelve-bar meter. §8 permits a capacity count "only if
 *     backed by real capacity; otherwise omit the scarcity count rather than
 *     animate a fabricated one." Omitted entirely.
 *  3. **Testimonial metrics.** `hc-story-results` — "Applications 24 /
 *     Interviews 3 / Time saved 6 hrs". Not live evidence. The carousel, the
 *     quotes and the "Illustrative example" label are kept; the figures are
 *     not, so the invented block is dropped.
 *  4. **The consent checkbox.** The reference's box reads "I approve applying
 *     to my 20 selected jobs". §8: "Do not reuse that checkbox as silent
 *     authorization to save a card. Use clear save-card consent; keep
 *     application consent separate." This is save-card consent only — with
 *     submission disabled there is no application approval to give here.
 *
 * It never charges: card setup with $30 promotional credit, $0 due today.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { BillingPublicState, LaunchProfile } from "@/lib/hirecute/contracts";
import { PRESENTATION } from "@/lib/hirecute/config";

/** Authentic stories do not exist yet, so the set carries an explicit label. */
const STORIES = [
  {
    initials: "MC",
    name: "Maya Chen",
    role: "Product Designer",
    quote:
      "I used to spend my evenings rewriting the same application. Now I review the roles I like, and my agent takes care of the repetitive part.",
  },
  {
    initials: "JL",
    name: "Jamie Lee",
    role: "Career switcher",
    quote:
      "The tailored resume helped me explain how my past experience fits a new role. I finally felt ready to put myself forward.",
  },
  {
    initials: "SK",
    name: "Sam Kim",
    role: "Software Engineer",
    quote:
      "Having my shortlist, tailored resumes and application updates in one place made the whole search feel manageable again.",
  },
] as const;

function ArrowIcon() {
  return (
    <svg
      className="hc-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 12 14 0m-6-6 6 6-6 6" />
    </svg>
  );
}

function Stories({ reducedMotion }: { reducedMotion: boolean }) {
  const [index, setIndex] = useState(0);
  // Reduced motion starts paused (§8).
  const [paused, setPaused] = useState(reducedMotion);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (paused || hidden) return;
    const id = setInterval(
      () => setIndex((i) => (i + 1) % STORIES.length),
      PRESENTATION.testimonialRotateMs,
    );
    return () => clearInterval(id);
  }, [paused, hidden]);

  return (
    <section
      className="hc-credit-card hc-credit-stories"
      aria-label="Illustrative candidate testimonials"
      aria-roledescription="carousel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(reducedMotion)}
      onFocus={() => setPaused(true)}
    >
      <div className="hc-story-top">
        <span className="hc-credit-eyebrow">CANDIDATE STORIES</span>
        <span className="hc-credit-sample">Illustrative example</span>
      </div>

      {STORIES.map((story, i) => (
        <article
          key={story.initials}
          className="hc-credit-story"
          role="group"
          aria-roledescription="slide"
          aria-label={`Story ${i + 1} of ${STORIES.length}`}
          hidden={i !== index}
        >
          <div className="hc-story-person">
            <div className="hc-story-avatar" aria-hidden="true">
              {story.initials}
            </div>
            <div>
              <h3>{story.name}</h3>
              <p>{story.role}</p>
            </div>
          </div>
          <blockquote>“{story.quote}”</blockquote>
          {/*
            `hc-story-results` ("Applications 24 / Interviews 3 / Time saved
            6 hrs") is omitted: those are not outcomes we can evidence.
          */}
        </article>
      ))}

      <div className="hc-story-controls">
        <div className="hc-story-dots" aria-label="Choose testimonial">
          {STORIES.map((story, i) => (
            <button
              key={story.initials}
              type="button"
              aria-label={`Show story ${i + 1}`}
              aria-pressed={i === index}
              onClick={() => setIndex(i)}
            >
              <i />
            </button>
          ))}
        </div>
        <button
          type="button"
          className="hc-story-pause"
          aria-pressed={paused}
          onClick={() => setPaused((p) => !p)}
        >
          <span>{paused ? "Play stories" : "Pause stories"}</span>
        </button>
      </div>
    </section>
  );
}

export function CheckoutOverlay({
  open,
  billing,
  launchProfile,
  selectedCount,
  includedPackages,
  reducedMotion,
  stripeConfigured,
  onClose,
  onStartSetup,
}: {
  open: boolean;
  billing: BillingPublicState | null;
  launchProfile: LaunchProfile;
  selectedCount: number;
  includedPackages: number;
  reducedMotion: boolean;
  /** False until an operator supplies Stripe keys; the UI says so honestly. */
  stripeConfigured: boolean;
  onClose: () => void;
  onStartSetup: (email: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const layerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const activated = billing?.status === "activated";
  const pending = billing?.status === "processing" || billing?.status === "requires_action";

  useEffect(() => {
    if (!open) return;
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  /** Trap Tab inside the layer. */
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !layerRef.current) return;
    const focusable = layerRef.current.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),textarea,select,[tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  }, []);

  if (!open) return null;

  const entitlementNoun =
    launchProfile === "auto_apply_pilot" ? "applications" : "prepared applications";
  const readyCount = selectedCount > 0 ? selectedCount : includedPackages;
  const canSubmit = consent && Boolean(email) && !pending && stripeConfigured;

  return (
    <div
      ref={layerRef}
      onKeyDown={onKeyDown}
      className="hc-credit-layer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="credit-title"
      data-hc-zone="modal"
    >
      <button
        className="hc-credit-close"
        type="button"
        onClick={onClose}
        aria-label="Close checkout and return to applications"
      >
        <svg
          className="hc-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>

      <div className="hc-credit-grid">
        <div className="hc-credit-left">
          <section className="hc-credit-card hc-credit-offer">
            <h1 id="credit-title" ref={titleRef} tabIndex={-1}>
              $30 FREE CREDITS
            </h1>
            <ul>
              <li>Find the roles that fit your experience</li>
              <li>Tailor your resume and cover letter for every job</li>
              <li>
                {launchProfile === "auto_apply_pilot"
                  ? "Approve your shortlist. Your agent handles the forms."
                  : "Approve your shortlist. Your agent prepares every application."}
              </li>
            </ul>
            <h2>A head start on your next chapter.</h2>
            <div className="hc-credit-metrics">
              <div>
                <span>Free credits</span>
                <strong>$30</strong>
              </div>
              <div>
                <span>Ready to apply</span>
                {/* Derived from the real selection, never a hardcoded 20. */}
                <strong>
                  {readyCount} {readyCount === 1 ? "job" : "jobs"}
                </strong>
              </div>
              <div>
                <span>Due today</span>
                <strong>$0</strong>
              </div>
            </div>
          </section>

          <Stories reducedMotion={reducedMotion} />
        </div>

        <section className="hc-credit-card hc-checkout-form hc-credit-form">
          {activated ? (
            /* Server-confirmed only, and shown in this same layer — no 7th screen. */
            <>
              <div className="hc-credit-reassurance">
                <strong>$30 credits unlocked · $0 charged</strong>
              </div>
              <div className="hc-credit-nocharge">
                <h2>
                  <i />
                  <span>Nothing has been sent to any employer</span>
                </h2>
                <p>
                  Your credits cover up to {includedPackages} {entitlementNoun}. You approve each
                  one.
                </p>
              </div>
              <button className="hc-button hc-credit-submit" type="button" onClick={onClose}>
                <span>Back to your applications</span>
                <ArrowIcon />
              </button>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onStartSetup(email);
              }}
            >
              <div className="hc-credit-reassurance">
                <strong>Your next move starts with $30 on us.</strong>
              </div>

              {/*
                `hc-credit-capacity` ("Only 6 free trial spots left this hour")
                is omitted — see the header note, rule 2.
              */}

              <label className="hc-field">
                <span>Email for application updates</span>
                <input
                  className="hc-input"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </label>

              <div className="hc-credit-nocharge">
                <h2>
                  <i />
                  <span>You won’t be charged today</span>
                </h2>
                <p>
                  Your $30 credits cover your first approved batch of up to {includedPackages}{" "}
                  {entitlementNoun}. When your balance runs out, choose whether to top up. No
                  automatic charges.
                </p>
              </div>

              {/*
                Stripe's Payment Element mounts here in milestone 7 and collects
                card number, expiry, CVC and country itself. The reference's own
                inputs are deliberately absent: a PAN must never reach a
                hirecute input.
              */}
              <div className="hc-credit-card-input" id="hc-stripe-payment-element">
                <span className="hc-credit-demo-note">
                  {stripeConfigured
                    ? "Loading the secure card form…"
                    : "Card setup is not configured on this deployment yet."}
                </span>
              </div>

              <div className="hc-credit-total">
                <span>Total due today</span>
                <strong>$0.00 USD</strong>
              </div>

              {/* Save-card consent ONLY — see the header note, rule 4. */}
              <label className="hc-checkbox hc-credit-consent">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>
                  Save my card to unlock $30 in credits. I understand $0 is charged today, and that
                  no applications are sent without my approval.
                </span>
              </label>

              {billing?.error && (
                <p className="hc-credit-demo-note" role="alert">
                  {billing.error.message}
                </p>
              )}

              <button
                className={`hc-button hc-credit-submit${canSubmit ? "" : " hc-button--disabled"}`}
                type="submit"
                disabled={!canSubmit}
              >
                <span>{pending ? "Confirming with your bank…" : "Unlock $30 in credits"}</span>
                <ArrowIcon />
              </button>

              <div className="hc-credit-security">
                <svg
                  className="hc-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="5" y="10" width="14" height="11" rx="3" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                </svg>
                <span>No charge today · No subscription</span>
              </div>

              <p className="hc-credit-demo-note" id="credit-demo-note">
                {billing?.mode === "live"
                  ? "Card setup only. No payment is taken today."
                  : "Test mode — no real card is charged or stored."}
              </p>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
