# Codex Usage

A local dashboard for Codex token history and estimated API costs. Cost and Tokens views include a daily chart, date presets, cache savings, and breakdowns by model or day.

## Run

Requires Node.js 24.12+ and pnpm. Install dependencies with `pnpm install`, then:

```sh
pnpm start
```

The first launch builds the app. Later launches rebuild only when source files change. A Node server opens your browser at `http://127.0.0.1:4318`. Stop it with `Ctrl+C`; closing the browser doesn't stop the server. No background service is installed.

```sh
pnpm start --no-open  # Print the URL without opening a browser
pnpm run check       # Type check
pnpm test            # Parser, persistence, pricing, and reporting tests
pnpm run build       # Type check and build without starting a server
```

## History and storage

On startup and when you click Refresh, the app scans `$CODEX_HOME/sessions` and `$CODEX_HOME/archived_sessions` (default `~/.codex`). Only usage metadata is imported, not prompts, code, credentials, or tool output. Symlinks are not followed.

SQLite stores usage, calculated prices, and per-file checkpoints in:

- macOS: `~/Library/Application Support/codex-usage/usage.sqlite`
- Linux: `$XDG_DATA_HOME/codex-usage/usage.sqlite`, defaulting to `~/.local/share/codex-usage/usage.sqlite`

Unchanged files are skipped; appended files resume at the last complete line. Request identities prevent duplicates when sessions move into the archive or logs are copied. Imported records remain when source logs are deleted or truncated. Sessions deleted before their first import cannot be recovered. Back up the data directory to preserve imported history, including records whose logs are gone.

Override `CODEX_HOME`, `CODEX_USAGE_DATA_DIR`, or `PORT` when launching if needed. Data stays on your computer; the app binds to the loopback interface and doesn't make external requests. The terminal must remain open while you use the dashboard.

## Estimates

Amounts are USD API equivalents, not subscription bills or remaining allowance. Dates use the server's local timezone. The past 24 hours use hourly buckets; other presets use calendar days. Daily charts start at the first recorded day in the selected period, retaining quiet days after that. Amber dots mark days with entirely unpriced usage; their cost is unknown, not zero.

Bundled pricing covers GPT-6.1 Sol, GPT-6 Astra, and GPT-6 Luna using [published API rates](https://developers.openai.com/api/docs/pricing), checked October 25, 2026. This personal dashboard treats `codex-auto-review` as free, retaining its tokens at $0 with no cache savings. Estimates use base rates without a long-context uplift, including explicitly recorded speed tiers. Missing tiers assume Standard; trace-database speed evidence is not imported. Other unknown models, unknown tiers, and cache writes without recorded retention details remain unpriced. These tokens still count; dollar totals show only the priced subtotal.

Rates live in `server/pricing.ts`. Bump `PRICING_VERSION` when changing them to reprice saved usage without rereading transcripts. These are reference estimates using the bundled rates, not a historical billing rate ledger.

Modern logs use per-response usage identities and reconcile mirrored cumulative counters. Legacy-only logs use cumulative deltas and saved checkpoints. Unresolvable inherited history or malformed records can leave gaps; import notes surface malformed records.
