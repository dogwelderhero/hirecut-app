/**
 * Pure string helpers for the landing — no I/O, so client components can
 * import them (landing-content.mjs, which reads files, cannot be bundled).
 */

export const LAUNCH_PROFILES = ["activation_pilot", "auto_apply_pilot"];

export const isVariant = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v) && LAUNCH_PROFILES.every((p) => typeof v[p] === "string") &&
  Object.keys(v).every((k) => LAUNCH_PROFILES.includes(k));

/** Replace every variant object, at any depth, with the launch profile's text. */
export function resolveVariants(value, launchProfile) {
  if (isVariant(value)) return value[launchProfile];
  if (Array.isArray(value)) return value.map((v) => resolveVariants(v, launchProfile));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveVariants(v, launchProfile)]));
  }
  return value;
}

/** common ← scenario, key by key. `$comment` keys are documentation, not strings. */
export function mergeStrings(common, scenario) {
  const out = {};
  for (const src of [common, scenario]) {
    for (const [k, v] of Object.entries(src ?? {})) if (!k.startsWith("$")) out[k] = v;
  }
  return out;
}

/** "{maxMb} MB" + {maxMb: 10} → "10 MB". An unknown parameter stays visible. */
export function format(template, params = {}) {
  return String(template).replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}
