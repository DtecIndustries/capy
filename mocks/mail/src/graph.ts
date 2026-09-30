import type { Mailbox, MailRecord, Person } from './mailbox.js'

// Maps mailbox records onto Microsoft Graph v1.0 resource shapes (message, attachment, user),
// so a connector written against this mock can later be pointed at the real Graph API.

export type FolderId = 'inbox' | 'sentitems'

const MESSAGE_ID_DOMAIN = 'mail.capy.example.test'

export function parseFolder(folderId: string): FolderId | undefined {
  const id = folderId.toLowerCase()
  return id === 'inbox' || id === 'sentitems' ? id : undefined
}

export function isInFolder(mail: MailRecord, personId: string, folder: FolderId): boolean {
  if (folder === 'sentitems') return mail.from === personId
  return [...mail.to, ...mail.filler.cc, ...mail.filler.bcc].includes(personId)
}

export function graphError(code: string, message: string) {
  return { error: { code, message } }
}

export function internetMessageId(mail: MailRecord): string {
  return `<${mail.id}@${MESSAGE_ID_DOMAIN}>`
}

function address(person: Person | undefined, fallbackId: string) {
  return { emailAddress: { name: person?.name ?? fallbackId, address: person?.email ?? `${fallbackId}@example.test` } }
}

// Signature, quoted history and disclaimer are part of the body text, as in a real mail.
function fullBody(mail: MailRecord): string {
  const { signature, quoted_history, disclaimer } = mail.filler
  return [mail.body, signature && `--\n${signature}`, quoted_history && `-----\n${quoted_history}`, disclaimer]
    .filter(Boolean)
    .join('\n\n')
}

export function toGraphMessage(mailbox: Mailbox, mail: MailRecord, folder: FolderId) {
  const recipients = (ids: string[]) => ids.map((id) => address(mailbox.person(id), id))
  const from = address(mailbox.person(mail.from), mail.from)
  const ancestors = mailbox.ancestors(mail)
  const headers = ancestors.length
    ? [
        { name: 'In-Reply-To', value: internetMessageId(ancestors[ancestors.length - 1]) },
        { name: 'References', value: ancestors.map(internetMessageId).join(' ') },
      ]
    : []

  return {
    id: mail.id,
    createdDateTime: mail.sent_at,
    lastModifiedDateTime: mail.sent_at,
    receivedDateTime: mail.sent_at,
    sentDateTime: mail.sent_at,
    hasAttachments: mail.filler.attachments.length + mail.references.length > 0,
    internetMessageId: internetMessageId(mail),
    internetMessageHeaders: headers,
    subject: mail.subject,
    bodyPreview: mail.body.replace(/\s+/g, ' ').trim().slice(0, 255),
    importance: mail.filler.importance,
    parentFolderId: folder,
    conversationId: mail.thread_id,
    isRead: true,
    isDraft: false,
    body: { contentType: 'text', content: fullBody(mail) },
    sender: from,
    from,
    toRecipients: recipients(mail.to),
    ccRecipients: recipients(mail.filler.cc),
    // Like Exchange: Bcc is only visible in the sender's copy.
    bccRecipients: folder === 'sentitems' ? recipients(mail.filler.bcc) : [],
    replyTo: [],
  }
}

const CONTENT_TYPES: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
}

// Document references ("doc-014" or "doc-014@2.0") become SharePoint reference attachments,
// which is how a shared SharePoint link travels with a mail in Graph.
export function toGraphAttachments(mail: MailRecord, sharepointBaseUrl: string) {
  const files = mail.filler.attachments.map((a, i) => ({
    '@odata.type': '#microsoft.graph.fileAttachment',
    id: `${mail.id}-att-${i + 1}`,
    name: a.name,
    contentType: CONTENT_TYPES[a.name.split('.').pop() ?? ''] ?? 'application/octet-stream',
    size: a.size_kb * 1024,
    isInline: false,
    lastModifiedDateTime: mail.sent_at,
  }))
  const links = mail.references.map((ref, i) => {
    const [docId, version] = ref.split('@')
    const url = new URL(`${sharepointBaseUrl}/_layouts/15/Doc.aspx`)
    url.searchParams.set('sourcedoc', docId)
    if (version) url.searchParams.set('version', version)
    return {
      '@odata.type': '#microsoft.graph.referenceAttachment',
      id: `${mail.id}-ref-${i + 1}`,
      name: version ? `${docId} (v${version})` : docId,
      contentType: null,
      size: 0,
      isInline: false,
      lastModifiedDateTime: mail.sent_at,
      sourceUrl: url.toString(),
      providerType: 'oneDriveBusiness',
      permission: 'view',
      isFolder: false,
    }
  })
  return [...files, ...links]
}

export function toGraphUser(person: Person, teamName: string | undefined) {
  return {
    id: person.id,
    displayName: person.name,
    mail: person.email,
    userPrincipalName: person.email,
    jobTitle: person.role,
    department: teamName ?? null,
    accountEnabled: person.status === 'active',
  }
}
