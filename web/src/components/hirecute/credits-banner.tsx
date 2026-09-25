"use client";

/**
 * The $30 promotional-credit banner.
 *
 * 02-screen-guide.md §6: it begins at Top Matches (visible screen 4), NOT at
 * Explore, and persists into Bulk Apply. Its CTA is manual checkout entry — it
 * is explicitly not a Next button, and it is excluded from the fourth-click
 * counter.
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
import { Button } from "@/components/ui/button";

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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5">
        <span className="text-[13px] font-semibold text-primary">
          $30 credits unlocked · $0 charged
        </span>
        <span className="text-[12px] text-muted-foreground">{entitlement}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold">
          $30 free credits — put your job search on autopilot
        </div>
        <div className="mt-0.5 text-[12px] text-muted-foreground">
          No upfront charge · {entitlement}
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        disabled={!hasRankedJob}
        onClick={onClaim}
        /* Excluded from the click counter — see checkout-counter.ts sub-rule 3. */
        data-hc-zone="credit_banner_cta"
      >
        {hasRankedJob ? "Claim $30 free credits" : "Preparing your matches"}
      </Button>
    </div>
  );
}
