"use client";

import { useState } from "react";
import { RECRUITERS } from "../recruiters";
import type { ActivityRow, BlockProps } from "./types";
import { list, t } from "./strings";

const ACCEPT_MIME =
  "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * The agent activity panel beside the drop zone, then the drop zone itself.
 *
 * The panel's figures ("28,746 company boards", "130 boards checked · 19
 * matches") are the reference's, carried over on an explicit product decision
 * (2026-09-26) that overrides 02-screen-guide.md §3. None of them is measured,
 * and the panel shows work in progress before any run exists; the pipeline
 * itself reports only real counts.
 *
 * Option `recruiterMessage`: a recruiter checking the agent's work, the human
 * half of the recruiter-led offer.
 */
export function UploadBlock({ s, config, actions }: BlockProps) {
  const [dragging, setDragging] = useState(false);
  const recruiter = RECRUITERS[0];

  return (
    <div className="hc-upload" id={config.anchor}>
      <section className="hc-agent-activity">
        <header className="hc-agent-header">
          <div className="hc-agent-title">
            <i className="hc-agent-dot" />
            <span>{t(s, "upload.activity.title")}</span>
          </div>
          <div className="hc-agent-next">
            <span>{t(s, "upload.activity.nextLabel")}</span>
            <strong>{t(s, "upload.activity.nextValue")}</strong>
          </div>
        </header>
        <div className="hc-agent-feed">
          {list<ActivityRow>(s, "upload.activity.rows").map((row) => (
            <div className="hc-agent-row" key={row.task}>
              <div className="hc-agent-task">
                <span className="hc-agent-marker">{row.marker}</span>
                <span>{row.task}</span>
              </div>
              <div className="hc-agent-state">
                <i className="hc-agent-dot" />
                <span>{row.agent}</span>
                <strong>{row.state}</strong>
              </div>
            </div>
          ))}
          {config.recruiterMessage === true && recruiter && (
            <div className="hc-agent-message">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={recruiter.photo ?? undefined} alt="" />
              <div className="hc-agent-message-body">
                <div className="hc-agent-message-meta">
                  <strong>{recruiter.name}</strong>
                  <span className="hc-agent-message-role">
                    {t(s, "upload.activity.message.role", { industry: recruiter.industry })}
                  </span>
                  <span>{t(s, "upload.activity.message.time")}</span>
                </div>
                <p>{t(s, "upload.activity.message.text")}</p>
                <div
                  className="hc-agent-typing"
                  aria-label={t(s, "upload.activity.message.typingLabel", { name: recruiter.name })}
                >
                  <span className="hc-agent-typing-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>
                    {t(s, "upload.activity.message.typing", { firstName: recruiter.name.split(" ")[0] })}
                  </span>
                </div>
              </div>
            </div>
          )}
          <div className="hc-agent-prompt">
            <div className="hc-agent-task">
              <span className="hc-agent-marker">›</span>
              <strong>{t(s, "upload.activity.prompt")}</strong>
            </div>
          </div>
        </div>
      </section>

      <div
        className={`hc-drop${dragging ? " is-dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          actions.acceptFile(e.dataTransfer.files?.[0]);
        }}
      >
        {/* The reference's upload-tray glyph; an empty box without it. */}
        <div className="hc-letter" aria-hidden>
          <svg
            className="hc-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4" />
          </svg>
        </div>
        <div className="hc-grow">
          <h3>{t(s, "upload.dropTitle")}</h3>
          <p className="hc-small hc-muted">{t(s, "upload.dropHint")}</p>
        </div>
        <input
          ref={actions.inputRef}
          type="file"
          accept={ACCEPT_MIME}
          className="hc-visually-hidden"
          onChange={(e) => actions.acceptFile(e.target.files?.[0] ?? undefined)}
        />
        <button type="button" className="hc-button" onClick={actions.chooseFile}>
          <span>{t(s, "upload.button")}</span>
          <svg
            className="hc-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12h14m-6-6 6 6-6 6" />
          </svg>
        </button>
      </div>

      <div className="hc-upload-bottom">
        <span>{t(s, "upload.formats", { maxMb: actions.maxMb })}</span>
        <span>{t(s, "upload.reassurance")}</span>
      </div>

      {actions.error && (
        /* A failure stays beside the drop zone — there is no error screen. */
        <p role="alert" className="hc-small hc-danger hc-center">
          {actions.error}
        </p>
      )}
    </div>
  );
}
