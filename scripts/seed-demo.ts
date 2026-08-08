// Populates the dashboard with a spread of real, already-analyzed sites, so a
// demo doesn't depend on a live crawl finishing on time. Every score below is
// produced by the real analyzer — nothing here is faked.
//
// Usage: npm run seed:demo            (adds to whatever is already there)
//        npm run seed:demo -- --reset (clears the table first)

import { Pool } from "pg"
import { analyzePage } from "../lib/crawler/analyze.ts"

// Chosen to span the priority bands: genuinely neglected sites at the top,
// deliberately-plain-but-maintained ones at the bottom for contrast.
const DEMO_SEEDS = [
  "http://textfiles.com",
  "https://www.spacejam.com/1996/",
  "https://www.berkshirehathaway.com",
  "https://news.ycombinator.com",
  "https://slashdot.org",
  "https://www.sqlite.org",
  "https://www.debian.org",
  "https://www.gnu.org",
  "https://www.craigslist.org",
]

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error("DATABASE_URL is not set. Copy .env.local.example to .env.local first.")
  process.exit(1)
}

const pool = new Pool({ connectionString })

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

if (process.argv.includes("--reset")) {
  await pool.query("DELETE FROM crawl_sites")
  console.log("Cleared crawl_sites.")
}

for (const url of DEMO_SEEDS) {
  const a = await analyzePage(url)
  const status = a.error ? "error" : "crawled"

  await pool.query(
    `INSERT INTO crawl_sites
       (url, domain, status, depth, http_status, title,
        overall_score, seo_score, design_score, issues, error, analyzed_at)
     VALUES ($1,$2,$3,0,$4,$5,$6,$7,$8,$9,$10, now())
     ON CONFLICT (url) DO UPDATE SET
       status = EXCLUDED.status,
       http_status = EXCLUDED.http_status,
       title = EXCLUDED.title,
       overall_score = EXCLUDED.overall_score,
       seo_score = EXCLUDED.seo_score,
       design_score = EXCLUDED.design_score,
       issues = EXCLUDED.issues,
       error = EXCLUDED.error,
       analyzed_at = now()`,
    [
      url,
      domainOf(url),
      status,
      a.httpStatus,
      a.title,
      a.overallScore,
      a.seoScore,
      a.designScore,
      JSON.stringify(a.issues),
      a.error ?? null,
    ],
  )

  const band = a.overallScore >= 55 ? "HIGH" : a.overallScore >= 30 ? "look" : "ok"
  console.log(
    `  ${String(a.overallScore).padStart(3)}  ${band.padEnd(4)}  ${domainOf(url)}` +
      `${a.error ? `  (${a.error})` : ""}`,
  )
}

const { rows } = await pool.query(
  "SELECT count(*)::int AS n FROM crawl_sites WHERE status = 'crawled'",
)
console.log(`\n${rows[0].n} site(s) ready. Open http://localhost:3000`)

await pool.end()
