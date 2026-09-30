import { createHash } from 'crypto'
import { sql } from '../db/client.js'
import type { ChangeEvent } from './contract.js'
import { personByEmail, type GraphClient } from './graph.js'
import { record } from './record.js'

// SharePoint connector: walks every document library with a delta query and turns new
// versions, approvals and owner changes into change events. Delta only says *that* a file
// changed, so each changed file's version history is compared with what we already stored.

interface Identity {
  user?: { email?: string | null }
}

interface DriveItem {
  id: string
  webUrl: string
  file?: unknown
  deleted?: unknown
  createdBy: Identity
  parentReference: { driveId: string; path?: string }
}

interface ListItem {
  lastModifiedDateTime: string
  lastModifiedBy: Identity
  fields: { Title: string; Country: string | null; DocumentOwner: string | null }
}

interface ListItemVersion {
  id: string
  lastModifiedDateTime: string
  lastModifiedBy: Identity
  fields: { ApprovalStatus: 'Approved' | 'Pending' | 'Rejected'; ApprovedBy: string | null; ApprovedDateTime: string | null }
}

export async function syncSharePoint(client: GraphClient): Promise<number> {
  const drives = await client.get<{ value: { id: string; name: string }[] }>('/sites/root/drives')
  let recorded = 0
  for (const drive of drives.value) {
    await client.delta<DriveItem>(`sharepoint:${drive.id}`, `/drives/${drive.id}/root/delta`, async (items) => {
      const changes: ChangeEvent[] = []
      for (const item of items) {
        if (item.file && !item.deleted) changes.push(...(await syncItem(client, drive.name, item)))
      }
      recorded += await record(changes)
    })
  }
  return recorded
}

async function syncItem(client: GraphClient, driveName: string, item: DriveItem): Promise<ChangeEvent[]> {
  const itemPath = `/drives/${item.parentReference.driveId}/items/${item.id}`
  const listItem = await client.get<ListItem>(`${itemPath}/listItem`)
  const versions = (await client.get<{ value: ListItemVersion[] }>(`${itemPath}/listItem/versions`)).value.reverse()
  const createdBy = await personByEmail(item.createdBy.user?.email)
  const owner = await personByEmail(listItem.fields.DocumentOwner)
  if (!createdBy || versions.length === 0) return []

  const folder = item.parentReference.path?.split('root:')[1] ?? ''
  const location = `${driveName}${folder}`
  const country = listItem.fields.Country
  const changes: ChangeEvent[] = []

  const [existing] = await sql<{ owner_id: string | null }[]>`SELECT owner_id FROM document WHERE id = ${item.id}`
  const latest = `${item.id}@${versions[versions.length - 1].id}`
  await sql`
    INSERT INTO document (id, title, current_version_id, status, owner_id, country_hint)
    VALUES (${item.id}, ${listItem.fields.Title}, NULL, 'current', ${owner ?? null}, ${country})
    ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, owner_id = EXCLUDED.owner_id, country_hint = EXCLUDED.country_hint
  `

  const stored = await sql<{ id: string; status: string | null }[]>`
    SELECT v.id, a.status FROM document_version v LEFT JOIN approval a ON a.document_version_id = v.id
    WHERE v.document_id = ${item.id}
  `
  const storedApproval = new Map(stored.map((r) => [r.id, r.status]))

  for (const [i, version] of versions.entries()) {
    const versionId = `${item.id}@${version.id}`
    const modifiedBy = await personByEmail(version.lastModifiedBy.user?.email)
    if (!modifiedBy) continue
    const pointer = `${item.webUrl}&version=${version.id}`

    if (!storedApproval.has(versionId)) {
      const content = await client.get<string>(`${itemPath}/versions/${version.id}/content`)
      const contentHash = `sha256:${createHash('sha256').update(content.replace(/\r\n/g, '\n')).digest('hex')}`
      await sql`
        INSERT INTO document_version (id, document_id, version, author_id, modified_by, modified_at, content_hash, pointer)
        VALUES (${versionId}, ${item.id}, ${version.id}, ${createdBy}, ${modifiedBy}, ${version.lastModifiedDateTime}, ${contentHash}, ${pointer})
      `
      changes.push({
        source_type: 'sharepoint',
        source_id: item.id,
        action: i === 0 ? 'created' : 'edited',
        actor: modifiedBy,
        timestamp: version.lastModifiedDateTime,
        content_hash: contentHash,
        location,
        pointer,
        raw_ref: versionId,
        country,
        details: i === 0 ? { title: listItem.fields.Title } : { from_version: versions[i - 1].id, to_version: version.id },
      })
    }

    // Pending means "no decision yet", which is simply no approval row.
    const status = version.fields.ApprovalStatus.toLowerCase()
    const approver = await personByEmail(version.fields.ApprovedBy)
    if (status !== 'pending' && approver && version.fields.ApprovedDateTime && storedApproval.get(versionId) !== status) {
      await sql`
        INSERT INTO approval (document_version_id, status, by_person_id, at)
        VALUES (${versionId}, ${status}, ${approver}, ${version.fields.ApprovedDateTime})
        ON CONFLICT (document_version_id) DO UPDATE SET status = EXCLUDED.status, by_person_id = EXCLUDED.by_person_id, at = EXCLUDED.at
      `
      if (status === 'approved') {
        changes.push({
          source_type: 'sharepoint',
          source_id: item.id,
          action: 'approved',
          actor: approver,
          timestamp: version.fields.ApprovedDateTime,
          location,
          pointer,
          raw_ref: versionId,
          country,
        })
      }
    }
  }

  await sql`UPDATE document SET current_version_id = ${latest} WHERE id = ${item.id}`

  if (existing && existing.owner_id !== (owner ?? null)) {
    const changedBy = await personByEmail(listItem.lastModifiedBy.user?.email)
    changes.push({
      source_type: 'sharepoint',
      source_id: item.id,
      action: 'owner_changed',
      actor: changedBy ?? 'unknown',
      timestamp: listItem.lastModifiedDateTime,
      location,
      country,
      details: { from: existing.owner_id, to: owner ?? null },
    })
  }
  return changes
}
