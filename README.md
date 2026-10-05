# opencode-halogen-telemetry

Telemetry widget for the [halogen](https://github.com/peonist-ai) flash server,
rendered inside the [opencode](https://opencode.ai) TUI.

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

Add to `~/.config/opencode/tui.jsonc` (create if missing):

```jsonc
{
  "plugin": [
    ["github:konst-sh/opencode-halogen-telemetry", { "url": "http://127.0.0.1:8731" }]
  ]
}
```

- `url` is optional; defaults to `http://127.0.0.1:8731` or the
  `HALOGEN_TELEMETRY_URL` environment variable.
- opencode installs and caches the plugin automatically at TUI startup.
- Restart the TUI after changing the config.

## Requirements

- opencode >= 1.18 with the v2 TUI plugin runtime
- a halogen flash server exposing `/metrics` and `/cache`

## License

MIT
