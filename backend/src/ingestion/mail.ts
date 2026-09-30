import { sql } from '../db/client.js'
import type { ChangeEvent } from './contract.js'
import { personByEmail, type GraphClient } from './graph.js'
import { record } from './record.js'

// Mail connector: walks every user's Sent Items with a delta query, so each mail is seen
// exactly once (from the sender's side). Only metadata is kept; the body is never stored.
// A reply counts as an answered question; SharePoint links in a mail become document references.

interface Message {
  id: string
  conversationId: string
  sentDateTime: string
  subject: string
  hasAttachments: boolean
  from: { emailAddress: { address: string } }
  toRecipients: { emailAddress: { address: string } }[]
  internetMessageHeaders?: { name: string; value: string }[]
}

interface Attachment {
  '@odata.type': string
  sourceUrl?: string
}

export async function syncMail(mail: GraphClient, sharepoint: GraphClient | undefined): Promise<number> {
  const users = await mail.get<{ value: { id: string; mail: string }[] }>('/users')
  let recorded = 0
  for (const user of users.value) {
    const stateId = `mail:${user.id}:sentitems`
    await mail.delta<Message>(stateId, `/users/${user.id}/mailFolders/sentitems/messages/delta`, async (messages) => {
      const changes: ChangeEvent[] = []
      for (const message of messages) {
        const change = await syncMessage(mail, sharepoint, user.id, message)
        if (change) changes.push(change)
      }
      recorded += await record(changes)
    })
  }
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

  const references = message.hasAttachments && sharepoint ? await documentReferences(mail, sharepoint, userId, message.id) : []
  const inserted = await sql`
    INSERT INTO mail_meta (id, thread_id, from_id, sent_at, references_doc_id)
    VALUES (${message.id}, ${message.conversationId}, ${from}, ${message.sentDateTime}, ${references[0]?.documentId ?? null})
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `
  if (inserted.length === 0) return undefined

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
    details: {
      thread_id: message.conversationId,
      in_reply_to: inReplyTo,
      to: to.filter(Boolean),
      references: references.map((r) => r.ref),
    },
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
