import { inter } from "@/lib/fonts";

// Brand mark — lowercase "hc" for hirecute, on the theme's primary swatch.
// Matches the favicon (src/app/icon.svg). Colours come from tokens, so a
// future re-theme in globals.css carries the mark with it.
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className={`${inter.className} inline-flex shrink-0 items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.46),
        letterSpacing: "0.01em",
        lineHeight: 1,
      }}
    >
      hc
    </span>
  );
}
