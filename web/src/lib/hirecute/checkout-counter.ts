/**
 * The fourth-click checkout rule, as a pure reducer.
 *
 * 02-screen-guide.md §7 "Fourth-click checkout: exact behavior to preserve"
 * specifies ten sub-rules. They are encoded here rather than inside a React
 * component because most of them are about *not* firing: a stale closure, a
 * label forwarding its click to a checkbox, a re-render creating a second
 * timer, or an emptied batch each produce a wrong offer, and none of those are
 * observable from a screenshot.
 *
 * This counter is PRESENTATION state. It never saves a card, checks consent,
 * approves a batch or submits anything (brief: "The fourth click only opens
 * checkout"). Billing authorization lives in billing identity + idempotency.
 */

import { PRESENTATION } from "@/lib/hirecute/config";

/** Where a click landed. Only `main_work_area` is ever eligible. */
export type ClickZone =
  | "main_work_area"
  | "agent_sidebar"
  | "chat_receipt"
  | "preview_toolbar"
  | "modal"
  | "credit_banner_cta";

/**
 * Which DOM node the gesture came from. A `<label>` forwards its click to its
 * control, so the browser reports two events for one human gesture; we count
 * the control and ignore the label (sub-rule 4).
 */
export type ClickOrigin = "label_forwarded" | "input" | "card" | "link" | "editor" | "blank";

export interface CheckoutCounterState {
  /** Eligible gestures observed in Bulk Apply for this journey. */
  count: number;
  /**
   * True once the overlay has been shown from Bulk Apply, manually or
   * automatically. Closing does NOT clear it, so the automatic prompt cannot
   * re-arm (sub-rule 7).
   */
  offerShown: boolean;
  /** A reveal scheduled for the next task; cancelled on restart/dispose. */
  pendingReveal: boolean;
}

export const initialCheckoutCounterState: CheckoutCounterState = {
  count: 0,
  offerShown: false,
  pendingReveal: false,
};

export interface ClickContext {
  zone: ClickZone;
  origin: ClickOrigin;
  /** Bulk Apply must be the current screen; its working→ready phase is irrelevant. */
  onBulkApply: boolean;
  /**
   * Selection size AFTER the click's own effect is applied. Sub-rule 5 requires
   * the underlying change to commit first, so callers must read the latest
   * selection store rather than a stale closure.
   */
  selectedCountAfterClick: number;
  /** Suppress the automatic prompt once credits are actually granted (sub-rule 8). */
  creditsActivated: boolean;
}

export type CheckoutCounterAction =
  | { type: "click"; context: ClickContext }
  | { type: "manual_cta" }
  | { type: "reveal_consumed" }
  | { type: "modal_closed" }
  | { type: "restart" }
  | { type: "dispose" };

export interface CheckoutCounterResult {
  state: CheckoutCounterState;
  /** Open the overlay on the next task. Never synchronous with the gesture. */
  scheduleReveal: boolean;
  /** Open the overlay immediately (explicit CTA). */
  openNow: boolean;
}

function isEligible(ctx: ClickContext): boolean {
  if (!ctx.onBulkApply) return false;
  // Sub-rules 2 and 3: only the main work area counts; the banner CTA opens
  // immediately and is excluded from the count entirely.
  if (ctx.zone !== "main_work_area") return false;
  // Sub-rule 4: the label's forwarded duplicate is dropped, the input counts.
  if (ctx.origin === "label_forwarded") return false;
  return true;
}

export function checkoutCounterReducer(
  state: CheckoutCounterState,
  action: CheckoutCounterAction,
): CheckoutCounterResult {
  const idle = { state, scheduleReveal: false, openNow: false };

  switch (action.type) {
    case "click": {
      const ctx = action.context;
      if (!isEligible(ctx)) return idle;

      const count = state.count + 1;

      // Sub-rule 8: a completed activation suppresses further claim prompts.
      // Sub-rule 7: the automatic prompt fires at most once per journey.
      if (state.offerShown || ctx.creditsActivated) {
        return { state: { ...state, count }, scheduleReveal: false, openNow: false };
      }

      const atThreshold = count >= PRESENTATION.checkoutClickThreshold;

      // Sub-rule 6: if the fourth click emptied the batch, hold the count and
      // defer — a later eligible click with a non-empty batch opens it. An
      // empty batch must never open a misleading checkout.
      if (!atThreshold || ctx.selectedCountAfterClick < 1) {
        return { state: { ...state, count }, scheduleReveal: false, openNow: false };
      }

      // Sub-rule 9: one pending reveal at a time, so a re-render cannot create
      // a duplicate timer.
      if (state.pendingReveal) {
        return { state: { ...state, count }, scheduleReveal: false, openNow: false };
      }

      return {
        state: { ...state, count, pendingReveal: true },
        scheduleReveal: true,
        openNow: false,
      };
    }

    // Sub-rule 3: explicit CTA opens immediately and does not touch the count.
    // It still marks the offer as shown, which is what disarms the automatic
    // prompt for the rest of the journey.
    case "manual_cta":
      return {
        state: { ...state, offerShown: true, pendingReveal: false },
        scheduleReveal: false,
        openNow: true,
      };

    /** The scheduled overlay actually mounted. */
    case "reveal_consumed":
      return {
        state: { ...state, offerShown: true, pendingReveal: false },
        scheduleReveal: false,
        openNow: false,
      };

    // Sub-rule 7: closing does not re-arm. offerShown deliberately stays true.
    case "modal_closed":
      return { state: { ...state, pendingReveal: false }, scheduleReveal: false, openNow: false };

    // Sub-rules 1 and 9: a new journey resets; a pending reveal is cancelled.
    case "restart":
      return { state: { ...initialCheckoutCounterState }, scheduleReveal: false, openNow: false };

    case "dispose":
      return { state: { ...state, pendingReveal: false }, scheduleReveal: false, openNow: false };
  }
}

/**
 * Sub-rule 10: the counter and offer-shown flag persist for the owned journey
 * across refresh. This is presentation state, so sessionStorage keyed by run is
 * the right home — it is explicitly NOT billing authorization.
 */
export function checkoutCounterStorageKey(runId: string): string {
  return `hirecute:checkout-presentation:${runId}`;
}

export function serializeCheckoutCounter(state: CheckoutCounterState): string {
  // pendingReveal is intentionally dropped: a timer cannot survive a reload,
  // and restoring it would open an overlay with no originating gesture.
  return JSON.stringify({ count: state.count, offerShown: state.offerShown });
}

export function deserializeCheckoutCounter(raw: string | null): CheckoutCounterState {
  if (!raw) return { ...initialCheckoutCounterState };
  try {
    const parsed = JSON.parse(raw) as Partial<CheckoutCounterState>;
    return {
      count: Number.isInteger(parsed.count) && parsed.count! >= 0 ? parsed.count! : 0,
      offerShown: parsed.offerShown === true,
      pendingReveal: false,
    };
  } catch {
    return { ...initialCheckoutCounterState };
  }
}
