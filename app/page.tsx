import { Radar } from "lucide-react"
import { getStats, getLeads } from "@/app/actions/crawl"
import { CrawlConsole } from "@/components/dashboard/crawl-console"
import { StatCards } from "@/components/dashboard/stat-cards"
import { LeadsTable } from "@/components/dashboard/leads-table"

export const dynamic = "force-dynamic"

export default async function Page() {
  const [stats, leads] = await Promise.all([getStats(), getLeads()])

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-6xl flex-col gap-8 px-4 py-8 md:px-6 md:py-12">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm text-primary">
          <Radar className="size-4" />
          <span className="font-mono uppercase tracking-widest">Modernize</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">
          Website modernization scanner
        </h1>
        <p className="max-w-2xl text-pretty text-muted-foreground">
          Crawl the web from seed URLs and automatically score each site on outdated
          design and SEO signals. Sites with the highest scores are your best
          modernization leads.
        </p>
      </header>

      <StatCards stats={stats} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
        <div className="lg:sticky lg:top-8 lg:self-start">
          <CrawlConsole pending={stats.pending} />
        </div>

        <section className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-medium">Modernization leads</h2>
            <span className="text-sm text-muted-foreground">{leads.length} scored</span>
          </div>
          <LeadsTable leads={leads} />
        </section>
      </div>
    </main>
  )
}
