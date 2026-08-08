"use server"

import { and, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { crawlSites } from "@/lib/db/schema"
import { analyzePage } from "@/lib/crawler/analyze"
import { isAllowed } from "@/lib/crawler/robots"

const MAX_LINKS_PER_PAGE = 25
const MAX_BATCH = 20

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

async function enqueueLinks(
  links: string[],
  sourceUrl: string,
  nextDepth: number,
  followExternal: boolean,
  sourceDomain: string,
) {
  const candidates: { url: string; domain: string; sourceUrl: string; depth: number }[] = []
  const seen = new Set<string>()

  for (const link of links) {
    if (candidates.length >= MAX_LINKS_PER_PAGE) break
    const domain = domainOf(link)
    if (!domain) continue
    if (!followExternal && domain !== sourceDomain) continue
    if (seen.has(link)) continue
    seen.add(link)
    candidates.push({ url: link, domain, sourceUrl, depth: nextDepth })
  }

  if (candidates.length === 0) return
  await db
    .insert(crawlSites)
    .values(candidates.map((c) => ({ ...c, status: "pending" as const })))
    .onConflictDoNothing()
}

export async function processQueue(opts: {
  batchSize?: number
  maxDepth?: number
  followExternal?: boolean
}) {
  const batchSize = Math.min(Math.max(opts.batchSize ?? 5, 1), MAX_BATCH)
  const maxDepth = Math.min(Math.max(opts.maxDepth ?? 1, 0), 4)
  const followExternal = opts.followExternal ?? true

  // Atomically claim a batch of pending rows.
  const claimed = await db
    .update(crawlSites)
    .set({ status: "crawling" })
    .where(
      sql`${crawlSites.id} IN (
        SELECT id FROM ${crawlSites}
        WHERE status = 'pending'
        ORDER BY depth ASC, created_at ASC
        LIMIT ${batchSize}
      )`,
    )
    .returning()

  let processed = 0
  let discovered = 0

  for (const site of claimed) {
    const analysis = await analyzePage(site.url)
    processed++

    if (analysis.error && analysis.httpStatus === null) {
      await db
        .update(crawlSites)
        .set({ status: "error", error: analysis.error, analyzedAt: new Date() })
        .where(eq(crawlSites.id, site.id))
      continue
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
      const allowedLinks: string[] = []
      for (const link of analysis.links.slice(0, MAX_LINKS_PER_PAGE * 2)) {
        if (await isAllowed(link)) allowedLinks.push(link)
      }
      const before = allowedLinks.length
      await enqueueLinks(
        allowedLinks,
        site.url,
        nextDepth,
        followExternal,
        site.domain,
      )
      discovered += before
    }
  }

  revalidatePath("/")
  return { processed, discovered }
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
