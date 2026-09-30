# Capybara Ledger

A trust layer for organisational knowledge. For any app, domain and client it answers: **who knows about this**, and **which documents can be trusted right now**.

## Run

```bash
docker compose up --build
```

Backend: http://localhost:3737  
Health check: http://localhost:3737/health  
MCP server: http://localhost:3737/mcp

## Stop

```bash
docker compose down
```

To also delete the database volume:

```bash
docker compose down -v
```

## Install MCP in Claude desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "capy-ledger": {
      "url": "http://localhost:3737/mcp"
    }
  }
}
```

Restart Claude desktop. The tools `trusted_docs`, `who_knows`, `get_provenance` and `health` will appear.

## Backend development (without Docker)

```bash
cd backend
pnpm install
pnpm dev
```

Requires a local Postgres instance or `docker compose up db` first.
