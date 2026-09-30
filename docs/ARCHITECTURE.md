# Architecture

Working name: **Capybara Ledger**. This document describes the moving parts, the data we need, and what is real versus mocked.

The design goal is a small system that is easy to demo and easy to explain: **one backend, one frontend, one database, and mock services that stand in for SharePoint and mail.**

## Overview

```
 Mock SharePoint ─┐                                    ┌─────────────────────────────────┐
 (watched folder) │   normalized     ┌───────────┐     │ Backend (single service)        │
                  ├─▶ change events ─▶ Ingestion ├────▶│  • Ledger (hash-chained)        │
 Mock Mail ───────┘                  │  worker   │     │  • Trust engine                 │
 (mailbox feed)                      │ (LLM tags)│     │  • Expertise engine             │
                                     └───────────┘     │  • Housekeeping engine          │
 Seed files: directory + taxonomy ────────────────────▶│  • Access control               │
                                                       └───────┬───────────────┬─────────┘
                                                               │ REST          │ MCP (HTTP)
                                                               ▼               ▼
                                                            Web UI       Existing agent
                                                                         (any MCP client)
                                                               │
                                                        Database (SQLite / Postgres)
```

## Services

| # | Service | Role | Suggested choice |
|---|---|---|---|
| 1 | **Backend** | API, ledger, trust, expertise and housekeeping engines, access control | One service: FastAPI (Python) or Fastify (TypeScript) |
| 2 | **MCP server** | Exposes `trusted_docs`, `who_knows`, `get_provenance`, `health` | Same process as the backend, HTTP transport with a token |
| 3 | **Web UI** | Lookup, provenance view, health board, capybara states, persona switcher | React + Vite |
| 4 | **Database** | Events, documents, versions, people, teams, domains, client bindings | SQLite locally, Postgres if deployed |
| 5 | **Mock SharePoint** | Watched folder of documents plus metadata; emits a change event on every file save | Folder watcher plus `sharepoint.meta.json` |
| 6 | **Mock Mail** | Serves `mailbox.jsonl` through Microsoft Graph–shaped delta endpoints the backend polls; a `send-mail` command for live moments | Fastify service (TypeScript), see `mocks/mail/README.md` |
| 7 | **LLM** | Tags documents and mails to app, domain and client; flags contradictions between sibling documents. Runs at ingestion only | Gemini on Vertex AI, or Claude |

Modules inside the backend (not separate services):

- **Ingestion worker:** background task that takes events from the mock services, extracts text, calls the LLM, and writes to the ledger
- **Connector contract:** the shared event shape that every source emits (see below)
- **Org directory and taxonomy:** seed files loaded at startup
- **Auth:** seeded personas with signed tokens

### What we do not need

- A vector database or search endpoint
- A message queue (an in-process task queue is enough)
- A separate auth provider
- Microservices or Kubernetes
- A real Microsoft tenant or OAuth

### Running it

```
docker compose up
  ├── backend (API + MCP + ingestion worker)
  ├── frontend
  └── database (or a SQLite file, no container)
```

The mock services run as scripts against the backend, so they can be triggered by hand during the demo.

## Repo layout

Assumes a Python backend and a React frontend. With TypeScript on the backend, `backend/` keeps the same shape with `src/` and `package.json`.

```
capy-ledger/
├── README.md                     # pitch, run steps, mocked vs real, unfinished
├── AGENTS.md                     # scope rules for Cursor/Claude
├── docker-compose.yml            # backend + frontend (+ db if Postgres)
├── .env.example                  # placeholders only, never real keys
├── .gitignore
│
├── docs/
│   ├── PROBLEM.md
│   ├── SOLUTION.md
│   └── ARCHITECTURE.md
│
├── mocks/                        # mock services and their data
│   ├── seed/
│   │   ├── taxonomy.json         # apps, domains, owner teams, domain links
│   │   └── directory.json        # teams, clients, people, client bindings, leavers
│   ├── sharepoint/
│   │   ├── sharepoint.meta.json  # metadata per document version
│   │   ├── watcher.py            # folder watcher: file save -> change event
│   │   └── library/
│   │       ├── Pay/Sick-leave/   # procedure v1, v2, client-specific, NL version...
│   │       └── Pay/Year-end/
│   ├── mail/
│   │   ├── mailbox.jsonl         # one mail per line
│   │   ├── live/                 # presets for live demo mails
│   │   └── src/                  # Graph-shaped mail API + send-mail command
│   └── simulate.py               # live moments: edit, approve, person-leaves
│
├── backend/
│   ├── pyproject.toml
│   ├── app/
│   │   ├── main.py               # startup, loads seed, mounts API + MCP
│   │   ├── config.py             # env vars
│   │   ├── db/
│   │   │   ├── schema.sql
│   │   │   ├── session.py
│   │   │   └── seed.py           # loads directory, taxonomy, historical events
│   │   ├── ledger/
│   │   │   ├── events.py         # append-only writes, hash chain
│   │   │   └── verify.py         # chain integrity check
│   │   ├── ingestion/
│   │   │   ├── contract.py       # normalized change-event shape
│   │   │   ├── worker.py         # background task: extract, tag, write
│   │   │   ├── tagging.py        # LLM: app/domain/client/country + confidence
│   │   │   └── contradictions.py # LLM: flag sibling conflicts
│   │   ├── engines/
│   │   │   ├── trust.py          # freshness, approval, owner, scope, consistency
│   │   │   ├── expertise.py      # evidence-based scores with recency decay
│   │   │   └── housekeeping.py   # orphaned, stale, unreviewed, duplicate, gaps, bus factor
│   │   ├── access/
│   │   │   ├── auth.py           # token -> caller identity
│   │   │   └── scope.py          # client-binding filter applied to every query
│   │   ├── api/
│   │   │   ├── lookup.py         # trusted_docs + who_knows
│   │   │   ├── provenance.py
│   │   │   ├── health.py
│   │   │   └── events_stream.py  # live updates (SSE or polling)
│   │   └── mcp/
│   │       └── server.py         # trusted_docs, who_knows, get_provenance, health
│   └── tests/
│       ├── test_trust_traps.py   # one test per planted trap
│       ├── test_expertise.py
│       ├── test_access_scope.py  # cross-client / IDOR checks
│       └── test_ledger_chain.py
│
├── frontend/
│   ├── package.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── api/client.ts
│       ├── pages/
│       │   ├── Lookup.tsx        # app/domain/client picker, two panels
│       │   ├── Provenance.tsx    # change history of a document
│       │   └── Health.tsx        # board: apps as rows, domains as cells
│       ├── components/
│       │   ├── TrustBadge.tsx    # capybara state + reason
│       │   ├── ExpertList.tsx    # people with evidence rows
│       │   ├── DocList.tsx       # ranked + excluded documents with reasons
│       │   └── PersonaSwitcher.tsx
│       └── assets/capybara/      # relaxed, eyebrow, sweating, phone, asleep
│
├── scripts/
│   ├── seed.sh                   # one-shot seed
│   └── demo.md                   # step-by-step demo script with the live moments
│
└── connectors/
    └── microsoft_graph.md        # note on how the real connector would map (not implemented)
```

### Where the decisions live

| Decision | Location |
|---|---|
| App → domain taxonomy | `mocks/seed/taxonomy.json`, `backend/app/db/schema.sql` |
| Two mock sources (SharePoint, mail) | `mocks/sharepoint/`, `mocks/mail/` |
| One connector contract | `backend/app/ingestion/contract.py` |
| Hash-chained ledger | `backend/app/ledger/` |
| Trust, expertise, housekeeping | `backend/app/engines/` |
| Client-scoped access | `backend/app/access/`, `backend/tests/test_access_scope.py` |
| MCP server | `backend/app/mcp/server.py` |
| Capybara states | `frontend/src/assets/capybara/`, `TrustBadge.tsx` |
| Live demo moments | `mocks/simulate.py`, `mocks/sharepoint/watcher.py`, `scripts/demo.md` |

### Conventions

- One test per planted trap, so `test_trust_traps.py` doubles as proof that the verdicts work.
- `scripts/demo.md` holds the scripted order of demo moments.
- `connectors/microsoft_graph.md` is a note, not code.
- Create directories only when they contain something.

## Data design principle: realistic on the outside, lean on the inside

The mock mails and documents deliberately contain **more data than the system uses**, so that they look and feel like real mails and real SharePoint documents. Every record therefore has two layers:

| Layer | Purpose | Examples |
|---|---|---|
| **Used by the system** | Drives trust, expertise, housekeeping and access control | author, timestamps, version, approval, content hash, thread id, references |
| **Realistic filler** | Makes the demo believable; displayed in the UI, never used in a decision | signature blocks, disclaimers, CC lists, attachments, formatting, long body text, irrelevant paragraphs |

Rules:

- **The system reads only the "used" fields.** Filler is stored and shown, but no trust or expertise score depends on it. This keeps verdicts reproducible.
- **The LLM sees the full content** (including filler) at ingestion to tag app, domain and client, which is realistic, since real content is noisy. Only the tags and metadata are kept afterwards.
- **Mail bodies are read once, then not retained in the ledger.** The ledger keeps metadata, tags and a pointer to the original. The mock mailbox file still holds the full text so the UI can show a realistic mail.
- **All data is synthetic.** No real people, clients or legal statements.

## Data structures

### 1. Taxonomy (`mocks/seed/taxonomy.json`)

Fixed, curated list. Domain is the unit of ownership.

```json
{
  "apps": [
    { "id": "pay", "name": "Pay" },
    { "id": "hr", "name": "HR" },
    { "id": "time", "name": "Time" }
  ],
  "domains": [
    { "id": "pay.sick-leave", "app": "pay", "name": "Sick leave", "owner_team": "team-pay" },
    { "id": "pay.year-end", "app": "pay", "name": "Year-end", "owner_team": "team-pay" },
    { "id": "time.absence", "app": "time", "name": "Absence registration", "owner_team": "team-time" }
  ],
  "domain_links": [
    { "from": "pay.sick-leave", "to": "time.absence", "type": "touches" }
  ]
}
```

### 2. Org directory (`mocks/seed/directory.json`)

```json
{
  "teams": [{ "id": "team-pay", "name": "Pay team", "app": "pay" }],
  "clients": [{ "id": "client-x", "name": "Client X", "country": "BE" }],
  "people": [
    {
      "id": "sophie.dubois",
      "name": "Sophie Dubois",
      "team": "team-pay",
      "role": "Payroll consultant",
      "status": "active",
      "left_at": null,
      "client_bindings": ["client-x"],
      "email": "sophie.dubois@example.test"
    }
  ]
}
```

Used by the system: `team`, `status`, `left_at`, `client_bindings`. Filler: `role`, `email`, display names.

### 3. Mock SharePoint document

Each file version is one file in `mocks/sharepoint/`, described in `sharepoint.meta.json`.

```json
{
  "id": "doc-014",
  "version": "2.0",
  "previous_version_id": "doc-014@1.0",
  "path": "Pay/Sick-leave/sick-leave-procedure_v2.md",
  "title": "Sick leave procedure (part-time)",

  "created_by": "jan.peeters",
  "modified_by": "sophie.dubois",
  "modified_at": "2026-08-12T09:14:00Z",
  "content_hash": "sha256:…",
  "approval": { "status": "approved", "by": "lead.pay", "at": "2026-08-13T10:02:00Z" },
  "country_hint": "BE",

  "filler": {
    "content_type": "text/markdown",
    "size_kb": 38,
    "site": "Pay Knowledge Hub",
    "library": "Procedures",
    "labels": ["Internal", "Payroll"],
    "check_out_status": "none",
    "last_viewed_by": ["anna.claes", "tom.maes"],
    "comments": [{ "by": "anna.claes", "text": "Should this also cover trainees?" }],
    "header_footer": "SD Worx internal use only · Page 1 of 4"
  }
}
```

The document body (`.md` file) is realistic: title, intro, numbered sections, tables, a revision history block, a disclaimer, and some paragraphs unrelated to the domain.

| Used by the system | Realistic filler |
|---|---|
| `id`, `version`, `previous_version_id`, `created_by`, `modified_by`, `modified_at`, `content_hash`, `approval`, `country_hint` | `filler.*`, body formatting, revision-history text, disclaimers |
| Tags added at ingestion: `app`, `domain`, `client`, `country`, `confidence` | |

### 4. Mock mail

One mail per line in `mocks/mail/mailbox.jsonl`.

```json
{
  "id": "mail-231",
  "thread_id": "thr-77",
  "from": "sophie.dubois",
  "to": ["anna.claes"],
  "sent_at": "2026-09-02T14:05:00Z",
  "subject": "Re: Part-time sick leave, Client X",
  "references": ["doc-014"],
  "is_reply_to": "mail-228",

  "body": "Hi Anna, for Client X we apply the guaranteed-salary rule from day one...",

  "filler": {
    "cc": ["lead.pay"],
    "bcc": [],
    "importance": "normal",
    "attachments": [{ "name": "overview.xlsx", "size_kb": 54 }],
    "signature": "Sophie Dubois · Payroll consultant · Pay team · +32 2 000 00 00",
    "disclaimer": "This message is confidential and intended only for the addressee.",
    "quoted_history": "…earlier messages in the thread…",
    "language": "nl"
  }
}
```

| Used by the system | Realistic filler |
|---|---|
| `id`, `thread_id`, `from`, `to`, `sent_at`, `references`, `is_reply_to`, tags added at ingestion (`app`, `domain`, `client`) | `cc`, `bcc`, `attachments`, `signature`, `disclaimer`, `quoted_history`, `importance`, `language`, the full body text |

Mixing Dutch, French and English across mails adds realism. Only a few mails carry the planted traps; the rest are plausible everyday traffic.

### 5. Normalized change event (the connector contract)

Every mock service, and later every real connector, emits this shape:

```json
{
  "source_type": "sharepoint | mail | directory",
  "source_id": "doc-014",
  "action": "created | edited | approved | replied | moved | deleted | person_left",
  "actor": "sophie.dubois",
  "timestamp": "2026-08-12T09:14:00Z",
  "content_hash": "sha256:…",
  "location": "Pay/Sick-leave",
  "pointer": "mocks/sharepoint/Pay/Sick-leave/sick-leave-procedure_v2.md",
  "raw_ref": "doc-014@2.0"
}
```

Real mapping: SharePoint and OneDrive delta queries, Teams and mail via Microsoft Graph, and the HR directory or Entra ID for people.

### 6. Ledger event (append-only, hash-chained)

```json
{
  "id": "evt-0912",
  "ts": "2026-08-12T09:14:00Z",
  "actor_id": "sophie.dubois",
  "type": "source_edited",
  "subject_type": "document",
  "subject_id": "doc-014@2.0",
  "domain_id": "pay.sick-leave",
  "client_id": "client-x",
  "country": "BE",
  "payload": { "from_version": "1.0", "to_version": "2.0" },
  "prev_hash": "sha256:…",
  "hash": "sha256:…"
}
```

Event types: `source_created`, `source_edited`, `source_approved`, `source_superseded`, `question_answered`, `conflict_detected`, `ruling_made`, `task_confirmed`, `person_left`.

Each event stores `hash = H(prev_hash + payload)`, so the history cannot be quietly rewritten.

### 7. Database tables

```sql
app(id, name)
team(id, name, app_id)
domain(id, app_id, name, owner_team_id)
domain_link(from_domain_id, to_domain_id, type)
client(id, name, country)
person(id, name, team_id, status, left_at)
client_binding(person_id, client_id)

document(id, title, current_version_id, status)              -- current | superseded | archived
document_version(id, document_id, version, author_id, modified_by, modified_at, content_hash, pointer)
approval(document_version_id, status, by_person_id, at)
document_area(document_version_id, domain_id, client_id NULL, country NULL,
              confidence, tagged_by, confirmed_by NULL)       -- NULL = applies to all

mail_meta(id, thread_id, from_id, sent_at, domain_id, client_id, references_doc_id)  -- metadata only

event(id, ts, actor_id, type, subject_type, subject_id,
      domain_id, client_id, country, payload_json, prev_hash, hash)

housekeeping_task(id, kind, subject_id, domain_id, status, suggested_action, assigned_team_id)
```

A document can touch several domains through `document_area`, which is why it is a link table.

### 8. Derived outputs (computed, not stored by hand)

**Trust result per document, for a context `(app, domain, client)`:**

```json
{
  "document_id": "doc-014",
  "rank": 1,
  "verdict": "trusted | scope_mismatch | conflict | stale | unowned",
  "signals": {
    "freshness": "latest",
    "approved_by_owner_team": true,
    "owner_active": true,
    "scope_match": "client-specific",
    "consistent_with_siblings": true
  },
  "reasons": ["Latest version (2.0)", "Approved by Pay team on 13 Aug", "Specific to Client X"],
  "excluded": false
}
```

Excluded documents are returned too, with a reason (for example `superseded`, `wrong_country`, `no_owner`).

**Expertise result per person:**

```json
{
  "person_id": "sophie.dubois",
  "score": 0.87,
  "evidence": [
    { "event_id": "evt-0912", "type": "source_edited", "ts": "2026-08-12", "weight": 0.4 },
    { "event_id": "evt-0977", "type": "question_answered", "ts": "2026-09-02", "weight": 0.2 }
  ],
  "last_active": "2026-09-02",
  "bus_factor_risk": false
}
```

Scores use role weights (ruling above approval above edit above answered question) multiplied by a recency decay. The evidence rows are always returned with the score.

## MCP tools

| Tool | Input | Output |
|---|---|---|
| `trusted_docs` | `app, domain, client` | Ranked trust results and exclusions, with reasons |
| `who_knows` | `app, domain, client` | Ranked expertise results with evidence, and bus-factor flags |
| `get_provenance` | `document_id` | Ledger events for that document: who, when, what changed, current status |
| `health` | `app, domain` | Housekeeping findings (orphaned, stale, unreviewed, duplicate, conflicting, gap, bus factor) |

Stretch: `record_ruling(conflict_id, decision)`, allowed only for the owning team of the domain.

## Access control

- The caller's identity comes from the authentication token, never from a tool parameter.
- Every query is filtered by the caller's client bindings.
- Identifiers are not guessable (UUIDs), and there are no sequential IDs exposed in the API.
- Only the owning team of a domain can confirm tags, make rulings, or confirm housekeeping tasks.
- Secrets live in environment variables. The repo is public, so a `.env.example` is committed and real keys never are.

## Built versus mocked

| Piece | Status |
|---|---|
| Ledger, trust, expertise and housekeeping engines | **Built** |
| Access control | **Built** |
| MCP server and web UI | **Built** |
| Ingestion worker and LLM tagging | **Built** (run against mock data, results hand-verified) |
| SharePoint | **Mocked** (watched folder plus metadata, shaped like Microsoft Graph delta output) |
| Mail | **Mocked** (mailbox feed shaped like Graph mail output) |
| Org directory | **Mocked** (seed file) |
| Real connectors (Microsoft Graph, Entra ID) | **Not built**; the connector contract is designed to accept them |

## Sponsor usage

- **Google Cloud:** optional deployed backup on Cloud Run, and Gemini on Vertex AI for tagging. Credentials last one week, so a local `docker compose up` remains the documented way to run it.
- **Aikido:** connect the repo early and run the baseline scan, then fix the authorization and IDOR findings.
- **Cursor:** used for development, guided by `AGENTS.md`.
- **ElevenLabs (stretch):** one outbound voice message or call to a domain owner for a ruling.