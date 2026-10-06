# opencode-halogen-telemetry

Telemetry widget for the [halogen](https://github.com/peonist-ai) flash server
(`halogen-flash-server`, serving `qwen3.8-flash-next`), rendered inside the
[opencode](https://opencode.ai) TUI.

The plugin detects the server via `/health` at startup; other halogen servers
(e.g. `halogen` 0.1.x serving `qwen3.8-27b`) are currently **not supported**
and the plugin stays completely silent for them.

After each assistant turn made with the `halogen` provider, a **Halogen telemetry**
widget appears in the opencode sidebar (below the LSP/Todo blocks):

```
Halogen telemetry
prefill  1,339 t/s
gen      35.6 t/s
spec     77%
cache    67%
KV       83%
saved    325,903 tok
(Ctrl+X,T for history)
```

- `prefill` — prompt processing speed for the turn
- `gen` — decode speed for the turn (generated tokens / generation time)
- `spec` — speculative-decoding (MTP draft) token acceptance
- `cache` — prompt-cache hit rate for the turn
- `KV` — current KV cache pool usage (turns yellow at >= 85%)
- `saved` — prompt tokens saved by the server-side prompt cache this turn

Press `Ctrl+X,T` (opencode leader + `t`) to open a **history table** of the last
50 turns for the current session, with the same columns plus a row index and
timestamp.

Data comes from the server's `/metrics` (Prometheus) and `/cache` (JSON)
endpoints. Nothing is displayed for non-halogen providers; the widget shows
`idle` until the first completed halogen turn.

## Install

Clone the repo and point the TUI plugin config at the checkout. In
`~/.config/opencode/tui.jsonc` (create if missing):

```jsonc
{
  "plugin": [
    ["/path/to/opencode-halogen-telemetry", { "url": "http://127.0.0.1:8731" }]
  ]
}
```

- `url` is optional; defaults to `http://127.0.0.1:8731` or the
  `HALOGEN_TELEMETRY_URL` environment variable.
- Restart the TUI after changing the config.
- The plugin imports `solid-js` / `@opentui/solid` from the opencode config
  directory (`~/.config/opencode/node_modules`); opencode installs them
  automatically when listed in `~/.config/opencode/package.json`
  (`solid-js`, `@opentui/core`, `@opentui/solid`).
- Note: installing via the `github:` plugin spec currently fails silently in
  the opencode 1.18 plugin loader (the plugin module is never imported);
  use the local-checkout method above.

## Requirements

- opencode >= 1.18 with the v2 TUI plugin runtime
- a halogen flash server (`halogen-flash-server`) exposing `/health`,
  `/metrics` and `/cache`

## License

MIT
