import { USER_AGENT } from "./analyze"

// Simple, per-run robots.txt cache. Fetches /robots.txt once per origin and
// checks Disallow rules that apply to our user-agent (or the * group).
const cache = new Map<string, string[]>()

async function getDisallowRules(origin: string): Promise<string[]> {
  if (cache.has(origin)) return cache.get(origin)!

  let rules: string[] = []
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 6000)
    const res = await fetch(`${origin}/robots.txt`, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    })
    clearTimeout(timeout)
    if (res.ok) {
      const text = await res.text()
      rules = parseRobots(text)
    }
  } catch {
    rules = []
  }
  cache.set(origin, rules)
  return rules
}

function parseRobots(text: string): string[] {
  const lines = text.split(/\r?\n/)
  const disallow: string[] = []
  let appliesToUs = false
  let sawStar = false
  const starRules: string[] = []

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim()
    if (!line) continue
    const [field, ...rest] = line.split(":")
    const key = field?.trim().toLowerCase()
    const value = rest.join(":").trim()

    if (key === "user-agent") {
      const ua = value.toLowerCase()
      appliesToUs = ua === "*" || USER_AGENT.toLowerCase().includes(ua)
      if (ua === "*") sawStar = true
    } else if (key === "disallow" && value) {
      if (appliesToUs) disallow.push(value)
      if (sawStar) starRules.push(value)
    }
  }
  return disallow.length ? disallow : starRules
}

export async function isAllowed(url: string): Promise<boolean> {
  try {
    const u = new URL(url)
    const rules = await getDisallowRules(u.origin)
    const path = u.pathname + u.search
    for (const rule of rules) {
      if (rule === "/") return false
      if (rule && path.startsWith(rule)) return false
    }
    return true
  } catch {
    return true
  }
}
