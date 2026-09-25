/**
 * The curated board list for bounded discovery.
 *
 * 04-coding-agent-brief.md milestone 4: "Use curated relevant
 * Greenhouse/Lever/Ashby boards, explicit region/role defaults and bounded
 * provider work ... **Do not run the entire ATS company directory on every
 * upload.**"
 *
 * That constraint also sidesteps a real dependency problem: `scan-ats-full.mjs`
 * pulls its 28,746-company index from a third party's unversioned GitHub repo.
 * A curated list is a file we own, versioned with the product, and the scope
 * claim we make to a visitor ("N boards") is then literally true.
 *
 * Each entry is a `PortalEntry` in the shape `providers/_types.js` documents,
 * so it can be handed straight to a provider module. `provider` is set
 * explicitly rather than left to `detect()`, so a board silently changing
 * vendor shows up as an error instead of quietly resolving elsewhere.
 */

/** @typedef {{name: string, provider: string, careers_url: string, api?: string, enabled?: boolean}} Board */

/**
 * UK/EU product and engineering boards on the three ATS vendors we support.
 *
 * Deliberately modest. Adding a board is a one-line change; claiming coverage
 * we have not verified is not. Each `careers_url` is the vendor-hosted board,
 * which is what the provider modules parse — not the company's marketing
 * careers page.
 */
export const CURATED_BOARDS = [
  // ── Greenhouse ────────────────────────────────────────────────────────
  // Fintech / payments
  { name: "Monzo", provider: "greenhouse", careers_url: "https://job-boards.greenhouse.io/monzo" },
  { name: "Wise", provider: "greenhouse", careers_url: "https://job-boards.greenhouse.io/wise" },
  { name: "GoCardless", provider: "greenhouse", careers_url: "https://job-boards.greenhouse.io/gocardless" },
  { name: "Stripe", provider: "greenhouse", careers_url: "https://job-boards.greenhouse.io/stripe" },
  { name: "Coinbase", provider: "greenhouse", careers_url: "https://job-boards.greenhouse.io/coinbase" },
  { name: "Robinhood", provider: "greenhouse", careers_url: "https://job-boards.greenhouse.io/robinhood" },
  // Consumer / marketplace
  { name: "Airbnb", provider: "greenhouse", careers_url: "https://job-boards.greenhouse.io/airbnb" },
  { name: "Pinterest", provider: "greenhouse", careers_url: "https://job-boards.greenhouse.io/pinterest" },
  { name: "Reddit", provider: "greenhouse", careers_url: "https://job-boards.greenhouse.io/reddit" },
  { name: "Discord", provider: "greenhouse", careers_url: "https://job-boards.greenhouse.io/discord" },
  { name: "Duolingo", provider: "greenhouse", careers_url: "https://job-boards.greenhouse.io/duolingo" },
  { name: "Instacart", provider: "greenhouse", careers_url: "https://job-boards.greenhouse.io/instacart" },
  // Productivity / SaaS
  { name: "Dropbox", provider: "greenhouse", careers_url: "https://job-boards.greenhouse.io/dropbox" },
  { name: "Asana", provider: "greenhouse", careers_url: "https://job-boards.greenhouse.io/asana" },
  { name: "Figma", provider: "greenhouse", careers_url: "https://job-boards.greenhouse.io/figma" },
  // Infrastructure / AI / data
  { name: "Cloudflare", provider: "greenhouse", careers_url: "https://job-boards.greenhouse.io/cloudflare" },
  { name: "Anthropic", provider: "greenhouse", careers_url: "https://job-boards.greenhouse.io/anthropic" },
  { name: "Databricks", provider: "greenhouse", careers_url: "https://job-boards.greenhouse.io/databricks" },
  // Logistics / industrial / health
  { name: "Flexport", provider: "greenhouse", careers_url: "https://job-boards.greenhouse.io/flexport" },
  { name: "Samsara", provider: "greenhouse", careers_url: "https://job-boards.greenhouse.io/samsara" },
  { name: "Zocdoc", provider: "greenhouse", careers_url: "https://job-boards.greenhouse.io/zocdoc" },

  // ── Lever ─────────────────────────────────────────────────────────────
  { name: "Spotify", provider: "lever", careers_url: "https://jobs.lever.co/spotify" },
  { name: "Palantir", provider: "lever", careers_url: "https://jobs.lever.co/palantir" },
  { name: "Mistral AI", provider: "lever", careers_url: "https://jobs.lever.co/mistral" },

  // ── Ashby ─────────────────────────────────────────────────────────────
  // Note: Deel and Ramp are on Ashby, not Greenhouse/Lever. Setting
  // `provider` explicitly is what surfaced that as a 404 instead of letting
  // detect() quietly find nothing.
  { name: "OpenAI", provider: "ashby", careers_url: "https://jobs.ashbyhq.com/openai" },
  { name: "Notion", provider: "ashby", careers_url: "https://jobs.ashbyhq.com/notion" },
  { name: "Deel", provider: "ashby", careers_url: "https://jobs.ashbyhq.com/deel" },
  { name: "Ramp", provider: "ashby", careers_url: "https://jobs.ashbyhq.com/ramp" },
  { name: "Linear", provider: "ashby", careers_url: "https://jobs.ashbyhq.com/linear" },
  { name: "Vercel", provider: "ashby", careers_url: "https://jobs.ashbyhq.com/vercel" },
  { name: "PostHog", provider: "ashby", careers_url: "https://jobs.ashbyhq.com/posthog" },
  { name: "Replit", provider: "ashby", careers_url: "https://jobs.ashbyhq.com/replit" },
  { name: "Modal", provider: "ashby", careers_url: "https://jobs.ashbyhq.com/modal" },
  { name: "Cursor", provider: "ashby", careers_url: "https://jobs.ashbyhq.com/cursor" },
  { name: "Clerk", provider: "ashby", careers_url: "https://jobs.ashbyhq.com/clerk" },
  { name: "Ashby", provider: "ashby", careers_url: "https://jobs.ashbyhq.com/ashby" },
  { name: "Supabase", provider: "ashby", careers_url: "https://jobs.ashbyhq.com/supabase" },
  { name: "Railway", provider: "ashby", careers_url: "https://jobs.ashbyhq.com/railway" },
  { name: "Render", provider: "ashby", careers_url: "https://jobs.ashbyhq.com/render" },
  { name: "Browserbase", provider: "ashby", careers_url: "https://jobs.ashbyhq.com/browserbase" },
  { name: "ElevenLabs", provider: "ashby", careers_url: "https://jobs.ashbyhq.com/elevenlabs" },
  { name: "Perplexity", provider: "ashby", careers_url: "https://jobs.ashbyhq.com/perplexity" },
  { name: "Temporal", provider: "ashby", careers_url: "https://jobs.ashbyhq.com/temporal" },
];

// Every slug above was verified against its vendor API. Five earlier entries
// (Airwallex, Eleven Labs on Greenhouse; Plaid, Ramp on Lever; Cursor as
// "anysphere") returned 404 and were corrected or removed rather than left in
// to inflate the scope sentence.

export function enabledBoards() {
  return CURATED_BOARDS.filter((b) => b.enabled !== false);
}

/**
 * The honest scope sentence for a search receipt.
 *
 * §5: `scopeDescription` must read like "60 configured boards", **never** "all
 * jobs". A visitor who sees three results should be able to tell whether that
 * means the market is empty or that we looked at sixteen companies.
 */
export function scopeDescription(boards = enabledBoards()) {
  const vendors = [...new Set(boards.map((b) => b.provider))].sort();
  const names =
    vendors.length <= 3
      ? vendors.map((v) => v[0].toUpperCase() + v.slice(1)).join(", ")
      : `${vendors.length} ATS vendors`;
  return `${boards.length} curated ${names} boards`;
}
