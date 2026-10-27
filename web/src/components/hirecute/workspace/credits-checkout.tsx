"use client";

import { useCallback, useMemo, useReducer, useRef, useState } from "react";
import type { PublicConfig } from "@/lib/hirecute/config";
import {
  checkoutCounterReducer,
  initialCheckoutCounterState,
  type ClickOrigin,
  type ClickZone,
} from "@/lib/hirecute/checkout-counter";
import type { FlowCredits } from "@/lib/hirecute/flow.mjs";
import { rankByScore } from "@/lib/hirecute/match";
import { selectedJobIds, type RunState } from "@/lib/hirecute/run-store";
import { CheckoutOverlay } from "../checkout-overlay";
import { CreditsBanner } from "../credits-banner";

/** Classify a click for the counter, from the `data-hc-*` markers screens set. */
function classifyClick(target: EventTarget | null): { zone: ClickZone; origin: ClickOrigin } {
  const el = target instanceof Element ? target : null;
  const zone =
    (el?.closest("[data-hc-zone]")?.getAttribute("data-hc-zone") as ClickZone) ?? "main_work_area";
  const labelHost = el?.closest("label");
  const markedOrigin = el?.closest("[data-hc-origin]")?.getAttribute("data-hc-origin") as
    | ClickOrigin
    | undefined;
  // A click whose target is the <label> itself is the forwarded duplicate; the
  // control's own event is the one that counts.
  const isForwardedLabel =
    !!labelHost && el !== null && el.tagName !== "INPUT" && el.tagName !== "BUTTON";
  return { zone, origin: isForwardedLabel ? "label_forwarded" : (markedOrigin ?? "blank") };
}

/**
 * The credits checkout as a shell feature (the vacancy journey's): the banner
 * above the stepper on the configured screens, the fourth-click counter on the
 * main work area, and the checkout overlay. It outlives any one screen — the
 * banner shows on Top Matches and Bulk Apply, and the counter keeps counting
 * across them — so it belongs to the shell, switched on by the flow.
 *
 * The counter is fed by one delegated handler reading the LATEST selection and
 * screen through refs (sub-rule 5's stale-closure trap).
 */
export function useCreditsCheckout({
  config,
  runState,
  screenId,
  publicConfig,
  reducedMotion,
}: {
  config: FlowCredits | undefined;
  runState: RunState;
  screenId: string;
  publicConfig: PublicConfig;
  reducedMotion: boolean;
}) {
  const [counter, dispatchCounter] = useReducer(
    (s: typeof initialCheckoutCounterState, a: Parameters<typeof checkoutCounterReducer>[1]) =>
      checkoutCounterReducer(s, a).state,
    initialCheckoutCounterState,
  );
  const [open, setOpen] = useState(false);

  const selected = selectedJobIds(runState);
  const selectionRef = useRef(selected);
  selectionRef.current = selected;
  const activatedRef = useRef(false);
  activatedRef.current = runState.billing?.status === "activated";
  const counterRef = useRef(counter);
  counterRef.current = counter;
  const screenRef = useRef(screenId);
  screenRef.current = screenId;
  const counterScreen = config?.counterScreen;

  const ranked = useMemo(() => {
    const withScores = runState.jobOrder.map((id) => ({ jobId: id, score5: runState.assessments[id]?.score5 ?? null }));
    return rankByScore(withScores).map((r) => r.jobId);
  }, [runState.jobOrder, runState.assessments]);

  /** Delegated handler on the main work area — the only counter input. */
  const onMainClick = useCallback(
    (e: React.MouseEvent) => {
      const { zone, origin } = classifyClick(e.target);
      // Let the underlying action commit first, then evaluate eligibility
      // against the settled selection.
      queueMicrotask(() => {
        const context = {
          zone,
          origin,
          onBulkApply: screenRef.current === counterScreen,
          selectedCountAfterClick: selectionRef.current.length,
          creditsActivated: activatedRef.current,
        };
        const result = checkoutCounterReducer(counterRef.current, { type: "click", context });
        counterRef.current = result.state;
        dispatchCounter({ type: "click", context });
        if (result.scheduleReveal) {
          // Scheduled for the next task, never synchronous with the gesture.
          setTimeout(() => {
            setOpen(true);
            dispatchCounter({ type: "reveal_consumed" });
          }, 0);
        }
      });
    },
    [counterScreen],
  );

  const claim = useCallback(() => {
    dispatchCounter({ type: "manual_cta" });
    setOpen(true);
  }, []);

  if (!config) return null;

  const banner = config.bannerScreens.includes(screenId) ? (
    <CreditsBanner
      launchProfile={publicConfig.launchProfile}
      includedPackages={publicConfig.maxSelectedPackages}
      hasRankedJob={ranked.some((id) => runState.assessments[id])}
      activated={runState.billing?.status === "activated"}
      onClaim={claim}
    />
  ) : null;

  const overlay = (
    <CheckoutOverlay
      open={open}
      billing={runState.billing}
      launchProfile={publicConfig.launchProfile}
      selectedCount={selected.length}
      includedPackages={publicConfig.maxSelectedPackages}
      reducedMotion={reducedMotion}
      stripeConfigured={Boolean(publicConfig.stripePublishableKey)}
      onClose={() => {
        setOpen(false);
        dispatchCounter({ type: "modal_closed" });
      }}
      onStartSetup={() => {
        /* Milestone 7 wires POST /api/hirecute/billing/setup here. */
      }}
    />
  );

  return { banner, overlay, open, claim, onMainClick };
}
