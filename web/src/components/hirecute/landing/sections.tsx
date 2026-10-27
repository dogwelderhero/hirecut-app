import { FEATURE_ART } from "../feature-art";
import type { BlockProps, ControlItem, FaqItem, FeatureItem } from "./types";
import { list, t } from "./strings";

/**
 * The text-only landing blocks. Each renders the reference markup with its
 * copy from content/strings; none holds state or logic.
 */

function Tick() {
  return (
    <span className="hc-land-tick" aria-hidden>
      ✓
    </span>
  );
}

export function StartupsBlock({ s, config }: BlockProps) {
  return (
    <section className="hc-startups" id={config.anchor}>
      <p>{t(s, "startups.lead")}</p>
      <div className="hc-startup-row">
        {list<string>(s, "startups.brands").map((name) => (
          <div className="hc-startup-brand" key={name}>
            <i className={`hc-startup-mark hc-logo-${name.toLowerCase()}`} aria-hidden />
            <span>{name}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function FeaturesBlock({ s, config, actions }: BlockProps) {
  return (
    <section className="hc-land-section hc-features" id={config.anchor}>
      <header className="hc-land-section-head">
        <div className="hc-land-kicker">{t(s, "features.kicker")}</div>
        <h2>
          <span>{t(s, "features.title")}</span>
          <br />
          <em>{t(s, "features.titleEm")}</em>
        </h2>
        <p className="hc-land-lead">{t(s, "features.lead")}</p>
      </header>
      <div className="hc-feature-grid">
        {list<FeatureItem>(s, "features.items").map((f) => (
          <article className="hc-feature-card" key={f.title}>
            {FEATURE_ART[f.art]}
            <h3>
              <span>{f.title}</span>
            </h3>
            <p>
              <span>{f.body}</span>
            </p>
          </article>
        ))}
      </div>
      <div className="hc-feature-outro">
        <p>{t(s, "features.outro")}</p>
        <button type="button" className="hc-button" onClick={actions.startSample}>
          <span>{t(s, "features.cta")}</span>
        </button>
      </div>
    </section>
  );
}

export function ControlBlock({ s, config }: BlockProps) {
  return (
    <section className="hc-land-section hc-land-control" id={config.anchor}>
      <div className="hc-land-kicker">{t(s, "control.kicker")}</div>
      <div className="hc-land-control-grid">
        {list<ControlItem>(s, "control.items").map((c) => (
          <div key={c.num}>
            <span className="hc-land-control-num">{c.num}</span>
            <h3>{c.title}</h3>
            <p>{c.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function PricingBlock({ s, config, actions }: BlockProps) {
  return (
    <section className="hc-land-section hc-land-pricing" id={config.anchor}>
      <header className="hc-land-section-head">
        <div className="hc-land-kicker">{t(s, "pricing.kicker")}</div>
        <h2>
          <span>{t(s, "pricing.title")}</span>
          <br />
          <em>{t(s, "pricing.titleEm")}</em>
        </h2>
        <p className="hc-land-lead">{t(s, "pricing.lead")}</p>
      </header>
      <div className="hc-land-price-grid">
        <article className="hc-land-price-card">
          <span className="hc-land-badge">{t(s, "pricing.free.badge")}</span>
          <h3>{t(s, "pricing.free.title")}</h3>
          <div className="hc-land-price">
            <strong>{t(s, "pricing.free.price")}</strong>
          </div>
          <p>{t(s, "pricing.free.lead")}</p>
          <ul>
            {list<string>(s, "pricing.free.items").map((item) => (
              <li key={item}>
                <Tick />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="hc-button" onClick={actions.chooseFile}>
            <span>{t(s, "pricing.free.cta")}</span>
            <span className="hc-land-arrow">↗</span>
          </button>
          <p className="hc-land-price-foot">{t(s, "pricing.free.foot")}</p>
        </article>

        <article className="hc-land-price-card hc-land-price-featured">
          <span className="hc-land-badge">{t(s, "pricing.credits.badge")}</span>
          <h3>{t(s, "pricing.credits.title")}</h3>
          <div className="hc-land-price">
            <strong>{t(s, "pricing.credits.price")}</strong>
            <span>{t(s, "pricing.credits.priceNote")}</span>
          </div>
          <p>{t(s, "pricing.credits.lead")}</p>
          <ul>
            {/* The last item is launch-profile dependent: no submission claim while submission is off. */}
            {list<string>(s, "pricing.credits.items").map((item) => (
              <li key={item}>
                <Tick />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="hc-button" onClick={actions.startSample}>
            <span>{t(s, "pricing.credits.cta")}</span>
            <span className="hc-land-arrow">↗</span>
          </button>
          <p className="hc-land-price-foot">{t(s, "pricing.credits.foot")}</p>
        </article>
      </div>
    </section>
  );
}

export function FaqBlock({ s, config }: BlockProps) {
  return (
    <section className="hc-land-section hc-land-faq" id={config.anchor}>
      <div className="hc-land-faq-heading">
        <div className="hc-land-kicker">{t(s, "faq.kicker")}</div>
        <h2>
          <span>{t(s, "faq.title")}</span>
          <br />
          <em>{t(s, "faq.titleEm")}</em>
        </h2>
        <p className="hc-land-lead">{t(s, "faq.lead")}</p>
      </div>
      <div className="hc-land-questions">
        {list<FaqItem>(s, "faq.items").map((item, i) => (
          <details key={item.q} open={i === 0}>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function FinaleBlock({ s, config, actions }: BlockProps) {
  return (
    <section className="hc-land-section hc-land-finale" id={config.anchor}>
      <div className="hc-land-final-card">
        <div className="hc-land-kicker">{t(s, "finale.kicker")}</div>
        <h2>
          <span>{t(s, "finale.title")}</span>
          <br />
          <em>{t(s, "finale.titleEm")}</em>
        </h2>
        <p className="hc-land-lead">{t(s, "finale.lead")}</p>
        <div className="hc-land-final-actions">
          <button type="button" className="hc-button" onClick={actions.chooseFile}>
            <span>{t(s, "finale.upload")}</span>
            <span className="hc-land-arrow">↗</span>
          </button>
          <button type="button" className="hc-button hc-button--quiet" onClick={actions.startSample}>
            <span>{t(s, "finale.sample")}</span>
            <span className="hc-land-arrow">↗</span>
          </button>
        </div>
        <p className="hc-land-final-note">{t(s, "finale.note")}</p>
      </div>
    </section>
  );
}
