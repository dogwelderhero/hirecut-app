import { test } from "node:test";
import assert from "node:assert/strict";
// Installs the "@/…" resolver hook before the dynamic import below.
import "../helpers/web-ts-alias-loader.mjs";

const {
  checkoutCounterReducer,
  initialCheckoutCounterState,
  serializeCheckoutCounter,
  deserializeCheckoutCounter,
} = await import("../../src/lib/hirecute/checkout-counter.ts");

// 02-screen-guide.md §7 "Fourth-click checkout: exact behavior to preserve".
// Each test names the sub-rule it pins.

const eligible = (over = {}) => ({
  zone: "main_work_area",
  origin: "blank",
  onBulkApply: true,
  selectedCountAfterClick: 5,
  creditsActivated: false,
  ...over,
});

/** Drive N clicks, returning the final result. */
function clicks(n, over = {}, state = initialCheckoutCounterState) {
  let result = { state, scheduleReveal: false, openNow: false };
  for (let i = 0; i < n; i += 1) {
    result = checkoutCounterReducer(result.state, { type: "click", context: eligible(over) });
  }
  return result;
}

test("three eligible clicks do not open checkout; the fourth does", () => {
  const three = clicks(3);
  assert.equal(three.state.count, 3);
  assert.equal(three.scheduleReveal, false);

  const fourth = checkoutCounterReducer(three.state, { type: "click", context: eligible() });
  assert.equal(fourth.state.count, 4);
  assert.equal(fourth.scheduleReveal, true, "fourth eligible click schedules the overlay");
  assert.equal(fourth.openNow, false, "it is scheduled for the next task, never synchronous");
});

test("sub-rule 2: sidebar, chat receipt, preview toolbar and modal clicks never count", () => {
  for (const zone of ["agent_sidebar", "chat_receipt", "preview_toolbar", "modal"]) {
    const r = clicks(6, { zone });
    assert.equal(r.state.count, 0, `${zone} must not increment`);
    assert.equal(r.scheduleReveal, false);
  }
});

test("clicks outside Bulk Apply never count", () => {
  const r = clicks(6, { onBulkApply: false });
  assert.equal(r.state.count, 0);
});

test("sub-rule 4: a label's forwarded click is ignored and the input counts once", () => {
  // One human gesture on a checkbox label produces two DOM events.
  let s = initialCheckoutCounterState;
  for (let i = 0; i < 4; i += 1) {
    s = checkoutCounterReducer(s, {
      type: "click",
      context: eligible({ origin: "label_forwarded" }),
    }).state;
    s = checkoutCounterReducer(s, { type: "click", context: eligible({ origin: "input" }) }).state;
  }
  assert.equal(s.count, 4, "four gestures counted once each, not eight");
});

test("sub-rule 3: the credit-banner CTA opens immediately and is excluded from the count", () => {
  const two = clicks(2);
  const cta = checkoutCounterReducer(two.state, { type: "manual_cta" });
  assert.equal(cta.openNow, true);
  assert.equal(cta.state.count, 2, "CTA does not increment the counter");
  assert.equal(cta.state.offerShown, true);
});

test("sub-rule 6: an empty batch suppresses the prompt and holds the count", () => {
  const r = clicks(4, { selectedCountAfterClick: 0 });
  assert.equal(r.state.count, 4);
  assert.equal(r.scheduleReveal, false, "empty selection must not open a misleading checkout");

  // A later eligible click with a non-empty batch opens it.
  const later = checkoutCounterReducer(r.state, {
    type: "click",
    context: eligible({ selectedCountAfterClick: 3 }),
  });
  assert.equal(later.scheduleReveal, true);
});

test("sub-rule 7: closing does not re-arm the automatic prompt, but the CTA still reopens", () => {
  const opened = clicks(4);
  const consumed = checkoutCounterReducer(opened.state, { type: "reveal_consumed" });
  const closed = checkoutCounterReducer(consumed.state, { type: "modal_closed" });
  assert.equal(closed.state.offerShown, true);

  // Four more eligible clicks must not reopen it.
  const after = clicks(4, {}, closed.state);
  assert.equal(after.scheduleReveal, false, "automatic prompt is spent for this journey");

  const manual = checkoutCounterReducer(after.state, { type: "manual_cta" });
  assert.equal(manual.openNow, true, "explicit CTA still works after closing");
});

test("sub-rule 8: a completed activation suppresses further claim prompts", () => {
  const r = clicks(4, { creditsActivated: true });
  assert.equal(r.scheduleReveal, false);
});

test("sub-rule 9: a re-render cannot schedule a second reveal", () => {
  const opened = clicks(4);
  assert.equal(opened.state.pendingReveal, true);
  const again = checkoutCounterReducer(opened.state, { type: "click", context: eligible() });
  assert.equal(again.scheduleReveal, false, "only one pending reveal at a time");
  assert.equal(again.state.count, 5, "the click still counts");
});

test("restart resets the counter and cancels a pending reveal", () => {
  const opened = clicks(4);
  const restarted = checkoutCounterReducer(opened.state, { type: "restart" });
  assert.deepEqual(restarted.state, initialCheckoutCounterState);
});

test("dispose cancels a pending reveal without resetting the journey count", () => {
  const opened = clicks(4);
  const disposed = checkoutCounterReducer(opened.state, { type: "dispose" });
  assert.equal(disposed.state.pendingReveal, false);
  assert.equal(disposed.state.count, 4);
});

test("sub-rule 10: count and offerShown persist across refresh; pendingReveal does not", () => {
  const opened = clicks(4);
  const consumed = checkoutCounterReducer(opened.state, { type: "reveal_consumed" });
  const restored = deserializeCheckoutCounter(serializeCheckoutCounter(consumed.state));
  assert.equal(restored.count, 4);
  assert.equal(restored.offerShown, true);
  assert.equal(
    restored.pendingReveal,
    false,
    "a timer cannot survive a reload; restoring it would open an overlay with no gesture",
  );
});

test("corrupt or absent persisted presentation state falls back to zero", () => {
  assert.deepEqual(deserializeCheckoutCounter(null), initialCheckoutCounterState);
  assert.deepEqual(deserializeCheckoutCounter("{not json"), initialCheckoutCounterState);
  assert.deepEqual(deserializeCheckoutCounter('{"count":-4}'), initialCheckoutCounterState);
});
