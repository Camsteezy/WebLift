// Analyze a single URL and print its issues, without touching the database.
// Usage: npm run scan -- https://example.com

import { analyzePage } from "../lib/crawler/analyze.ts"

const url = process.argv[2]
if (!url) {
  console.error("Usage: npm run scan -- <url>")
  process.exit(1)
}

const result = await analyzePage(url.startsWith("http") ? url : `https://${url}`)

if (result.error) console.error(`error: ${result.error}`)

console.log(`\n${url}  [HTTP ${result.httpStatus ?? "—"}]`)
console.log(`${result.title ?? "(no title)"}\n`)
console.log(
  `overall ${result.overallScore}   seo ${result.seoScore}   design ${result.designScore}\n`,
)

for (const issue of result.issues) {
  console.log(`  [${issue.severity.padEnd(6)}] ${issue.category.padEnd(6)} ${issue.label}`)
}
if (result.issues.length === 0) console.log("  (no issues detected)")
console.log(`\n${result.links.length} link(s) found.`)
