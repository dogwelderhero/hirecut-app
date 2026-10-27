import type { BlockProps } from "./types";
import { t } from "./strings";

export function HeroBlock({ s, config }: BlockProps) {
  return (
    <section className="hc-hero hc-hero--landing" id={config.anchor}>
      <div className="hc-eyebrow">
        <i className="hc-dot" />
        <span>{t(s, "hero.eyebrow")}</span>
      </div>
      <h1>
        <span>{t(s, "hero.title")}</span>
        {/* The reference breaks the headline explicitly here. */}
        <br />
        {/*
          `hc-hero--landing h1 em` is `white-space: nowrap`, so this line must
          stay close to the reference's length or it overflows the hero.
        */}
        <em>{t(s, "hero.titleEm")}</em>
      </h1>
      <p>{t(s, "hero.lead")}</p>
    </section>
  );
}
