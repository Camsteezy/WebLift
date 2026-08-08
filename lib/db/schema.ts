import {
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

export type Issue = {
  code: string
  label: string
  category: "seo" | "design"
  severity: "low" | "medium" | "high"
}

export const crawlSites = pgTable("crawl_sites", {
  id: serial("id").primaryKey(),
  url: text("url").notNull().unique(),
  domain: text("domain").notNull(),
  // pending | crawling | crawled | error
  status: text("status").notNull().default("pending"),
  depth: integer("depth").notNull().default(0),
  sourceUrl: text("source_url"),
  httpStatus: integer("http_status"),
  title: text("title"),
  // 0-100, higher means it needs modernization more urgently
  overallScore: integer("overall_score"),
  seoScore: integer("seo_score"),
  designScore: integer("design_score"),
  issues: jsonb("issues").$type<Issue[]>().default([]),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
})

export type CrawlSite = typeof crawlSites.$inferSelect
