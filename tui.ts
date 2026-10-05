import { createSignal } from "solid-js"
import { jsx } from "@opentui/solid/jsx-runtime"
import type { TuiPlugin } from "@opencode-ai/plugin/tui"

const PROVIDER = "halogen"
const FETCH_TIMEOUT = 1500

type Snapshot = {
  promptTokens: number
  promptSeconds: number
  genTokens: number
  genSeconds: number
  cachedTokens: number
  draftTokens: number
  draftAccepted: number
  kvRatio: number
  tokensSaved: number
}

function parsePrometheus(text: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue
    const i = line.lastIndexOf(" ")
    if (i === -1) continue
    const name = line.slice(0, i).split(" ")[0]
    const value = Number(line.slice(i + 1))
    if (name && Number.isFinite(value)) out[name] = value
  }
  return out
}

async function snapshot(base: string): Promise<Snapshot> {
  const [metrics, cache] = await Promise.all([
    fetch(`${base}/metrics`, { signal: AbortSignal.timeout(FETCH_TIMEOUT) })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`/metrics -> ${r.status}`))))
      .then(parsePrometheus),
    fetch(`${base}/cache`, { signal: AbortSignal.timeout(FETCH_TIMEOUT) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`/cache -> ${r.status}`)))),
  ])
  return {
    promptTokens: metrics["llamacpp:prompt_tokens_total"] ?? 0,
    promptSeconds: metrics["llamacpp:prompt_seconds_total"] ?? 0,
    genTokens: metrics["llamacpp:tokens_predicted_total"] ?? 0,
    genSeconds: metrics["llamacpp:tokens_predicted_seconds_total"] ?? 0,
    cachedTokens: metrics["halogen:prompt_tokens_cached_total"] ?? 0,
    draftTokens: metrics["halogen:draft_tokens_total"] ?? 0,
    draftAccepted: metrics["halogen:draft_tokens_accepted_total"] ?? 0,
    kvRatio: metrics["llamacpp:kv_cache_usage_ratio"] ?? 0,
    tokensSaved: cache?.prompt_tokens_saved ?? 0,
  }
}

function delta(a: number, b: number): number {
  return Math.max(0, b - a)
}

function fmt(n: number, digits = 1): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: digits })
}

function summarize(before: Snapshot, after: Snapshot): string | undefined {
  const genTok = delta(before.genTokens, after.genTokens)
  if (genTok === 0) return undefined
  const genSec = delta(before.genSeconds, after.genSeconds)
  const promptTok = delta(before.promptTokens, after.promptTokens)
  const promptSec = delta(before.promptSeconds, after.promptSeconds)
  const cached = delta(before.cachedTokens, after.cachedTokens)
  const draft = delta(before.draftTokens, after.draftTokens)
  const accepted = delta(before.draftAccepted, after.draftAccepted)
  const saved = delta(before.tokensSaved, after.tokensSaved)

  const parts = [`${fmt(genTok / Math.max(genSec, 1e-9))} t/s gen`]
  if (promptTok > 0 && promptSec > 0) parts.push(`${fmt(promptTok / promptSec, 0)} t/s prefill`)
  if (cached + promptTok > 0) parts.push(`cache ${fmt((100 * cached) / (cached + promptTok), 0)}%`)
  if (draft > 0) parts.push(`spec ${fmt((100 * accepted) / draft, 0)}%`)
  parts.push(`KV ${fmt(100 * after.kvRatio, 0)}%`)
  if (saved > 0) parts.push(`saved ${fmt(saved, 0)} tok`)
  return parts.join("  ")
}

const tui: TuiPlugin = async (api, options) => {
  const base =
    (options as { url?: string } | undefined)?.url ??
    process.env.HALOGEN_TELEMETRY_URL ??
    "http://127.0.0.1:8731"

  const [line, setLine] = createSignal<string>()
  const turns = new Map<string, Snapshot>()
  const pending = new Set<string>()

  const take = (sessionID: string) => {
    if (turns.has(sessionID) || pending.has(sessionID)) return
    pending.add(sessionID)
    snapshot(base)
      .then((s) => turns.set(sessionID, s))
      .catch(() => {})
      .finally(() => pending.delete(sessionID))
  }

  const finish = (sessionID: string) => {
    const before = turns.get(sessionID)
    if (!before) return
    turns.delete(sessionID)
    snapshot(base)
      .then((after) => {
        const summary = summarize(before, after)
        if (summary) setLine(summary)
      })
      .catch(() => {})
  }

  api.event.on("message.updated", (event) => {
    const info = event.properties.info
    if (info.role !== "assistant" || info.providerID !== PROVIDER) return
    take(event.properties.sessionID)
  })
  api.event.on("session.idle", (event) => finish(event.properties.sessionID))
  api.event.on("session.status", (event) => {
    if (event.properties.status.type === "idle") finish(event.properties.sessionID)
  })

  api.slots.register({
    order: 100,
    slots: {
      app_bottom: (ctx) =>
        jsx("box", {
          flexShrink: 0,
          paddingLeft: 1,
          children: () => {
            const value = line()
            if (!value) return null
            return jsx("text", {
              wrapMode: "none",
              truncate: true,
              fg: ctx.theme.current.textMuted,
              children: () => `${PROVIDER}  ${value}`,
            })
          },
        }),
    },
  })
}

export default { id: "opencode-halogen-telemetry", tui }
