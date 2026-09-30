# Mock SharePoint

Stands in for SharePoint Online. Serves one site ("Knowledge Hub") with three document libraries (Pay, Time, HR) through Microsoft Graph–shaped endpoints, so the backend's SharePoint connector can be written against the real API shape and later pointed at `https://graph.microsoft.com/v1.0`.

## Run

```
pnpm install
SHAREPOINT_MOCK_TOKEN=dev-sp-token SHAREPOINT_MOCK_ADMIN_TOKEN=dev-sp-admin-token pnpm dev   # :4020
pnpm test
```

Or `docker compose up sharepoint-mock` from the repo root.

## Files

| Path | Contents |
|---|---|
| `sharepoint.meta.json` | Site, drives, and per document: owner, country, type, and every version with author, time and approval |
| `library/<drive>/<path>` | Current version of each document |
| `history/<doc-id>/<version>.md` | Older versions |
| `live/` | Replacement content for the live demo edits |

Content hashes are SHA-256 over the content with line endings normalised to LF, so they're the same on every machine.

## Endpoints

All require `Authorization: Bearer $SHAREPOINT_MOCK_TOKEN`, except `/health`.

| Endpoint | Graph equivalent |
|---|---|
| `GET /v1.0/sites/root` and `/v1.0/sites/root/drives` | Site and its document libraries |
| `GET /v1.0/drives/{driveId}/root/delta` | Delta query. Pages with `@odata.nextLink`, ends with `@odata.deltaLink`. Page size via `Prefer: odata.maxpagesize=N` (default 10) |
| `GET /v1.0/drives/{driveId}/items/{itemId}[?$expand=listItem]` | driveItem (with `file.hashes.sha256Hash`) |
| `GET …/items/{itemId}/content` | Current content (Markdown) |
| `GET …/items/{itemId}/versions` and `…/versions/{versionId}/content` | Version history, newest first, and the content of each version |
| `GET …/items/{itemId}/listItem` and `…/listItem/versions` | Library columns, now and per version |
| `GET /v1.0/shares/{shareId}/driveItem` | Resolves a sharing link (`u!` + base64url of the URL), such as the document links in mails |

Library columns (`listItem.fields`):

| Column | Meaning |
|---|---|
| `DocumentOwner` | Owner's email address (real Graph returns a lookup id instead) |
| `ApprovalStatus`, `ApprovedBy`, `ApprovedDateTime` | Content approval of that version: `Approved`, `Pending` or `Rejected` |
| `Country` | Country the document applies to (`BE`, `NL`, `FR` or empty for generic) |
| `DocumentType`, `_UIVersionString` | Type and version label |
| `Labels`, `CheckoutStatus`, `ViewedBy`, `Comments` | Realistic filler, not meant for decisions |

**Connector tips:**

- Delta returns each changed document once, in its latest state. It does not return one entry per change, which is also how Graph behaves. Fetch `listItem/versions` to find new versions and approvals, and compare `DocumentOwner` to detect an owner change.
- Delta only contains files, no folder items.

Delta tokens are tied to the process. After a restart, old tokens return `410 resyncRequired`, and the connector restarts the delta query without a token.

## Live demo changes

Live changes are kept in memory only and never written back to disk.

```
export SHAREPOINT_MOCK_ADMIN_TOKEN=dev-sp-admin-token
pnpm sp approve doc-041 --as katrien.janssens
pnpm sp edit doc-050 --as lotte.vermeulen --file live/doc-050-v3.md
pnpm sp set-owner doc-050 --owner lotte.vermeulen --as katrien.janssens
pnpm sp edit doc-071 --as lucas.jacobs --file live/doc-071-v2.md
pnpm sp upload --as anna.claes --drive pay --path "Klanten/Ardenne/Nota.md" --title "Nota" --file nota.md
```

Inside Docker: `docker compose exec sharepoint-mock node dist/cli.js approve doc-041 --as katrien.janssens`.

Rules that match SharePoint:

- Every edit creates a new major version (`--minor` for x.1), and its approval starts over as pending.
- Approval applies to the current version.
- People who have left cannot edit, approve or become owner.

Suggested demo order, paired with the mail presets in `mocks/mail/live/`:

| Moment | Mail | SharePoint |
|---|---|---|
| Contradiction resolved | `01-ruling-client-x-sick-leave` | `sp edit doc-071 --as lucas.jacobs --file live/doc-071-v2.md` |
| Bus factor reduced | `02-second-expert-client-z-year-end` | `sp approve doc-041 --as katrien.janssens` |
| Orphan adopted | `03-takeover-client-y-gross-to-net` | `sp edit doc-050 --as lotte.vermeulen …`, then `sp set-owner doc-050 --owner lotte.vermeulen --as katrien.janssens` |

## Documents and planted traps

| Doc | Library | Title | Trap |
|---|---|---|---|
| doc-014 | Pay | Procedure gewaarborgd loon bedienden (v1.0 → v2.0) | **Superseded version**: v1.0 still has the waiting day (§3.2) that mail-005 cites |
| doc-015 | Pay | Kopie van Procedure… (in *Klanten/Scheldemond*) | **Duplicate**: byte-identical to doc-014 v1.0, never approved |
| doc-021 | Pay | Addendum ziekte Scheldemond | Client-specific, approved (trusted) |
| doc-030 | Pay | Loondoorbetaling bij ziekte NL | **Wrong country** for BE clients (mail-008) |
| doc-040 | Pay | Procedure eindejaarspremie en fiscale fiches | Generic, approved (trusted) |
| doc-041 | Pay | Addendum eindejaar Ardenne Bakkerijen | **Never reviewed** (pending), single expert |
| doc-042 | Pay | Year-end benefits in kind Scheldemond | Client-specific, approved (trusted) |
| doc-050 | Pay | Notitie bruto-netto Polderveld (v1.0 → v2.0) | **Ownerless**: the owner left on 30 June 2026, and v2.0 is still pending |
| doc-060 | HR | Checklist onboarding France (2024) | **Stale**: the medical-visit rule is outdated (mail-023) |
| doc-061 | HR | Modèle CDD saisonnier | Current template, approved |
| doc-070 | Time | Absence code guide | Generic, approved; says AB-01 is legacy |
| doc-071 | Time | Part-time sickness configuration Scheldemond | **Contradiction**: approved by Time, but says day 1 is AB-01, against doc-014 v2.0 and doc-021 |
| doc-080 | Pay | Werkafspraken Pay team | Noise, belongs to no domain |

All content is synthetic. The pay rules are simplified for the demo and are not legal advice.
