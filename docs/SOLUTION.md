# The Solution

Working name: **Capybara Ledger** (capy-ledger). Tagline: *The answer isn't the product. The reason to trust it is.*

## The idea in one paragraph

Capybara Ledger is a trust layer that sits underneath the tools SD Worx employees already use. For any **application, domain and client** (for example Pay, Sick leave, Client X), it answers two questions with visible evidence: **who knows about this**, and **which documents can be trusted right now**. Both answers are derived from a tamper-evident ledger of who changed what and when, so every ranking can be explained. It is not a search box and it is not another agent. It can be used through our own interface or plugged into an existing agent as an MCP server.

## How it answers the two core questions

### 1. Who knows about this?

Nobody fills in a skills profile. Expertise is derived from the trail that work already leaves behind:

- Documents the person edited or approved in this domain
- Conflicts they ruled on
- Questions they answered for this client
- How recent that activity is (older activity counts less)

The result is a ranked list of people per `(app, domain, client)`, and every score comes with its **evidence rows**, so it can be checked and contested. Gaps are first-class output: if only one person has evidence for a client and domain, that is flagged as a **bus-factor risk**.

### 2. What can we trust?

Every document in the requested context gets trust signals computed from the ledger:

| Signal | Question it answers |
|---|---|
| Freshness | Is this the latest version, or has it been superseded? |
| Verified | Was it reviewed or approved by the team that owns this domain? |
| Owner status | Is the owner still active and still on the owning team? |
| Scope match | Does it apply to this client and country? Client-specific beats generic, and another country's document is excluded. |
| Consistency | Does another current document in the same context contradict it? |

The output is a short ranked list, each item with a badge and a plain-language reason. Excluded documents are shown too, with the reason for exclusion (for example "superseded", "wrong country", "no owner"). If nothing is trustworthy, the system says so and routes to the domain owner instead of returning the least-bad document.

## The shared map: app, then domain

Everything hangs on a small, curated taxonomy:

```
App (HR, Pay, Time)
 └── Domain (e.g. Pay → Sick leave, Gross-to-net, Year-end)
       └── owned by one Team
Client and country are scope modifiers on top.
```

A document can touch several domains. Ownership, expertise, trust and housekeeping are all computed per domain, which is what lets "who to contact" resolve to a team and a named person.

## How it solves their problem

| What SD Worx said or asked | What the solution does |
|---|---|
| No "SharePoint with search" | There is no search box. The input is a context (app, domain, client) and the output is a short, explained list. |
| Not another agent | No autonomous agent. Trust is computed by deterministic rules over a ledger. AI only reads and tags documents, and humans make the rulings. |
| Challenge the black box | Every ranking and every exclusion has a visible reason, traceable to ledger events. |
| Agents return different documents, which to trust? | Documents are compared on freshness, approval, ownership, scope and consistency, with the reasoning shown. Any agent can call the same trust layer through MCP. |
| Who to contact for certain info | Ranked experts per app, domain and client, each with their evidence. |
| Three apps, each with its own team and domains | The taxonomy mirrors this, and ownership and routing follow it. |
| Employees are bound to certain clients | Expertise and access are scoped per client. Users only see what their client bindings allow. |
| Knowledge is spread across SharePoint, email and people's heads | Connectors feed change events from documents and communication metadata into one ledger. Rulings by domain owners capture what used to live only in heads. |
| From "I found something" to "I understand why I can rely on it" | The trust badge, the reasons, and the provenance view. |

### Coverage of the four inspiration areas

- **Trust:** ranked documents with visible signals and reasons
- **Capture:** rulings and confirmations by domain owners are recorded as signed, dated entries, so the next person gets the answer instantly
- **Detect:** stale, orphaned, duplicate and contradicting documents are surfaced automatically
- **Connect:** the right person for a domain and client, with evidence, and routing to the owning team when documents are not enough

## The ledger: provenance for everything

All changes are stored as append-only events: who did what, to which document or claim, when, and in which app and domain. Each event is chained to the previous one by a hash, so the history cannot be quietly rewritten. The same events feed trust, expertise and housekeeping, which keeps the three views consistent.

## Housekeeping as a by-product

The signals that rank documents also produce a work queue, with no separate audit:

| Finding | Suggested action | Goes to |
|---|---|---|
| Orphaned document (owner left) | Reassign or archive | Domain owner team |
| Stale version still circulating | Archive, point to latest | Last editor |
| Never reviewed | Request review | Domain owner |
| Duplicate in the same context | Merge, keep one | Most active editor |
| Contradicting documents | Rule on which is right | Domain owner |
| Domain with no trusted document | Commission one | Domain owner |
| Bus-factor risk | Capture session, pair a second person | Team lead |

The system proposes and a person confirms in one click. The confirmation is itself an event in the ledger, so cleanup improves the next ranking. Nothing is deleted silently. A health board per app shows the state of each domain at a glance.

## Ways to use it

**MCP server (for an existing agent):**

| Tool | Returns |
|---|---|
| `trusted_docs(app, domain, client)` | Ranked trustworthy documents, exclusions, and reasons |
| `who_knows(app, domain, client)` | Ranked people with evidence, and bus-factor flags |
| `get_provenance(document)` | Full change history: who, when, what, current status |
| `health(app, domain)` | Housekeeping findings for that area |

**Our own interface:** a lookup screen (two panels: who knows, what to trust), a provenance view, and the health board.

## The capybara: a readable trust signal

The capybara is the animal every other animal is comfortable around, which makes it a fitting symbol for trust. Its mood is the status badge:

| State | Meaning |
|---|---|
| Relaxed, eyes closed | Verified, current, in scope, owned |
| One raised eyebrow | Scope mismatch (right document, wrong country or client) |
| Sweating | Two current documents disagree |
| Holding a phone | No trusted document, ask the named owner |
| Asleep under a dusty blanket | Stale or ownerless |

The serious panels stay plain and professional. The capybara is the legend, not the content.

## Privacy and security

- **Work artifacts only.** Expertise comes from edits, approvals, rulings and answers, never from private message content.
- **Evidence is visible.** Every expertise score shows its evidence, and the person it concerns can see and contest it.
- **Purpose-limited.** It is used for routing questions and recognition, not for performance ranking.
- **Metadata, not copies.** Originals stay in their source systems. The ledger keeps pointers, hashes, versions, authorship and tags.
- **Client-scoped access.** The caller's identity comes from the authentication token, never from a tool parameter. Every query is filtered by the caller's client bindings, identifiers are not guessable, and only the owning team of a domain can make a ruling.

## Scope of this proof of concept

**Real:** the ledger and change events, the trust and expertise computation, the MCP server, the lookup and health interfaces, the access control.

**Simulated:** a seeded fake tenant (documents, people, teams, clients) with a change feed shaped like Microsoft Graph delta output, and a few planted traps (a superseded version, an ownerless document, a document for another country, two contradicting documents, a single-expert client). All data is synthetic.

**How it would connect in reality:** the same connector contract maps onto Microsoft Graph for SharePoint, mail and Teams, and onto the organisation's directory for people, teams and client bindings.

## Out of scope

- Answering free-text questions or generating summaries
- Replacing SharePoint, email or any existing agent
- Using embeddings or vector search in the trust decision (AI may help tag documents during ingestion, but it never decides what is trustworthy)