import { sql } from '../db/client.js'
import type { ChangeEvent } from './contract.js'
import { personByEmail, type GraphClient } from './graph.js'
import { record } from './record.js'
import { tagMail } from './tagging.js'

// Mail connector: walks every user's Sent Items with a delta query, so each mail is seen
// exactly once (from the sender's side). All new mails are processed oldest first, so a
// reply can inherit its thread's topic. Only metadata and tags are kept; the body is read
// for tagging and never stored. A reply counts as an answered question; SharePoint links
// in a mail become document references.

interface Message {
  id: string
  conversationId: string
  sentDateTime: string
  subject: string
  hasAttachments: boolean
  body?: { content: string }
  from: { emailAddress: { address: string } }
  toRecipients: { emailAddress: { address: string } }[]
  internetMessageHeaders?: { name: string; value: string }[]
}

interface Attachment {
  '@odata.type': string
  sourceUrl?: string
}

export async function syncMail(mail: GraphClient, sharepoint: GraphClient | undefined): Promise<number> {
  const users = await mail.get<{ value: { id: string }[] }>('/users')
  const collected: { userId: string; message: Message }[] = []
  const commits: (() => Promise<void>)[] = []
  for (const user of users.value) {
    const delta = await mail.collectDelta<Message>(`mail:${user.id}:sentitems`, `/users/${user.id}/mailFolders/sentitems/messages/delta`)
    collected.push(...delta.items.map((message) => ({ userId: user.id, message })))
    commits.push(delta.commit)
  }
  collected.sort((a, b) => a.message.sentDateTime.localeCompare(b.message.sentDateTime))

  const changes: ChangeEvent[] = []
  for (const { userId, message } of collected) {
    const change = await syncMessage(mail, sharepoint, userId, message)
    if (change) changes.push(change)
  }
  const recorded = await record(changes)
  for (const commit of commits) await commit()
  return recorded
}

async function syncMessage(
  mail: GraphClient,
  sharepoint: GraphClient | undefined,
  userId: string,
  message: Message,
): Promise<ChangeEvent | undefined> {
  const from = await personByEmail(message.from.emailAddress.address)
  if (!from) return undefined
  const [known] = await sql`SELECT 1 FROM mail_meta WHERE id = ${message.id}`
  if (known) return undefined

  const references = message.hasAttachments && sharepoint ? await documentReferences(mail, sharepoint, userId, message.id) : []
  const tags = await tagsFor(message, references.map((r) => r.documentId))

  await sql`
    INSERT INTO mail_meta (id, thread_id, from_id, sent_at, domain_id, client_id, references_doc_id)
    VALUES (${message.id}, ${message.conversationId}, ${from}, ${message.sentDateTime},
            ${tags.domain_id}, ${tags.client_id}, ${references[0]?.documentId ?? null})
    ON CONFLICT (id) DO NOTHING
  `

  const header = (name: string) =>
    message.internetMessageHeaders?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value
  const autoSubmitted = header('Auto-Submitted')
  const inReplyTo = header('In-Reply-To')
  if (!inReplyTo || (autoSubmitted && autoSubmitted !== 'no')) return undefined

  const to = await Promise.all(message.toRecipients.map((r) => personByEmail(r.emailAddress.address)))
  return {
    source_type: 'mail',
    source_id: message.id,
    action: 'replied',
    actor: from,
    timestamp: message.sentDateTime,
    location: `thread ${message.conversationId}`,
    domain_id: tags.domain_id,
    client_id: tags.client_id,
    details: {
      thread_id: message.conversationId,
      in_reply_to: inReplyTo,
      to: to.filter(Boolean),
      references: references.map((r) => r.ref),
      ...(tags.domain_id && { domains: [tags.domain_id] }),
    },
  }
}

// The mail's own words first, then the documents it links to, then the rest of its thread.
async function tagsFor(message: Message, documentIds: string[]): Promise<{ domain_id: string | null; client_id: string | null }> {
  const own = await tagMail({ subject: message.subject, body: message.body?.content ?? '' })
  const [linked] = documentIds.length
    ? await sql<{ domain_id: string; client_id: string | null }[]>`
        SELECT da.domain_id, da.client_id FROM document d
        JOIN document_area da ON da.document_version_id = d.current_version_id
        WHERE d.id = ANY(${documentIds}) ORDER BY da.confidence DESC LIMIT 1`
    : []
  const [thread] = await sql<{ domain_id: string | null; client_id: string | null }[]>`
    SELECT domain_id, client_id FROM mail_meta
    WHERE thread_id = ${message.conversationId} AND domain_id IS NOT NULL
    ORDER BY sent_at LIMIT 1
  `
  return {
    domain_id: own.domain_id ?? linked?.domain_id ?? thread?.domain_id ?? null,
    client_id: own.client_id ?? linked?.client_id ?? thread?.client_id ?? null,
  }
}

// Resolves SharePoint links (reference attachments) to our document ids through /shares,
// keeping only documents the SharePoint connector already knows.
async function documentReferences(mail: GraphClient, sharepoint: GraphClient, userId: string, messageId: string) {
  const attachments = await mail.get<{ value: Attachment[] }>(`/users/${userId}/messages/${messageId}/attachments`)
  const references: { documentId: string; ref: string }[] = []
  for (const a of attachments.value) {
    if (a['@odata.type'] !== '#microsoft.graph.referenceAttachment' || !a.sourceUrl) continue
    try {
      const shareId = `u!${Buffer.from(a.sourceUrl).toString('base64url')}`
      const item = await sharepoint.get<{ id: string }>(`/shares/${shareId}/driveItem`)
      const [known] = await sql`SELECT 1 FROM document WHERE id = ${item.id}`
      if (!known) continue
      const version = new URL(a.sourceUrl).searchParams.get('version')
      references.push({ documentId: item.id, ref: version ? `${item.id}@${version}` : item.id })
    } catch {
      // A link to something we can't resolve is not a document reference.
    }
  }
  return references
}
