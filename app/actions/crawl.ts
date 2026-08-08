"use server"

import { and, count, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { crawlSites } from "@/lib/db/schema"
import { analyzePage } from "@/lib/crawler/analyze"
import { isAllowed } from "@/lib/crawler/robots"

const MAX_LINKS_PER_PAGE = 25
const MAX_BATCH = 20
// Ceilings for a single "Run batch" click. The run walks the queue until the
// depth budget is exhausted, so it needs its own stopping conditions.
const MAX_PAGES_PER_RUN = 150
// Keep a run comfortably inside a serverless function timeout. Raise the
// route's maxDuration alongside this if you raise it.
const RUN_TIME_BUDGET_MS = 15_000
// How many pages (and robots lookups) to have in flight at once.
const CONCURRENCY = 5

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return results
}

function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return null
  }
}

function normalizeSeed(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const u = new URL(withProto)
    u.hash = ""
    return u.toString()
  } catch {
    return null
  }
}

export async function seedCrawl(formData: FormData) {
  const raw = String(formData.get("urls") ?? "")
  const seeds = raw
    .split(/[\n,]+/)
    .map(normalizeSeed)
    .filter((u): u is string => Boolean(u))

  if (seeds.length === 0) {
    return { ok: false, message: "No valid URLs found." }
  }

  const rows = Array.from(new Set(seeds)).map((url) => ({
    url,
    domain: domainOf(url) ?? url,
    status: "pending" as const,
    depth: 0,
  }))

  await db.insert(crawlSites).values(rows).onConflictDoNothing()
  revalidatePath("/")
  return { ok: true, message: `Queued ${rows.length} seed URL(s).` }
}

/** Returns how many rows were actually inserted. */
async function enqueueLinks(
  links: string[],
  sourceUrl: string,
  nextDepth: number,
  followExternal: boolean,
  sourceDomain: string,
): Promise<number> {
  const candidates: { url: string; domain: string; sourceUrl: string; depth: number }[] = []
  const seen = new Set<string>()

  // Apply the cheap filters first, so the expensive robots lookups below only
  // run for links we would actually keep.
  for (const link of links) {
    if (candidates.length >= MAX_LINKS_PER_PAGE) break
    const domain = domainOf(link)
    if (!domain) continue
    if (!followExternal && domain !== sourceDomain) continue
    if (seen.has(link)) continue
    seen.add(link)
    candidates.push({ url: link, domain, sourceUrl, depth: nextDepth })
  }

  if (candidates.length === 0) return 0

  const checked = await mapLimit(candidates, CONCURRENCY, async (candidate) =>
    (await isAllowed(candidate.url)) ? candidate : null,
  )
  const allowed = checked.filter((c) => c !== null)
  if (allowed.length === 0) return 0

  const inserted = await db
    .insert(crawlSites)
    .values(allowed.map((c) => ({ ...c, status: "pending" as const })))
    .onConflictDoNothing()
    .returning({ id: crawlSites.id })

  return inserted.length
}

export async function processQueue(opts: {
  batchSize?: number
  maxDepth?: number
  followExternal?: boolean
}) {
  const batchSize = Math.min(Math.max(opts.batchSize ?? 5, 1), MAX_BATCH)
  const maxDepth = Math.min(Math.max(opts.maxDepth ?? 1, 0), 4)
  const followExternal = opts.followExternal ?? true
  const deadline = Date.now() + RUN_TIME_BUDGET_MS

  let processed = 0
  let discovered = 0
  let stoppedEarly = false

  // Keep draining the queue until the depth budget is exhausted. The claim is
  // ordered by depth, so this walks the queue breadth-first: one click crawls
  // to `maxDepth` rather than advancing a single level.
  while (true) {
    if (processed >= MAX_PAGES_PER_RUN || Date.now() >= deadline) {
      stoppedEarly = true
      break
    }

    const limit = Math.min(batchSize, MAX_PAGES_PER_RUN - processed)

    // Atomically claim a batch of pending rows within the depth budget.
    // SKIP LOCKED keeps two concurrent runs from claiming the same rows.
    const claimed = await db
      .update(crawlSites)
      .set({ status: "crawling" })
      .where(
        sql`${crawlSites.id} IN (
          SELECT id FROM ${crawlSites}
          WHERE status = 'pending' AND depth <= ${maxDepth}
          ORDER BY depth ASC, created_at ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )`,
      )
      .returning()

    if (claimed.length === 0) break

    // Always finish a claimed batch, so nothing is left stranded in 'crawling'.
    await mapLimit(claimed, CONCURRENCY, async (site) => {
      const analysis = await analyzePage(site.url)

      if (analysis.error && analysis.httpStatus === null) {
        await db
          .update(crawlSites)
          .set({ status: "error", error: analysis.error, analyzedAt: new Date() })
          .where(eq(crawlSites.id, site.id))
        return
      }

      await db
        .update(crawlSites)
        .set({
          status: analysis.error ? "error" : "crawled",
          httpStatus: analysis.httpStatus,
          title: analysis.title,
          overallScore: analysis.overallScore,
          seoScore: analysis.seoScore,
          designScore: analysis.designScore,
          issues: analysis.issues,
          error: analysis.error ?? null,
          analyzedAt: new Date(),
        })
        .where(eq(crawlSites.id, site.id))

      // Follow links if we have depth budget left and robots allows.
      const nextDepth = site.depth + 1
      if (nextDepth <= maxDepth && analysis.links.length > 0) {
        discovered += await enqueueLinks(
          analysis.links,
          site.url,
          nextDepth,
          followExternal,
          site.domain,
        )
      }
    })

    processed += claimed.length
  }

  const [remainingRow] = await db
    .select({ n: count() })
    .from(crawlSites)
    .where(and(eq(crawlSites.status, "pending"), lte(crawlSites.depth, maxDepth)))

  revalidatePath("/")
  return {
    processed,
    discovered,
    remaining: Number(remainingRow?.n ?? 0),
    stoppedEarly,
  }
}

export async function getStats() {
  const [row] = await db
    .select({
      total: count(),
      pending: sql<number>`count(*) filter (where status = 'pending')`,
      crawled: sql<number>`count(*) filter (where status = 'crawled')`,
      errored: sql<number>`count(*) filter (where status = 'error')`,
      highPriority: sql<number>`count(*) filter (where overall_score >= 50)`,
    })
    .from(crawlSites)

  return {
    total: Number(row?.total ?? 0),
    pending: Number(row?.pending ?? 0),
    crawled: Number(row?.crawled ?? 0),
    errored: Number(row?.errored ?? 0),
    highPriority: Number(row?.highPriority ?? 0),
  }
}

export async function getLeads(minScore = 0) {
  return db
    .select()
    .from(crawlSites)
    .where(
      and(
        eq(crawlSites.status, "crawled"),
        isNotNull(crawlSites.overallScore),
        gte(crawlSites.overallScore, minScore),
      ),
    )
    .orderBy(desc(crawlSites.overallScore), desc(crawlSites.analyzedAt))
    .limit(200)
}

export async function resetCrawl() {
  await db.delete(crawlSites)
  revalidatePath("/")
  return { ok: true }
}
