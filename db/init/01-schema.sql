-- hirecut initial schema — the discovery spine (PRODUCT.md step 1).
--
-- Replaces upstream's markdown-as-state (data/applications.md, portals.yml,
-- data/scan-history.tsv) with real tables.

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------- boards
-- Was portals.yml. One row per scannable ATS board.
-- `provider_id` matches a module filename in providers/ (e.g. 'greenhouse');
-- NULL means "let detect() decide from careers_url".
CREATE TABLE boards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company       text        NOT NULL,
  careers_url   text        NOT NULL,
  api_url       text,                    -- PortalEntry.api (greenhouse/ashby)
  provider_id   text,                    -- PortalEntry.provider; NULL = autodetect
  enabled       boolean     NOT NULL DEFAULT true,
  -- Provider-specific PortalEntry keys (max_pages, offset_param, ...) that the
  -- provider reads straight off the entry object. Opaque to us by design.
  provider_opts jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Health, written by the scan orchestrator.
  last_scanned_at   timestamptz,
  last_scan_error   text,
  last_posting_count integer,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (careers_url)
);

CREATE INDEX boards_enabled_idx ON boards (enabled) WHERE enabled;

-- ---------------------------------------------------------------- jobs
-- One row per posting. Shape mirrors the providers' normalized `Job`
-- (title, url, company, location, description?, postedAt) plus our own keys.
--
-- url_key is the canonical posting-URL key from upstream url-key.mjs (tracking
-- params stripped, host lowercased, fragment + trailing slash dropped). It is
-- the dedup/idempotency key: re-scanning must never insert a second row.
CREATE TABLE jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id    uuid REFERENCES boards(id) ON DELETE SET NULL,
  url         text        NOT NULL,
  url_key     text        NOT NULL,
  title       text        NOT NULL,
  company     text        NOT NULL,
  location    text,
  -- Archived at ingest, NOT fetched on demand: postings die, and the archived
  -- text is the only durable record (upstream's #2789 lesson).
  description text,
  posted_at   timestamptz,
  provider_id text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  -- Set when a later scan of the same board no longer returns this posting.
  closed_at   timestamptz,
  raw         jsonb,                     -- untouched provider payload
  CONSTRAINT jobs_title_not_blank CHECK (length(btrim(title)) > 0),
  UNIQUE (url_key)
);

CREATE INDEX jobs_board_idx      ON jobs (board_id);
CREATE INDEX jobs_posted_at_idx  ON jobs (posted_at DESC NULLS LAST);
CREATE INDEX jobs_open_idx       ON jobs (last_seen_at DESC) WHERE closed_at IS NULL;
CREATE INDEX jobs_company_idx    ON jobs (lower(company));
-- Full-text over title+description for the /explore keyword filters.
CREATE INDEX jobs_fts_idx ON jobs
  USING gin (to_tsvector('simple', title || ' ' || coalesce(description, '')));

-- ---------------------------------------------------------------- scan_runs
-- Was data/scan-runs.tsv. One row per orchestrator sweep, for observability.
CREATE TABLE scan_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  boards_total  integer NOT NULL DEFAULT 0,
  boards_ok     integer NOT NULL DEFAULT 0,
  boards_failed integer NOT NULL DEFAULT 0,
  jobs_seen     integer NOT NULL DEFAULT 0,
  jobs_new      integer NOT NULL DEFAULT 0,
  notes         text
);

CREATE INDEX scan_runs_started_idx ON scan_runs (started_at DESC);
