# Capybara Ledger

A trust layer for organisational knowledge. For any app, domain and client it answers: **who knows about this**, and **which documents can be trusted right now**.

## Run

```bash
docker compose up --build
```

Backend: http://localhost:3737  
Health check: http://localhost:3737/health  
MCP server: http://localhost:3737/mcp

On startup the backend loads the org directory and taxonomy from `mocks/seed`. It then polls the mock SharePoint (:4020) and mock mail (:4010) every 10 seconds (`INGEST_INTERVAL_MS`) and writes what changed to the ledger. See `mocks/*/README.md` for the live demo commands.

> The ledger's hash format changed with the connectors. If you ran an earlier version, reset the database once with `docker compose down -v`.

## Stop

```bash
docker compose down
```

To also delete the database volume:

```bash
docker compose down -v
```

## Install MCP in Claude desktop

### 1. Generate a dev token

Each persona gets their own token. Run this after seeding the database:

```bash
cd backend
pnpm gen-tokens
```

Copy the token for the persona you want to use.

### 2. Add to Claude desktop config

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "capy-ledger": {
      "command": "node",
      "args": ["/path/to/capy/backend/dist/mcp/stdio.js"],
      "env": {
        "DATABASE_URL": "postgres://capy:capy@localhost:5432/capy",
        "CAPY_TOKEN": "paste-token-here"
      }
    }
  }
}
```

Replace `/path/to/capy` with the actual path to this repo, and paste the token from the previous step.

### 3. Restart Claude desktop

The tools `trusted_docs`, `who_knows`, `get_provenance` and `health` will appear. Swap `CAPY_TOKEN` to a different persona's token to demo client-scoped access.

### Example prompts

The easiest way to start — just describe the situation in plain language:

> *"A customer called about sick leave in the Pay app — who should I contact and what documents apply?"*

> *"sick leave, Scheldemond"*

> *"Who's the expert on year-end payroll for Polderveld?"*

> *"Which HR contracts documents can I trust for Ardenne Bakkerijen?"*

> *"Show me the history of document doc-014"*

> *"Is the pay sick leave domain in good shape?"*

### Available tools

| Tool | What it does |
|---|---|
| `lookup` | **Start here.** Free-text query → top 3 experts with relevance % + top documents |
| `trusted_docs` | Ranked trustworthy documents for an app, domain and client — with reasons |
| `who_knows` | Ranked experts with evidence rows and bus-factor flags |
| `get_provenance` | Full ledger history for a document |
| `health` | Housekeeping findings: orphaned, stale, unreviewed, conflicts, gaps, bus factor |

## Backend development (without Docker)

```bash
cd backend
pnpm install
pnpm dev
```

Requires a local Postgres instance or `docker compose up db` first.
