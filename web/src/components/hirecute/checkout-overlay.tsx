"use client";

/**
 * Screen 6 — the checkout overlay (02-screen-guide.md §8).
 *
 * A modal over the PRESERVED live workspace, blurred and inert. Not a seventh
 * screen, and not a separately compiled static background.
 *
 * What this component does NOT do, by design:
 *  - It never charges. The experiment is card setup with $30 promotional credit
 *    and $0 due today: no PaymentIntent, no subscription, no off-session path.
 *  - It never collects a card number. Milestone 7 mounts Stripe's Payment
 *    Element in the slot below; the prototype's `4242` / expiry / CVC fields are
 *    deliberately absent so a PAN cannot reach a hirecute input, log or
 *    artifact even by accident.
 *  - Save-card consent is its OWN checkbox. §8 is explicit that the
 *    prototype's "approve applying to this batch" checkbox must not be reused
 *    as silent authorization to save a card.
 *  - Closing while a confirmation is pending claims neither success nor
 *    failure; the saved billing state reconciles on reopen.
 *
 * Testimonials rotate every 7s with dots and pause/play, and pause on hover,
 * keyboard focus, hidden tab and reduced motion. They carry an explicit
 * "Illustrative example" label because no authenticated customer stories exist
 * yet — §8 forbids presenting unverified social proof as evidence.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Lock, Pause, Play, X } from "lucide-react";
import type { BillingPublicState, LaunchProfile } from "@/lib/hirecute/contracts";
import { PRESENTATION } from "@/lib/hirecute/config";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";

const TESTIMONIALS = [
  "Getting a straight read on which roles actually fit saved me a weekend of guessing.",
  "The letters started from my own experience instead of a template, which is the part I always stall on.",
  "I could see why each role was ranked where it was, and change the ones I disagreed with.",
];

function Testimonials({ reducedMotion }: { reducedMotion: boolean }) {
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
      () => setIndex((i) => (i + 1) % TESTIMONIALS.length),
      PRESENTATION.testimonialRotateMs,
    );
    return () => clearInterval(id);
  }, [paused, hidden]);

  return (
    <div
      className="rounded-lg border border-border bg-secondary/60 p-3"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(reducedMotion)}
      onFocus={() => setPaused(true)}
    >
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        &ldquo;{TESTIMONIALS[index]}&rdquo;
      </p>
      <div className="mt-2 flex items-center gap-2">
        <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          Illustrative example
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {TESTIMONIALS.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Show story ${i + 1}`}
              aria-current={i === index}
              onClick={() => setIndex(i)}
              className={cn(
                "size-1.5 rounded-full transition-colors",
                i === index ? "bg-primary" : "bg-border",
              )}
            />
          ))}
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? "Play stories" : "Pause stories"}
            className="ml-1 text-muted-foreground hover:text-foreground"
          >
            {paused ? <Play className="size-3" /> : <Pause className="size-3" />}
          </button>
        </div>
      </div>
    </div>
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const activated = billing?.status === "activated";
  const pending = billing?.status === "processing" || billing?.status === "requires_action";

  // Focus enters the modal heading; Escape closes.
  useEffect(() => {
    if (!open) return;
    headingRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Prevent background scrolling while the overlay is up.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  // Trap Tab inside the dialog.
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
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

  return (
    /* The backdrop blurs and darkens the real workspace underneath. */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: "var(--hc-overlay)" }}
      data-hc-zone="modal"
    >
      <div
        ref={dialogRef}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hc-checkout-heading"
        className="grid w-full max-w-3xl gap-0 overflow-hidden rounded-2xl border border-border bg-card shadow-xl md:grid-cols-2"
      >
        {/* ── Offer ──────────────────────────────────────────────────── */}
        <div className="border-b border-border p-5 md:border-b-0 md:border-r">
          <h2
            id="hc-checkout-heading"
            ref={headingRef}
            tabIndex={-1}
            className="font-display text-2xl leading-tight outline-none"
          >
            $30 in free credits
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {/* The true entitlement and $0 due today, before submission. */}
            Covers up to {includedPackages} {entitlementNoun}
            {selectedCount > 0 ? ` · ${selectedCount} selected now` : ""} ·{" "}
            <span className="text-foreground">$0 due today</span>
          </p>

          <ul className="mt-4 flex flex-col gap-1.5 text-[13px] text-muted-foreground">
            <li>· No charge now and no subscription</li>
            <li>· Saving a card unlocks the credits</li>
            {launchProfile === "activation_pilot" && (
              /* Honest activation-profile copy: credits unlock preparation. */
              <li>· Credits cover preparing applications, which you send yourself</li>
            )}
          </ul>

          <div className="mt-4">
            <Testimonials reducedMotion={reducedMotion} />
          </div>
        </div>

        {/* ── Card setup ─────────────────────────────────────────────── */}
        <div className="p-5">
          <div className="flex items-start justify-between gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              save a card
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>

          {activated ? (
            /* Server-confirmed only. Shown in this same overlay — no 7th screen. */
            <div className="mt-6">
              <p className="text-[15px] font-semibold text-primary">
                $30 credits unlocked · $0 charged
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Nothing has been sent to any employer.
              </p>
              <Button type="button" className="mt-4 w-full" onClick={onClose}>
                Back to your applications
              </Button>
            </div>
          ) : (
            <form
              className="mt-4 flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                onStartSetup(email);
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="hc-email" className="text-[12px]">
                  Email
                </Label>
                <Input
                  id="hc-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </div>

              {/*
                Milestone 7 mounts Stripe's Payment Element here. Until then the
                slot says what it is rather than rendering fake card inputs —
                a placeholder PAN field is exactly the thing §8 removes.
              */}
              <div className="rounded-lg border border-dashed border-border bg-secondary/40 p-3">
                <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                  <Lock className="size-3.5 shrink-0" />
                  Card details are entered directly with Stripe and never reach hirecute.
                </div>
                <div
                  id="hc-stripe-payment-element"
                  className="mt-2 text-[12px] text-muted-foreground"
                >
                  {stripeConfigured
                    ? "Loading secure card form…"
                    : "Card setup is not configured on this deployment yet."}
                </div>
              </div>

              <Label className="flex items-start gap-2 text-[12px] font-normal leading-snug text-muted-foreground">
                <Checkbox
                  checked={consent}
                  onCheckedChange={(c) => setConsent(c === true)}
                  aria-label="Save card consent"
                />
                <span>
                  Save my card to unlock $30 in credits. I understand $0 is charged today.
                </span>
              </Label>

              {billing?.error && (
                <p className="rounded-md border border-destructive/40 bg-[var(--hc-danger-soft)] px-2.5 py-1.5 text-[12px] text-destructive">
                  {billing.error.message}
                </p>
              )}

              <Button
                type="submit"
                /* Duplicate confirms are disabled while a setup is pending. */
                disabled={!consent || !email || pending || !stripeConfigured}
                className="w-full"
              >
                {pending && <Loader2 className="size-3.5 animate-spin" />}
                {pending ? "Confirming with your bank…" : "Unlock $30 in credits"}
              </Button>

              <p className="text-[11px] leading-snug text-muted-foreground">
                {billing?.mode === "live"
                  ? "Card setup only. No payment is taken."
                  : "Test mode — no real card is charged or stored."}
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
