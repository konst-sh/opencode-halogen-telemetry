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
  sessionID: string
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
    sessionID: "",
  }
}

type Tone = "muted" | "success" | "warning"

function barParts(row: Row): Array<[string, Tone]> {
  const parts: Array<[string, Tone]> = [[`${row.gen} gen`, "muted"]]
  if (row.prefill !== "-") parts.push([`${row.prefill} prefill`, "muted"])
  if (row.cache !== "-") parts.push([`cache ${row.cache}`, "muted"])
  if (row.spec !== "-") parts.push([`spec ${row.spec}`, "muted"])
  parts.push([`KV ${row.kv}`, Number.parseInt(row.kv) >= 85 ? "warning" : "muted"])
  if (row.saved !== "-") parts.push([`saved ${row.saved}`, "success"])
  return parts
}

type Col = { label: string; width: number; get: (r: Row) => string }

const WIDE: Col[] = [
  { label: "#", width: 3, get: (r) => String(r.n) },
  { label: "time", width: 9, get: (r) => r.time },
  { label: "gen t/s", width: 7, get: (r) => r.gen.replace(" t/s", "") },
  { label: "prefill t/s", width: 11, get: (r) => r.prefill.replace(" t/s", "") },
  { label: "cache %", width: 7, get: (r) => r.cache.replace("%", "") },
  { label: "spec %", width: 6, get: (r) => r.spec.replace("%", "") },
  { label: "KV %", width: 4, get: (r) => r.kv.replace("%", "") },
  { label: "saved tok", width: 9, get: (r) => r.saved.replace(" tok", "") },
]

const NARROW: Col[] = [
  { label: "#", width: 2, get: (r) => String(r.n) },
  { label: "time", width: 8, get: (r) => r.time },
  { label: "gen t/s", width: 7, get: (r) => r.gen.replace(" t/s", "") },
  { label: "cache %", width: 7, get: (r) => r.cache.replace("%", "") },
  { label: "spec %", width: 6, get: (r) => r.spec.replace("%", "") },
  { label: "KV %", width: 4, get: (r) => r.kv.replace("%", "") },
  { label: "saved tok", width: 9, get: (r) => r.saved.replace(" tok", "") },
]

function tableLine(row: Row, cols: Col[]): string {
  return cols.map((c) => c.get(row).padEnd(c.width)).join(" ")
}

function headerLine(cols: Col[]): string {
  return cols.map((c) => c.label.padEnd(c.width)).join(" ")
}

const tui: TuiPlugin = async (api, options) => {
  const base =
    (typeof options?.url === "string" && options.url.replace(/\/$/, "")) ||
    process.env.HALOGEN_TELEMETRY_URL ||
    DEFAULT_BASE
  const [bar, setBar] = createSignal<Row>()
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
        row.sessionID = sessionID
        setRows((prev) => {
          const next = [{ ...row, n: 1 }, ...prev.slice(0, MAX_ROWS - 1).map((r, i) => ({ ...r, n: i + 2 }))]
          return next
        })
        setBar(row)
      })
      .catch(() => {})
  }

  const openTable = () => {
    const cols = ((api.renderer.width || 80) - 10 < 56 ? NARROW : WIDE) as Col[]
    const route = api.route.current
    const sid = route.name === "session" ? (route.params?.sessionID as string | undefined) : undefined
    const list = rows().filter((r) => !sid || r.sessionID === sid)
    const header = headerLine(cols)
    const tableW = cols.reduce((a, c) => a + c.width + 1, 0) + 1
    const w = api.renderer.width || 80
    const h = api.renderer.height || 24
    const t = api.theme.current
    const panel = () => jsx(
      "box",
      {
        width: tableW,
        paddingTop: 1,
        paddingBottom: 1,
        backgroundColor: t.backgroundPanel,
        flexDirection: "column",
        alignItems: "center",
        children: [
          jsx("text", { fg: t.primary, attributes: 1, children: () => "halogen telemetry" }),
          jsx("text", { children: () => "" }),
          list.length === 0
            ? jsx("text", { fg: t.textMuted, children: () => "no halogen telemetry yet" })
            : jsx("text", { fg: t.textMuted, attributes: 1, wrapMode: "none", truncate: true, children: () => header }),
          ...list.map((row, i) =>
            jsx("text", {
              wrapMode: "none",
              wrapMode: "none",
              truncate: true,
              fg:
                row.saved !== "-"
                  ? t.success
                  : row.kv !== "-" && Number.parseInt(row.kv) >= 85
                    ? t.warning
                    : t.text,
              children: () => tableLine({ ...row, n: i + 1 }, cols),
            }),
          ),
        ],
      },
    )
    api.ui.dialog.replace(
      () =>
        jsx(
          "box",
          {
            position: "absolute",
            left: 0,
            top: 0,
            ref: (el: any) => {
              setTimeout(() => {
                let n = el.parent
                let top = 0
                let left = 0
                while (n) {
                  if (n.yogaNode) {
                    top += n.yogaNode.getComputedTop()
                    left += n.yogaNode.getComputedLeft()
                  }
                  n = n.parent
                }
                el.top = -top
                el.left = -left
                el.requestRender?.()
              }, 0)
            },
            width: w,
            height: h,
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "#000000aa",
            children: () => panel(),
          },
        ),
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
          flexDirection: "row",
          paddingLeft: 1,
          children: () => {
            const row = bar()
            if (!row) return null
            const t = ctx.theme.current
            const fg = (tone: Tone) =>
              tone === "success" ? t.success : tone === "warning" ? t.warning : t.textMuted
            return [
              jsx("text", { flexShrink: 0, fg: t.primary, attributes: 1, children: () => PROVIDER }),
              ...barParts(row).map(([text, tone]) =>
                jsx("text", { flexShrink: 0, wrapMode: "none", fg: fg(tone), children: () => ` ${text}` }),
              ),
              jsx("text", {
                flexShrink: 0,
                wrapMode: "none",
                fg: t.borderSubtle,
                children: () => "  ctrl+x t history",
              }),
            ]
          },
        }),
    },
  })
}

export default { id: "halogen-telemetry-bar", tui }
