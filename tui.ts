import { createSignal } from "solid-js"
import { jsx } from "@opentui/solid/jsx-runtime"
import type { TuiPlugin } from "@opencode-ai/plugin/tui"

const DEFAULT_BASE = "http://127.0.0.1:8731"
const PROVIDER = "halogen"
const FETCH_TIMEOUT = 1500
const MAX_ROWS = 50

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

type Row = {
  n: number
  time: string
  gen: string
  prefill: string
  cache: string
  spec: string
  kv: string
  saved: string
  session: string
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

function pick(metrics: Record<string, number>, suffix: string): number {
  for (const key of Object.keys(metrics)) {
    if (key.endsWith(suffix)) return metrics[key]
  }
  return 0
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
    promptTokens: pick(metrics, "prompt_tokens_total"),
    promptSeconds: pick(metrics, "prompt_seconds_total"),
    genTokens: pick(metrics, "tokens_predicted_total"),
    genSeconds: pick(metrics, "tokens_predicted_seconds_total"),
    cachedTokens: pick(metrics, "prompt_tokens_cached_total"),
    draftTokens: pick(metrics, "draft_tokens_total"),
    draftAccepted: pick(metrics, "draft_tokens_accepted_total"),
    kvRatio: pick(metrics, "kv_cache_usage_ratio"),
    tokensSaved: cache?.prompt_tokens_saved ?? 0,
  }
}

function delta(a: number, b: number): number {
  return Math.max(0, b - a)
}

function fmt(n: number, digits = 1): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: digits })
}

function summarize(before: Snapshot, after: Snapshot): Row | undefined {
  const genTok = delta(before.genTokens, after.genTokens)
  if (genTok === 0) return undefined
  const genSec = delta(before.genSeconds, after.genSeconds)
  const promptTok = delta(before.promptTokens, after.promptTokens)
  const promptSec = delta(before.promptSeconds, after.promptSeconds)
  const cached = delta(before.cachedTokens, after.cachedTokens)
  const draft = delta(before.draftTokens, after.draftTokens)
  const accepted = delta(before.draftAccepted, after.draftAccepted)
  const saved = delta(before.tokensSaved, after.tokensSaved)

  return {
    n: 0,
    time: new Date().toLocaleTimeString("en-GB"),
    gen: `${fmt(genTok / Math.max(genSec, 1e-9))} t/s`,
    prefill: promptTok > 0 && promptSec > 0 ? `${fmt(promptTok / promptSec, 0)} t/s` : "-",
    cache: cached + promptTok > 0 ? `${fmt((100 * cached) / (cached + promptTok), 0)}%` : "-",
    spec: draft > 0 ? `${fmt((100 * accepted) / draft, 0)}%` : "-",
    kv: `${fmt(100 * after.kvRatio, 0)}%`,
    saved: saved > 0 ? `${fmt(saved, 0)} tok` : "-",
    session: "",
  }
}

function barText(row: Row): string {
  const parts = [`${row.gen} gen`]
  if (row.prefill !== "-") parts.push(`${row.prefill} prefill`)
  if (row.cache !== "-") parts.push(`cache ${row.cache}`)
  if (row.spec !== "-") parts.push(`spec ${row.spec}`)
  parts.push(`KV ${row.kv}`)
  if (row.saved !== "-") parts.push(`saved ${row.saved}`)
  return parts.join("  ")
}

const COLS: Array<[string, (r: Row) => string, number]> = [
  ["#", (r) => String(r.n), 3],
  ["time", (r) => r.time, 9],
  ["gen", (r) => r.gen, 11],
  ["prefill", (r) => r.prefill, 11],
  ["cache", (r) => r.cache, 6],
  ["spec", (r) => r.spec, 5],
  ["KV", (r) => r.kv, 5],
  ["saved", (r) => r.saved, 10],
  ["session", (r) => r.session, 0],
]

function tableLine(row: Row): string {
  return COLS.map(([label, get, width]) => {
    const value = get(row)
    return width === 0 ? value : value.padEnd(width)
  }).join(" ")
}

const tui: TuiPlugin = async (api, options) => {
  const base =
    (typeof options?.url === "string" && options.url.replace(/\/$/, "")) ||
    process.env.HALOGEN_TELEMETRY_URL ||
    DEFAULT_BASE
  const [line, setLine] = createSignal<string>()
  const [rows, setRows] = createSignal<Row[]>([])
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
        const row = summarize(before, after)
        if (!row) return
        row.session = sessionID.slice(0, 12)
        setRows((prev) => {
          const next = [{ ...row, n: 1 }, ...prev.slice(0, MAX_ROWS - 1).map((r, i) => ({ ...r, n: i + 2 }))]
          return next
        })
        setLine(barText(row))
      })
      .catch(() => {})
  }

  const openTable = () => {
    api.ui.dialog.replace(
      () =>
        api.ui.Dialog({
          size: "large",
          onClose: () => api.ui.dialog.clear(),
          children: () =>
            jsx(
              "box",
              {
                flexDirection: "column",
                paddingLeft: 1,
                paddingRight: 1,
                children: () => {
                  const list = rows()
                  if (list.length === 0)
                    return jsx("text", { fg: api.theme.current.textMuted, children: () => "no halogen telemetry yet" })
                  return [
                    jsx("text", {
                      fg: api.theme.current.textMuted,
                      attributes: 1,
                      children: () => tableLine({ n: 0, time: "time", gen: "gen", prefill: "prefill", cache: "cache", spec: "spec", kv: "KV", saved: "saved", session: "session" } as Row),
                    }),
                    ...list.map((row) =>
                      jsx("text", {
                        wrapMode: "none",
                        truncate: true,
                        children: () => tableLine(row),
                      }),
                    ),
                  ]
                },
              },
            ),
        }),
      () => {},
    )
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

  api.keymap.registerLayer({
    commands: [
      {
        name: "halogen.telemetry.show",
        title: "Show halogen telemetry",
        category: "Halogen",
        namespace: "palette",
        run: openTable,
      },
    ],
    bindings: [{ key: "<leader>t", desc: "Show halogen telemetry", group: "Halogen", cmd: openTable }],
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

export default { id: "halogen-telemetry-bar", tui }
