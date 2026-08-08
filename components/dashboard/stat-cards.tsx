import { Globe, ListChecks, Clock, TriangleAlert } from "lucide-react"
import { Card } from "@/components/ui/card"

type Stats = {
  total: number
  pending: number
  crawled: number
  errored: number
  highPriority: number
}

export function StatCards({ stats }: { stats: Stats }) {
  const items = [
    {
      label: "Discovered",
      value: stats.total,
      icon: Globe,
      hint: "URLs found",
      tone: "text-foreground",
    },
    {
      label: "Analyzed",
      value: stats.crawled,
      icon: ListChecks,
      hint: "pages scored",
      tone: "text-foreground",
    },
    {
      label: "In queue",
      value: stats.pending,
      icon: Clock,
      hint: "awaiting crawl",
      tone: "text-primary",
    },
    {
      label: "High priority",
      value: stats.highPriority,
      icon: TriangleAlert,
      hint: "score ≥ 55",
      tone: "text-destructive",
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
        <Card
          key={item.label}
          className="gap-0 p-4"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {item.label}
            </span>
            <item.icon className={`size-4 ${item.tone}`} />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-semibold tabular-nums">{item.value}</span>
            <span className="text-xs text-muted-foreground">{item.hint}</span>
          </div>
        </Card>
      ))}
    </div>
  )
}
