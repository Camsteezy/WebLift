"use client"

import { useMemo, useState } from "react"
import {
  ChevronDown,
  ExternalLink,
  Search,
  SearchCode,
  Paintbrush,
} from "lucide-react"
import type { CrawlSite, Issue } from "@/lib/db/schema"
import { priorityFor, toneClasses } from "@/lib/score"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const FILTERS = [
  { key: "all", label: "All", min: 0 },
  { key: "look", label: "Worth a look", min: 30 },
  { key: "high", label: "High priority", min: 55 },
] as const

function ScoreBar({ score }: { score: number }) {
  const { tone } = priorityFor(score)
  const c = toneClasses[tone]
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", c.bar)} style={{ width: `${score}%` }} />
      </div>
      <span className={cn("w-7 font-mono text-sm tabular-nums", c.text)}>{score}</span>
    </div>
  )
}

function IssueChip({ issue }: { issue: Issue }) {
  const Icon = issue.category === "seo" ? SearchCode : Paintbrush
  const dot =
    issue.severity === "high"
      ? "bg-destructive"
      : issue.severity === "medium"
        ? "bg-warning"
        : "bg-muted-foreground"
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-xs">
      <span className={cn("size-1.5 rounded-full", dot)} />
      <Icon className="size-3 text-muted-foreground" />
      {issue.label}
    </span>
  )
}

export function LeadsTable({ leads }: { leads: CrawlSite[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all")
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<number | null>(null)

  const activeMin = FILTERS.find((f) => f.key === filter)!.min

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return leads.filter((l) => {
      if ((l.overallScore ?? 0) < activeMin) return false
      if (!q) return true
      return (
        l.domain.toLowerCase().includes(q) ||
        (l.title?.toLowerCase().includes(q) ?? false) ||
        l.url.toLowerCase().includes(q)
      )
    })
  }, [leads, activeMin, query])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-lg border border-border/60 bg-muted/30 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                filter === f.key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by domain or title"
            className="pl-8"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/60">
        <div className="hidden grid-cols-[1fr_auto_auto_auto] gap-4 border-b border-border/60 bg-muted/30 px-4 py-2.5 text-xs uppercase tracking-wide text-muted-foreground md:grid">
          <span>Website</span>
          <span className="w-24 text-right">SEO</span>
          <span className="w-24 text-right">Design</span>
          <span className="w-28 text-right">Priority</span>
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
            <Search className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No analyzed sites yet. Queue some seed URLs and run a crawl batch.
            </p>
          </div>
        ) : (
          filtered.map((lead) => {
            const p = priorityFor(lead.overallScore)
            const c = toneClasses[p.tone]
            const isOpen = expanded === lead.id
            const issues = lead.issues ?? []
            return (
              <div key={lead.id} className="border-b border-border/40 last:border-0">
                <button
                  onClick={() => setExpanded(isOpen ? null : lead.id)}
                  className="grid w-full grid-cols-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30 md:grid-cols-[1fr_auto_auto_auto] md:gap-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <ChevronDown
                      className={cn(
                        "size-4 shrink-0 text-muted-foreground transition-transform",
                        isOpen && "rotate-180",
                      )}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{lead.domain}</span>
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {lead.httpStatus ?? "—"}
                        </span>
                      </div>
                      <span className="line-clamp-1 text-sm text-muted-foreground">
                        {lead.title || lead.url}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 md:w-24 md:justify-end">
                    <span className="text-xs text-muted-foreground md:hidden">SEO</span>
                    <ScoreBar score={lead.seoScore ?? 0} />
                  </div>
                  <div className="flex items-center gap-2 md:w-24 md:justify-end">
                    <span className="text-xs text-muted-foreground md:hidden">Design</span>
                    <ScoreBar score={lead.designScore ?? 0} />
                  </div>
                  <div className="flex md:w-28 md:justify-end">
                    <Badge
                      variant="outline"
                      className={cn("gap-1.5", c.bg, c.text, c.border)}
                    >
                      <span className={cn("size-1.5 rounded-full", c.bar)} />
                      {p.label}
                    </Badge>
                  </div>
                </button>

                {isOpen && (
                  <div className="flex flex-col gap-3 bg-muted/20 px-4 pb-4 pt-1 md:pl-11">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        {issues.length} issue{issues.length === 1 ? "" : "s"} detected
                      </span>
                      <a
                        href={lead.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        Visit site <ExternalLink className="size-3" />
                      </a>
                    </div>
                    {issues.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {issues.map((issue) => (
                          <IssueChip key={issue.code} issue={issue} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No modernization issues detected — this site looks current.
                      </p>
                    )}
                    <div className="mt-1 flex gap-2">
                      <Button asChild size="sm" variant="secondary">
                        <a href={lead.url} target="_blank" rel="noopener noreferrer">
                          Open outreach lead
                        </a>
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
