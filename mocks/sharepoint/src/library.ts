import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Shapes follow docs/ARCHITECTURE.md ("Org directory" and "Mock SharePoint document").

export interface Person {
  id: string
  name: string
  team: string
  status: 'active' | 'left'
  left_at: string | null
  email: string
}

export interface Directory {
  teams: { id: string; name: string }[]
  people: Person[]
}

export type ApprovalStatus = 'approved' | 'pending' | 'rejected'

export interface Approval {
  status: ApprovalStatus
  by: string | null
  at: string | null
}

export interface VersionMeta {
  version: string
  modified_by: string
  modified_at: string
  approval: Approval
}

export interface DocumentMeta {
  id: string
  drive: string
  path: string
  title: string
  document_type: string
  owner: string
  country_hint: string | null
  created_by: string
  created_at: string
  versions: VersionMeta[]
  filler: {
    labels: string[]
    check_out_status: string
    last_viewed_by: string[]
    comments: { by: string; at: string; text: string }[]
  }
}

export interface Site {
  id: string
  name: string
  url: string
}

export interface Drive {
  id: string
  name: string
  description: string
}

export interface LibraryMeta {
  site: Site
  drives: Drive[]
  documents: DocumentMeta[]
}

export interface Version extends VersionMeta {
  content: string
  sha256: string
  size: number
}

export interface Doc extends Omit<DocumentMeta, 'versions'> {
  versions: Version[]
  // Global change counter; delta queries return documents changed after a given value.
  changeSeq: number
  lastChangedAt: string
  // Who made the last change of any kind (edit, approval, owner change).
  lastChangedBy: string
}

export class LibraryError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message)
  }
}

// Line endings are normalised so hashes are identical on every OS and checkout.
function toVersion(meta: VersionMeta, raw: string): Version {
  const content = raw.replace(/\r\n/g, '\n')
  return {
    ...meta,
    content,
    sha256: createHash('sha256').update(content).digest('hex'),
    size: Buffer.byteLength(content),
  }
}

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

function lastEvent(versions: VersionMeta[]): { at: string; by: string } {
  return versions
    .flatMap((v) => [
      { at: v.modified_at, by: v.modified_by },
      ...(v.approval.at && v.approval.by ? [{ at: v.approval.at, by: v.approval.by }] : []),
    ])
    .sort((a, b) => a.at.localeCompare(b.at))
    .pop()!
}

export class Library {
  private readonly docs = new Map<string, Doc>()
  private readonly people: Map<string, Person>
  private seq = 0

  constructor(
    readonly site: Site,
    readonly drives: Drive[],
    readonly directory: Directory,
  ) {
    this.people = new Map(directory.people.map((p) => [p.id, p]))
  }

  get lastSeq(): number {
    return this.seq
  }

  get size(): number {
    return this.docs.size
  }

  get(id: string): Doc | undefined {
    return this.docs.get(id)
  }

  person(id: string): Person | undefined {
    return this.people.get(id)
  }

  drive(idOrName: string): Drive | undefined {
    const key = idOrName.toLowerCase()
    return this.drives.find((d) => d.id === key || d.name.toLowerCase() === key || d.id === `drive-${key}`)
  }

  since(seq: number, driveId: string): Doc[] {
    return [...this.docs.values()]
      .filter((d) => d.drive === driveId && d.changeSeq > seq)
      .sort((a, b) => a.changeSeq - b.changeSeq)
  }

  seed(meta: DocumentMeta, contents: string[]): void {
    this.validateNew(meta.id, meta.drive, meta.path)
    this.requirePerson(meta.owner)
    this.requireActive(meta.created_by, meta.created_at)
    const versions = meta.versions.map((v, i) => toVersion(v, contents[i]))
    versions.forEach((v, i) => {
      this.requireActive(v.modified_by, v.modified_at)
      if (i > 0 && Date.parse(v.modified_at) < Date.parse(versions[i - 1].modified_at)) {
        throw new LibraryError(`${meta.id}: version ${v.version} is older than the version before it`)
      }
      if (v.approval.status !== 'pending') {
        if (!v.approval.by || !v.approval.at) throw new LibraryError(`${meta.id}@${v.version}: approval needs by and at`)
        this.requireActive(v.approval.by, v.approval.at)
        if (Date.parse(v.approval.at) < Date.parse(v.modified_at)) {
          throw new LibraryError(`${meta.id}@${v.version}: approved before it was written`)
        }
      }
    })
    const last = lastEvent(versions)
    this.docs.set(meta.id, { ...meta, versions, changeSeq: ++this.seq, lastChangedAt: last.at, lastChangedBy: last.by })
  }

  upload(input: {
    as: string
    drive: string
    path: string
    title: string
    content: string
    document_type?: string
    owner?: string
    country?: string
  }): Doc {
    const drive = this.drive(input.drive) ?? this.fail(`Unknown drive '${input.drive}'`, 404)
    const at = now()
    this.requireActive(input.as, at)
    const owner = input.owner ?? input.as
    this.requireActive(owner, at)
    const id = this.nextDocId()
    this.validateNew(id, drive.id, input.path)
    const doc: Doc = {
      id,
      drive: drive.id,
      path: input.path,
      title: input.title,
      document_type: input.document_type ?? 'Document',
      owner,
      country_hint: input.country ?? null,
      created_by: input.as,
      created_at: at,
      versions: [
        toVersion(
          { version: '1.0', modified_by: input.as, modified_at: at, approval: { status: 'pending', by: null, at: null } },
          input.content,
        ),
      ],
      filler: { labels: [], check_out_status: 'none', last_viewed_by: [], comments: [] },
      changeSeq: ++this.seq,
      lastChangedAt: at,
      lastChangedBy: input.as,
    }
    this.docs.set(id, doc)
    return doc
  }

  // Like SharePoint content approval: every new version starts as pending again.
  addVersion(id: string, input: { as: string; content: string; minor?: boolean }): Doc {
    const doc = this.require(id)
    const at = now()
    this.requireActive(input.as, at)
    const [major, minor] = doc.versions[doc.versions.length - 1].version.split('.').map(Number)
    const version = input.minor ? `${major}.${minor + 1}` : `${major + 1}.0`
    doc.versions.push(
      toVersion({ version, modified_by: input.as, modified_at: at, approval: { status: 'pending', by: null, at: null } }, input.content),
    )
    return this.touch(doc, at, input.as)
  }

  approve(id: string, input: { as: string; status: 'approved' | 'rejected' }): Doc {
    const doc = this.require(id)
    const at = now()
    this.requireActive(input.as, at)
    const current = doc.versions[doc.versions.length - 1]
    if (current.approval.status === 'approved') {
      throw new LibraryError(`${id}@${current.version} is already approved`, 409)
    }
    current.approval = { status: input.status, by: input.as, at }
    return this.touch(doc, at, input.as)
  }

  setOwner(id: string, input: { as: string; owner: string }): Doc {
    const doc = this.require(id)
    const at = now()
    this.requireActive(input.as, at)
    this.requireActive(input.owner, at)
    doc.owner = input.owner
    return this.touch(doc, at, input.as)
  }

  private touch(doc: Doc, at: string, by: string): Doc {
    doc.changeSeq = ++this.seq
    doc.lastChangedAt = at
    doc.lastChangedBy = by
    return doc
  }

  private nextDocId(): string {
    const max = [...this.docs.keys()].reduce((m, id) => Math.max(m, Number(id.slice(4)) || 0), 0)
    return `doc-${String(max + 1).padStart(3, '0')}`
  }

  private require(id: string): Doc {
    return this.docs.get(id) ?? this.fail(`Unknown document '${id}'`, 404)
  }

  private requirePerson(id: string): Person {
    return this.people.get(id) ?? this.fail(`Unknown person '${id}'`)
  }

  private requireActive(id: string, at: string): Person {
    const person = this.requirePerson(id)
    if (person.left_at && Date.parse(at) > Date.parse(person.left_at)) {
      this.fail(`'${id}' left on ${person.left_at} and cannot act on ${at}`)
    }
    return person
  }

  private validateNew(id: string, driveId: string, path: string): void {
    if (this.docs.has(id)) this.fail(`Duplicate document id '${id}'`, 409)
    if (!this.drives.some((d) => d.id === driveId)) this.fail(`${id}: unknown drive '${driveId}'`)
    if (!path.endsWith('.md') || path.startsWith('/') || path.split('/').includes('..')) this.fail(`Invalid path '${path}'`)
    for (const d of this.docs.values()) {
      if (d.drive === driveId && d.path.toLowerCase() === path.toLowerCase()) {
        this.fail(`A file already exists at '${path}'`, 409)
      }
    }
  }

  private fail(message: string, status: 400 | 404 | 409 = 400): never {
    throw new LibraryError(message, status)
  }
}

// Current versions live in library/<drive name>/<path>, older ones in history/<doc id>/<version>.md.
export function loadLibrary(metaPath: string, directory: Directory): Library {
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as LibraryMeta
  const root = dirname(metaPath)
  const library = new Library(meta.site, meta.drives, directory)

  // Seed in chronological order, so the initial delta reads like the library's history.
  const documents = [...meta.documents].sort((a, b) => lastEvent(a.versions).at.localeCompare(lastEvent(b.versions).at))

  for (const doc of documents) {
    const driveName = meta.drives.find((d) => d.id === doc.drive)?.name ?? doc.drive
    const contents = doc.versions.map((v, i) =>
      readFileSync(
        i === doc.versions.length - 1 ? join(root, 'library', driveName, doc.path) : join(root, 'history', doc.id, `${v.version}.md`),
        'utf8',
      ),
    )
    try {
      library.seed(doc, contents)
    } catch (err) {
      throw new Error(`${metaPath}: ${(err as Error).message}`)
    }
  }
  return library
}
