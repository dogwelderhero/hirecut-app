import { AppShell } from "@/components/app-shell";

/**
 * Layout for the inherited career-ops alpha screens.
 *
 * These routes keep their original URLs (a route group adds no path segment),
 * but they are no longer the product surface: hirecute owns `/`. They are kept
 * rather than deleted so the upstream capabilities behind them stay reachable
 * during development.
 *
 * The public build must NOT expose these (04-coding-agent-brief.md: "Deny the
 * legacy alpha API and config/memory/updater/CLI/general-agent/local-browser
 * surfaces in the public build"). That gate belongs in middleware and is part
 * of Milestone 2's API boundary work.
 */
export default function LegacyLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
