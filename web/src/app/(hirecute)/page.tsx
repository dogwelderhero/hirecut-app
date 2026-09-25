import { publicConfig } from "@/lib/hirecute/config";
import { HirecuteJourney } from "@/components/hirecute/journey";

/**
 * The hirecute product route (route group `(hirecute)` → `/`).
 *
 * Only public configuration crosses to the client: no paths, no secrets, and
 * the Stripe *publishable* key only. `launchProfile` is derived server-side
 * from whether a submission adapter is actually enabled, so the browser cannot
 * be told the product auto-applies when it does not.
 */
export default function HirecutePage() {
  return <HirecuteJourney publicConfig={publicConfig()} />;
}
