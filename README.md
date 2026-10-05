# opencode-halogen-telemetry

Persistent telemetry bar for the [halogen](https://github.com/peonist-ai) 
flash server, rendered inside the [opencode](https://opencode.ai) TUI.

After each assistant turn made with the `halogen` provider, a one-line status bar
appears at the bottom of the TUI, e.g.:

```
halogen  22.8 t/s gen  1,389 t/s prefill  cache 92%  spec 58%  KV 84%  saved 8,411 tok
```

- `t/s gen` — decode speed for the turn (generated tokens / generation time)
- `t/s prefill` — prompt processing speed
- `cache` — prompt-cache hit rate for the turn
- `spec` — speculative-decoding (MTP draft) token acceptance
- `KV` — current KV cache pool usage
- `saved` — prompt tokens saved by the server-side prompt cache this turn

Data comes from the server's `/metrics` (Prometheus) and `/cache` (JSON) endpoints.
Nothing is displayed for non-halogen providers; the bar stays hidden until the
first completed halogen turn.

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
