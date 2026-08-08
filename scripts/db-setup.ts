// Creates the crawl_sites table. Safe to re-run.
// Usage: npm run db:setup

import { readFile } from "node:fs/promises"
import { Pool } from "pg"

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error("DATABASE_URL is not set. Copy .env.local.example to .env.local first.")
  process.exit(1)
}

const sql = await readFile(new URL("../drizzle/0000_init.sql", import.meta.url), "utf8")
const pool = new Pool({ connectionString })

try {
  await pool.query(sql)
  const { rows } = await pool.query(
    "SELECT count(*)::int AS n FROM crawl_sites",
  )
  console.log(`crawl_sites is ready (${rows[0].n} row(s)).`)
} catch (err) {
  console.error("Setup failed:", err instanceof Error ? err.message : err)
  process.exit(1)
} finally {
  await pool.end()
}
