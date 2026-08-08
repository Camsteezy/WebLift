import type { CheerioAPI } from "cheerio"
import type { Issue } from "@/lib/db/schema"

// Signals that a site has been *neglected*, as opposed to merely built with
// dated markup. These tend to be stronger modernization leads than tag-level
// issues: nobody has logged into this site in years.

const MIN_PLAUSIBLE_YEAR = 1990

// "© 2018", "&copy; 2010-2014", "Copyright 2009 Acme Inc"
const COPYRIGHT_RE =
  /(?:©|&copy;|\(c\)|copyright)[^0-9]{0,20}(\d{4})(?:\s*[-–—]\s*(\d{4}))?/gi

// Universal Analytics property ids (UA-XXXXXX-Y). Retired July 2023.
const UA_PROPERTY_RE = /\bUA-\d{4,10}-\d{1,4}\b/
// GA4 measurement ids, only where they look like a real tag reference.
const GA4_RE = /gtag\/js\?id=G-|['"]G-[A-Z0-9]{6,12}['"]/
// The pre-2013 analytics snippet, fully retired.
const CLASSIC_GA_RE = /google-analytics\.com\/ga\.js/i

const DISCONTINUED_BUILDERS: {
  test: RegExp
  code: string
  label: string
  severity: Issue["severity"]
}[] = [
  {
    test: /adobe\s*muse/i,
    code: "builder-muse",
    label: "Built with Adobe Muse (discontinued 2020)",
    severity: "high",
  },
  {
    test: /microsoft\s*frontpage|frontpage\s*\d/i,
    code: "builder-frontpage",
    label: "Built with Microsoft FrontPage",
    severity: "high",
  },
  {
    test: /netobjects\s*fusion/i,
    code: "builder-netobjects",
    label: "Built with NetObjects Fusion",
    severity: "high",
  },
  {
    test: /\biweb\b/i,
    code: "builder-iweb",
    label: "Built with Apple iWeb (discontinued 2011)",
    severity: "high",
  },
  {
    test: /dreamweaver/i,
    code: "builder-dreamweaver",
    label: "Exported from Adobe Dreamweaver",
    severity: "medium",
  },
]

/** Age in whole years, floored. */
function yearsSince(date: Date, now: Date): number {
  return Math.floor((now.getTime() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
}

function ageSeverity(years: number): Issue["severity"] | null {
  if (years >= 10) return "high"
  if (years >= 5) return "medium"
  if (years >= 3) return "low"
  return null
}

/** Page text with scripts/styles stripped, so inline JS can't fake a match. */
function visibleText($: CheerioAPI): string {
  const scope = $("body").length ? $("body") : $("html")
  if (!scope.length) return $.root().text()
  const clone = scope.clone()
  clone.find("script, style, noscript").remove()
  return clone.text()
}

/** Newest year mentioned alongside a copyright notice, or null. */
export function latestCopyrightYear(text: string, now: Date): number | null {
  const currentYear = now.getFullYear()
  let latest: number | null = null

  for (const match of text.matchAll(COPYRIGHT_RE)) {
    // For "2010-2014" the second group is the one that matters.
    const year = Number(match[2] ?? match[1])
    if (!Number.isFinite(year)) continue
    if (year < MIN_PLAUSIBLE_YEAR || year > currentYear) continue
    if (latest === null || year > latest) latest = year
  }

  return latest
}

export function stalenessIssues(ctx: {
  $: CheerioAPI
  html: string
  lastModified: string | null
  now?: Date
}): Issue[] {
  const { $, html, lastModified } = ctx
  const now = ctx.now ?? new Date()
  const issues: Issue[] = []

  const add = (code: string, label: string, severity: Issue["severity"]) =>
    issues.push({ code, label, category: "design", severity })

  // ---------- Stale copyright notice ----------
  const copyrightYear = latestCopyrightYear(visibleText($), now)
  if (copyrightYear !== null) {
    const age = now.getFullYear() - copyrightYear
    const severity = ageSeverity(age)
    if (severity) {
      add(
        "stale-copyright",
        `Footer copyright is ${age} years out of date (© ${copyrightYear})`,
        severity,
      )
    }
  }

  // ---------- Abandoned analytics ----------
  if (CLASSIC_GA_RE.test(html)) {
    add("analytics-ga-js", "Loads the retired ga.js analytics snippet", "medium")
  } else if (UA_PROPERTY_RE.test(html) && !GA4_RE.test(html)) {
    add(
      "analytics-universal",
      "Still on Universal Analytics — stopped collecting data in 2023",
      "medium",
    )
  }

  // ---------- Server-reported last modification ----------
  if (lastModified) {
    const parsed = new Date(lastModified)
    if (!Number.isNaN(parsed.getTime()) && parsed <= now) {
      const age = yearsSince(parsed, now)
      // Weaker evidence than the others — a CMS can serve a stale header — so
      // this tops out at medium.
      const severity = ageSeverity(age)
      if (severity) {
        add(
          "stale-last-modified",
          `Server reports the page unchanged for ${age} years`,
          severity === "high" ? "medium" : severity,
        )
      }
    }
  }

  // ---------- Platform fingerprint ----------
  const generator = $('meta[name="generator"]').attr("content")?.trim() ?? ""

  if (generator) {
    const builder = DISCONTINUED_BUILDERS.find((b) => b.test.test(generator))
    if (builder) add(builder.code, builder.label, builder.severity)

    // WordPress 6.0 shipped in 2022; anything on 5.x or below is well behind.
    const wp = generator.match(/wordpress\s*([\d.]+)/i)
    if (wp) {
      const major = Number.parseInt(wp[1], 10)
      if (Number.isFinite(major) && major < 6)
        add("old-wordpress", `Runs WordPress ${wp[1]} (unsupported)`, "medium")
    }

    // Drupal 8 and earlier are end-of-life.
    const drupal = generator.match(/drupal\s*(\d+)/i)
    if (drupal) {
      const major = Number.parseInt(drupal[1], 10)
      if (Number.isFinite(major) && major < 9)
        add("old-drupal", `Runs Drupal ${major} (end of life)`, "medium")
    }

    // Joomla 3.x reached end of life in 2023. The version can sit either right
    // after the name ("Joomla! 1.5 - Open Source…") or at the very end, so take
    // whichever version number the string carries.
    if (/joomla/i.test(generator)) {
      const joomla = generator.match(/(\d+)(?:\.\d+)*/)
      const major = joomla ? Number.parseInt(joomla[1], 10) : Number.NaN
      if (Number.isFinite(major) && major < 4)
        add("old-joomla", `Runs Joomla ${major} (end of life)`, "medium")
    }
  }

  // WPBakery (formerly Visual Composer) dates a WordPress build hard.
  if (/js_composer|wpbakery/i.test(html))
    add("wpbakery", "Uses the WPBakery / Visual Composer page builder", "low")

  return issues
}
