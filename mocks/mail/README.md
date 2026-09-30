# Mock Mail

Stands in for Exchange Online. Serves `mailbox.jsonl` through Microsoft Graph–shaped endpoints so the backend's mail connector can be written against the real API shape and later pointed at `https://graph.microsoft.com/v1.0`.

## Run

```
pnpm install
MAIL_MOCK_TOKEN=dev-mail-token MAIL_MOCK_ADMIN_TOKEN=dev-mail-admin-token pnpm dev   # :4010
pnpm test
```

Or `docker compose up mail-mock` from the repo root.

## Endpoints

All require `Authorization: Bearer $MAIL_MOCK_TOKEN`, except `/health`.

| Endpoint | Graph equivalent |
|---|---|
| `GET /v1.0/users` and `/v1.0/users/{id}` | Directory users (`accountEnabled: false` for leavers) |
| `GET /v1.0/users/{id}/mailFolders/{inbox\|sentitems}/messages/delta` | Delta query. Pages with `@odata.nextLink`, ends with `@odata.deltaLink`. Page size via `Prefer: odata.maxpagesize=N` (default 10) |
| `GET /v1.0/users/{id}/messages/{messageId}[?$expand=attachments]` | Single message, only for its sender or recipients |
| `GET /v1.0/users/{id}/messages/{messageId}/attachments` | File attachments, plus `referenceAttachment` entries for the SharePoint documents in `references` |

`{id}` accepts a person id or an email address.

**Connector tip:** walk `sentitems` for every user to see each mail exactly once. The `inbox` folders contain the same mails once per recipient.

How mailbox fields map to Graph:

| Mailbox | Graph |
|---|---|
| `thread_id` | `conversationId` |
| `is_reply_to` | `internetMessageHeaders` `In-Reply-To` / `References` (`<mail-xxx@mail.capy.example.test>`) |
| `references` (`doc-014@2.0`) | `referenceAttachment.sourceUrl` `…/Doc.aspx?sourcedoc=doc-014&version=2.0` |
| `filler.*` | cc/bcc recipients, importance, signature, quoted history and disclaimer inside `body.content` |

Delta tokens are tied to the process. After a restart, old tokens return `410 SyncStateNotFound`, and the connector restarts the delta query without a token, as it would with Graph.

## Live demo mails

Live mails are kept in memory only and never written back to `mailbox.jsonl`.

```
MAIL_MOCK_ADMIN_TOKEN=dev-mail-admin-token pnpm send-mail --file live/01-ruling-client-x-sick-leave.json
pnpm send-mail --from jan.peeters --to tom.maes --subject "Quick question" --body "..." --ref doc-050
```

Inside Docker: `docker compose exec mail-mock node dist/send-mail.js --file live/02-second-expert-client-z-year-end.json`.

| Preset | Demo moment |
|---|---|
| `01-ruling-client-x-sick-leave` | Domain owner rules on the day-one vs day-two contradiction (thr-02) |
| `02-second-expert-client-z-year-end` | Second person gains evidence on Ardenne year-end, which lowers the bus-factor risk |
| `03-takeover-client-y-gross-to-net` | Lotte takes over Polderveld from a leaver |

## Planted traps in the mailbox

| Mails | Trap |
|---|---|
| mail-005 | Cites the superseded `doc-014@1.0` and contradicts mail-002 and mail-006 |
| mail-008 | NL rule (`doc-030`) given for a BE client, corrected by mail-009 |
| mail-010 to mail-015 | Only Sophie ever answers Ardenne (client-z) year-end questions, and her out-of-office confirms there's no back-up |
| mail-016 to mail-021 | Polderveld (client-y) expertise sits with Pieter, who left on 2026-06-30 |
| mail-026, 027, 028 | Noise: team lunch, timesheet reminder, training |

The referenced documents (`doc-014`, `doc-021`, `doc-030`, `doc-040`, `doc-041`, `doc-042`, `doc-050`, `doc-060`, `doc-061`, `doc-070`) are to be provided by the SharePoint mock.
