"use client";

/**
 * The $30 promotional-credit banner — `section.hc-credit-banner`.
 *
 * Ported to the reference markup: the first child of `main.hc-main`, ABOVE the
 * stepper, holding `hc-credit-banner-message` (`hc-credit-banner-icon` +
 * `hc-credit-banner-copy`) and `button.hc-button.hc-credit-banner-claim`.
 *
 * 02-screen-guide.md §6: it begins at Top Matches (visible screen 4), NOT at
 * Explore, and persists into Bulk Apply. Its CTA is manual checkout entry — it
 * is explicitly not a Next button, and it is excluded from the fourth-click
 * counter (checkout-counter.ts sub-rule 3), hence the `data-hc-zone`.
 *
 * Copy depends on the launch profile. With submission disabled the entitlement
 * is prepared packages, not sent applications: the brief is explicit that
 * "For the activation pilot, 'Auto-apply to up to 100 jobs daily' must become
 * preparation/assistance copy."
 *
 * Before a real ranked job exists the CTA reads "Preparing your matches" and is
 * disabled — §6 forbids claiming against a sample batch of 20.
 */

import type { LaunchProfile } from "@/lib/hirecute/contracts";

function CardIcon() {
  return (
    <span className="hc-credit-banner-icon">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="M3 10h18M7 15h4" />
      </svg>
    </span>
  );
}

export function CreditsBanner({
  launchProfile,
  includedPackages,
  hasRankedJob,
  activated,
  onClaim,
}: {
  launchProfile: LaunchProfile;
  includedPackages: number;
  /** At least one actual ranked job must exist before claiming is possible. */
  hasRankedJob: boolean;
  activated: boolean;
  onClaim: () => void;
}) {
  const entitlement =
    launchProfile === "auto_apply_pilot"
      ? `Up to ${includedPackages} applications included`
      : `Up to ${includedPackages} prepared applications included`;

  if (activated) {
    return (
      <section className="hc-credit-banner" aria-labelledby="hc-credit-banner-title">
        <div className="hc-credit-banner-message">
          <CardIcon />
          <div className="hc-credit-banner-copy">
            <strong id="hc-credit-banner-title">$30 credits unlocked · $0 charged</strong>
            <p>{entitlement}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="hc-credit-banner" aria-labelledby="hc-credit-banner-title">
      <div className="hc-credit-banner-message">
        <CardIcon />
        <div className="hc-credit-banner-copy">
          <strong id="hc-credit-banner-title">
            $30 free credits — put your job search on autopilot
          </strong>
          <p>No upfront charge · {entitlement}</p>
        </div>
      </div>
      <button
        type="button"
        className="hc-button hc-credit-banner-claim"
        disabled={!hasRankedJob}
        onClick={onClaim}
        /* Excluded from the click counter — see checkout-counter.ts sub-rule 3. */
        data-hc-zone="credit_banner_cta"
      >
        <span>{hasRankedJob ? "Claim $30 free credits" : "Preparing your matches"}</span>
        {hasRankedJob && (
          <svg
            className="hc-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12h14m-6-6 6 6-6 6" />
          </svg>
        )}
      </button>
    </section>
  );
}
