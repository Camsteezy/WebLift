"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Play, Plus, Loader2, RefreshCw, Radar } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { seedCrawl, processQueue, resetCrawl } from "@/app/actions/crawl"

export function CrawlConsole({ pending }: { pending: number }) {
  const router = useRouter()
  const [urls, setUrls] = useState("")
  const [maxDepth, setMaxDepth] = useState(1)
  const [batchSize, setBatchSize] = useState(5)
  const [followExternal, setFollowExternal] = useState(true)
  const [seeding, startSeed] = useTransition()
  const [running, setRunning] = useState(false)
  const [resetting, startReset] = useTransition()

  function handleSeed() {
    const fd = new FormData()
    fd.set("urls", urls)
    startSeed(async () => {
      const res = await seedCrawl(fd)
      if (res.ok) {
        toast.success(res.message)
        setUrls("")
        router.refresh()
      } else {
        toast.error(res.message)
      }
    })
  }

  async function handleRun() {
    setRunning(true)
    try {
      const res = await processQueue({ batchSize, maxDepth, followExternal })
      if (res.processed === 0) {
        toast.info("Queue is empty — add some seed URLs to crawl.")
      } else {
        toast.success(
          `Analyzed ${res.processed} page(s), discovered ${res.discovered} new link(s).`,
        )
      }
      router.refresh()
    } catch {
      toast.error("Crawl batch failed.")
    } finally {
      setRunning(false)
    }
  }

  function handleReset() {
    startReset(async () => {
      await resetCrawl()
      toast.success("Crawl data cleared.")
      router.refresh()
    })
  }

  return (
    <Card className="border-border/60">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Radar className="size-4 text-primary" />
          Crawl console
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleReset}
          disabled={resetting}
          className="text-muted-foreground hover:text-destructive"
        >
          {resetting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Reset
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="seeds" className="text-xs uppercase tracking-wide text-muted-foreground">
            Seed URLs
          </Label>
          <Textarea
            id="seeds"
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            placeholder={"example.com\nhttps://another-site.org\ncity-business-directory.net"}
            className="min-h-24 resize-none font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            One per line or comma-separated. The crawler follows links out from these.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <Label className="uppercase tracking-wide text-muted-foreground">Crawl depth</Label>
              <span className="font-mono text-foreground">{maxDepth}</span>
            </div>
            <Slider
              value={[maxDepth]}
              min={0}
              max={4}
              step={1}
              onValueChange={(v) => setMaxDepth(Array.isArray(v) ? v[0] : v)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <Label className="uppercase tracking-wide text-muted-foreground">Batch size</Label>
              <span className="font-mono text-foreground">{batchSize}</span>
            </div>
            <Slider
              value={[batchSize]}
              min={1}
              max={20}
              step={1}
              onValueChange={(v) => setBatchSize(Array.isArray(v) ? v[0] : v)}
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
          <div className="flex flex-col">
            <span className="text-sm font-medium">Follow external domains</span>
            <span className="text-xs text-muted-foreground">
              Off = stay within seed domains only
            </span>
          </div>
          <Switch checked={followExternal} onCheckedChange={setFollowExternal} />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="secondary"
            onClick={handleSeed}
            disabled={seeding || !urls.trim()}
            className="flex-1"
          >
            {seeding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Queue seeds
          </Button>
          <Button onClick={handleRun} disabled={running} className="flex-1">
            {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            Run batch{pending > 0 ? ` (${pending} queued)` : ""}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
