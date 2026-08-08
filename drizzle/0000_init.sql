-- Initial schema for WebLift. Mirrors lib/db/schema.ts.
-- Apply with: npm run db:setup

CREATE TABLE IF NOT EXISTS crawl_sites (
  id            serial PRIMARY KEY,
  url           text NOT NULL UNIQUE,
  domain        text NOT NULL,
  -- pending | crawling | crawled | error
  status        text NOT NULL DEFAULT 'pending',
  depth         integer NOT NULL DEFAULT 0,
  source_url    text,
  http_status   integer,
  title         text,
  -- 0-100, higher means it needs modernization more urgently
  overall_score integer,
  seo_score     integer,
  design_score  integer,
  issues        jsonb DEFAULT '[]'::jsonb,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  analyzed_at   timestamptz
);

-- Supports the batch claim in processQueue (pending rows, shallowest first).
CREATE INDEX IF NOT EXISTS crawl_sites_queue_idx
  ON crawl_sites (status, depth, created_at);

-- Supports the leads listing, which sorts by score descending.
CREATE INDEX IF NOT EXISTS crawl_sites_score_idx
  ON crawl_sites (overall_score DESC);
