/**
 * The hirecute product surface renders without the career-ops AppShell: its own
 * workspace provides the agent transcript, progress line and work area.
 *
 * `hc-root` is what scopes the screens pack's design tokens (see the note atop
 * `app/hirecute-screens.css`): ten of them share a name with the shadcn/ui
 * theme, whose `:root` block is imported later and would otherwise win here.
 */
export default function HirecuteLayout({ children }: { children: React.ReactNode }) {
  return <div className="hc-root">{children}</div>;
}
