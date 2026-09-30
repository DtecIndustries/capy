import type { Doc, Drive, Library, Person, Version } from './library.js'

// Maps library documents onto Microsoft Graph v1.0 shapes (site, drive, driveItem,
// driveItemVersion, listItem), so a connector written against this mock can later be
// pointed at the real Graph API.

const APPROVAL_LABELS = { approved: 'Approved', pending: 'Pending', rejected: 'Rejected' } as const

export function graphError(code: string, message: string) {
  return { error: { code, message } }
}

function identity(library: Library, personId: string) {
  const person: Person | undefined = library.person(personId)
  return { user: { id: personId, displayName: person?.name ?? personId, email: person?.email ?? null } }
}

const email = (library: Library, personId: string | null) => (personId ? (library.person(personId)?.email ?? personId) : null)

export function webUrl(library: Library, doc: Doc, version?: string): string {
  const url = new URL(`${library.site.url}/_layouts/15/Doc.aspx`)
  url.searchParams.set('sourcedoc', doc.id)
  if (version) url.searchParams.set('version', version)
  return url.toString()
}

const current = (doc: Doc): Version => doc.versions[doc.versions.length - 1]

export function toSite(library: Library) {
  return { id: library.site.id, name: library.site.name, displayName: library.site.name, webUrl: library.site.url }
}

export function toDrive(library: Library, drive: Drive) {
  return {
    id: drive.id,
    name: drive.name,
    description: drive.description,
    driveType: 'documentLibrary',
    webUrl: `${library.site.url}/${encodeURIComponent(drive.name)}`,
  }
}

export function toDriveItem(library: Library, doc: Doc) {
  const latest = current(doc)
  const slash = doc.path.lastIndexOf('/')
  const folder = slash === -1 ? '' : `/${doc.path.slice(0, slash)}`
  return {
    id: doc.id,
    name: doc.path.slice(slash + 1),
    eTag: `"{${doc.id}},${doc.changeSeq}"`,
    cTag: `"c:{${doc.id}},${latest.version}"`,
    createdDateTime: doc.created_at,
    lastModifiedDateTime: latest.modified_at,
    size: latest.size,
    webUrl: webUrl(library, doc),
    createdBy: identity(library, doc.created_by),
    lastModifiedBy: identity(library, latest.modified_by),
    parentReference: {
      driveType: 'documentLibrary',
      driveId: doc.drive,
      siteId: library.site.id,
      path: `/drives/${doc.drive}/root:${folder}`,
    },
    file: { mimeType: 'text/markdown', hashes: { sha256Hash: latest.sha256.toUpperCase() } },
    fileSystemInfo: { createdDateTime: doc.created_at, lastModifiedDateTime: latest.modified_at },
  }
}

// Custom library columns. Person columns are given as email addresses for simplicity
// (real Graph returns a *LookupId that has to be resolved against the site's user list).
export function toListItem(library: Library, doc: Doc) {
  const latest = current(doc)
  return {
    id: doc.id,
    createdDateTime: doc.created_at,
    lastModifiedDateTime: doc.lastChangedAt,
    createdBy: identity(library, doc.created_by),
    lastModifiedBy: identity(library, doc.lastChangedBy),
    webUrl: webUrl(library, doc),
    fields: {
      Title: doc.title,
      FileLeafRef: doc.path.slice(doc.path.lastIndexOf('/') + 1),
      DocumentType: doc.document_type,
      Country: doc.country_hint,
      DocumentOwner: email(library, doc.owner),
      ...approvalFields(library, latest),
      Labels: doc.filler.labels,
      CheckoutStatus: doc.filler.check_out_status,
      ViewedBy: doc.filler.last_viewed_by.map((id) => email(library, id)),
      Comments: doc.filler.comments.map((c) => ({ author: email(library, c.by), createdDateTime: c.at, text: c.text })),
    },
  }
}

function approvalFields(library: Library, version: Version) {
  return {
    _UIVersionString: version.version,
    ApprovalStatus: APPROVAL_LABELS[version.approval.status],
    ApprovedBy: email(library, version.approval.by),
    ApprovedDateTime: version.approval.at,
  }
}

// Graph lists versions newest first.
export function toDriveItemVersions(library: Library, doc: Doc) {
  return [...doc.versions].reverse().map((v) => ({
    id: v.version,
    lastModifiedDateTime: v.modified_at,
    lastModifiedBy: identity(library, v.modified_by),
    size: v.size,
    publication: { level: 'published', versionId: v.version },
  }))
}

export function toListItemVersions(library: Library, doc: Doc) {
  return [...doc.versions].reverse().map((v) => ({
    id: v.version,
    lastModifiedDateTime: v.modified_at,
    lastModifiedBy: identity(library, v.modified_by),
    fields: { Title: doc.title, ...approvalFields(library, v) },
  }))
}

// Graph's /shares/{shareId}: "u!" + unpadded base64url of the sharing URL.
export function resolveShare(library: Library, shareId: string): Doc | undefined {
  if (!shareId.startsWith('u!')) return undefined
  let url: URL
  try {
    url = new URL(Buffer.from(shareId.slice(2), 'base64url').toString())
  } catch {
    return undefined
  }
  if (!url.href.startsWith(`${library.site.url}/`)) return undefined
  const docId = url.searchParams.get('sourcedoc')
  return docId ? library.get(docId) : undefined
}
