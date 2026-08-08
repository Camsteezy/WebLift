import * as cheerio from "cheerio"
import type { Issue } from "@/lib/db/schema"
import { stalenessIssues } from "./staleness"

export const USER_AGENT =
  "ModernizeBot/1.0 (+https://example.com/bot; website modernization scanner)"

const FETCH_TIMEOUT_MS = 12_000
const MAX_BYTES = 2_000_000 // 2MB cap on HTML we read

const SEVERITY_POINTS: Record<Issue["severity"], number> = {
  low: 8,
  medium: 15,
  high: 25,
}

export type PageAnalysis = {
  ok: boolean
  httpStatus: number | null
  title: string | null
  issues: Issue[]
  seoScore: number
  designScore: number
  overallScore: number
  links: string[]
  error?: string
}

function normalizeUrl(raw: string, base: string): string | null {
  try {
    const u = new URL(raw, base)
    if (u.protocol !== "http:" && u.protocol !== "https:") return null
    u.hash = ""
    // Drop common tracking/query noise-free duplicates by keeping search as-is
    return u.toString()
  } catch {
    return null
  }
}

async function fetchHtml(url: string): Promise<{
  status: number
  html: string
  finalUrl: string
  lastModified: string | null
}> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
    })
    const lastModified = res.headers.get("last-modified")
    const contentType = res.headers.get("content-type") ?? ""
    if (!contentType.includes("html")) {
      return { status: res.status, html: "", finalUrl: res.url || url, lastModified }
    }
    // Read with a byte cap
    const reader = res.body?.getReader()
    if (!reader) {
      const text = await res.text()
      return {
        status: res.status,
        html: text.slice(0, MAX_BYTES),
        finalUrl: res.url || url,
        lastModified,
      }
    }
    const decoder = new TextDecoder()
    let html = ""
    let received = 0
    while (received < MAX_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      html += decoder.decode(value, { stream: true })
    }
    reader.cancel().catch(() => {})
    return { status: res.status, html, finalUrl: res.url || url, lastModified }
  } finally {
    clearTimeout(timeout)
  }
}

function scoreCategory(issues: Issue[], category: Issue["category"]): number {
  const points = issues
    .filter((i) => i.category === category)
    .reduce((sum, i) => sum + SEVERITY_POINTS[i.severity], 0)
  return Math.min(100, points)
}

export async function analyzePage(url: string): Promise<PageAnalysis> {
  let status: number | null = null
  try {
    const { status: httpStatus, html, finalUrl, lastModified } = await fetchHtml(url)
    status = httpStatus

    const isHttps = new URL(finalUrl).protocol === "https:"
    const issues: Issue[] = []

    if (!html) {
      return {
        ok: false,
        httpStatus,
        title: null,
        issues: [],
        seoScore: 0,
        designScore: 0,
        overallScore: 0,
        links: [],
        error: httpStatus >= 400 ? `HTTP ${httpStatus}` : "No HTML content",
      }
    }

    const $ = cheerio.load(html)
    const add = (
      code: string,
      label: string,
      category: Issue["category"],
      severity: Issue["severity"],
    ) => issues.push({ code, label, category, severity })

    // ---------- SEO signals ----------
    const title = $("title").first().text().trim()
    if (!title) add("no-title", "Missing <title> tag", "seo", "high")
    else if (title.length < 10 || title.length > 65)
      add("title-length", "Title length is not SEO-optimal", "seo", "low")

    const metaDesc = $('meta[name="description"]').attr("content")?.trim()
    if (!metaDesc) add("no-meta-description", "Missing meta description", "seo", "medium")

    const h1Count = $("h1").length
    if (h1Count === 0) add("no-h1", "Missing an <h1> heading", "seo", "medium")
    else if (h1Count > 1) add("multiple-h1", "Multiple <h1> headings", "seo", "low")

    if ($('link[rel="canonical"]').length === 0)
      add("no-canonical", "Missing canonical link", "seo", "low")

    if (!$("html").attr("lang"))
      add("no-lang", "Missing lang attribute on <html>", "seo", "low")

    if ($('meta[property^="og:"]').length === 0)
      add("no-open-graph", "No Open Graph / social tags", "seo", "low")

    const imgs = $("img")
    const imgsNoAlt = imgs.filter((_, el) => !$(el).attr("alt")).length
    if (imgs.length > 0 && imgsNoAlt / imgs.length > 0.3)
      add("img-no-alt", "Many images missing alt text", "seo", "medium")

    if (!isHttps) add("no-https", "Site is not served over HTTPS", "seo", "high")

    // ---------- Outdated tech / design signals ----------
    const viewport = $('meta[name="viewport"]').attr("content")
    if (!viewport)
      add("no-viewport", "No responsive viewport meta (not mobile-friendly)", "design", "high")

    // Layout tables: tables that are large / contain other tables are a strong signal
    let layoutTable = false
    $("table").each((_, el) => {
      const $t = $(el)
      if ($t.find("table").length > 0 || $t.attr("width") || $t.attr("bgcolor") || $t.attr("cellpadding")) {
        layoutTable = true
      }
    })
    if (layoutTable) add("layout-tables", "Uses tables for page layout", "design", "high")

    if ($("font").length > 0) add("font-tags", "Uses deprecated <font> tags", "design", "high")
    if ($("frameset, frame").length > 0)
      add("framesets", "Uses <frameset> / <frame>", "design", "high")
    if ($("center, marquee, blink").length > 0)
      add("deprecated-elements", "Uses <center>/<marquee>/<blink>", "design", "medium")

    const deprecatedAttrs = $("[bgcolor], [align], [valign], [nowrap], [border]").length
    if (deprecatedAttrs > 3)
      add("deprecated-attrs", "Deprecated HTML attributes (bgcolor/align/…)", "design", "medium")

    // Flash
    if (
      html.toLowerCase().includes(".swf") ||
      $('object[type="application/x-shockwave-flash"]').length > 0
    )
      add("flash", "Uses Adobe Flash content", "design", "high")

    // Old jQuery
    const scripts = $("script[src]")
      .map((_, el) => $(el).attr("src") ?? "")
      .get()
      .join(" ")
    if (/jquery[-.]1\.\d/i.test(scripts))
      add("old-jquery", "Loads an old jQuery 1.x version", "design", "medium")

    // Doctype
    const doctypeMatch = html.slice(0, 500).match(/<!doctype[^>]*>/i)
    if (!doctypeMatch) {
      add("no-doctype", "Missing <!doctype> declaration", "design", "medium")
    } else {
      const dt = doctypeMatch[0].toLowerCase()
      if (dt.includes("html 4") || dt.includes("xhtml"))
        add("old-doctype", "Uses an HTML4 / XHTML doctype", "design", "medium")
    }

    if ($('link[rel~="icon"], link[rel="shortcut icon"]').length === 0)
      add("no-favicon", "No favicon defined", "design", "low")

    // ---------- Neglect / staleness signals ----------
    issues.push(...stalenessIssues({ $, html, lastModified }))

    // ---------- Scores ----------
    const seoScore = scoreCategory(issues, "seo")
    const designScore = scoreCategory(issues, "design")
    const overallScore = Math.round(seoScore * 0.45 + designScore * 0.55)

    // ---------- Link extraction ----------
    const links = new Set<string>()
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href")
      if (!href) return
      const n = normalizeUrl(href, finalUrl)
      if (n) links.add(n)
    })

    return {
      ok: httpStatus < 400,
      httpStatus,
      title: title || null,
      issues,
      seoScore,
      designScore,
      overallScore,
      links: Array.from(links),
    }
  } catch (err) {
    return {
      ok: false,
      httpStatus: status,
      title: null,
      issues: [],
      seoScore: 0,
      designScore: 0,
      overallScore: 0,
      links: [],
      error: err instanceof Error ? err.message : "Fetch failed",
    }
  }
}
