import type { FastifyBaseLogger } from 'fastify'
import { detectConflicts } from './conflicts.js'
import { GraphClient } from './graph.js'
import { syncMail } from './mail.js'
import { record } from './record.js'
import { loadSeed } from './seed.js'
import { syncSharePoint } from './sharepoint.js'

// One full pass: documents, then contradictions between them, then mails.
export async function ingestOnce(sharepoint: GraphClient | undefined, mail: GraphClient | undefined) {
  const documents = sharepoint ? await syncSharePoint(sharepoint) : 0
  const conflicts = documents > 0 ? await detectConflicts() : 0
  const mails = mail ? await syncMail(mail, sharepoint) : 0
  return { documents, mails, conflicts }
}

function client(urlVar: string, tokenVar: string): GraphClient | undefined {
  const url = process.env[urlVar]
  const token = process.env[tokenVar]
  return url && token ? new GraphClient(url, token) : undefined
}

// Loads the directory once, then polls the sources in order: SharePoint before mail, so
// mail references can point at known documents. Runs never overlap.
export async function startIngestion(log: FastifyBaseLogger): Promise<void> {
  const personLeft = await record(await loadSeed())
  log.info({ personLeft }, 'directory seed loaded')

  const sharepoint = client('SHAREPOINT_GRAPH_URL', 'SHAREPOINT_GRAPH_TOKEN')
  const mail = client('MAIL_GRAPH_URL', 'MAIL_GRAPH_TOKEN')
  if (!sharepoint) log.warn('SHAREPOINT_GRAPH_URL/TOKEN not set, SharePoint connector disabled')
  if (!mail) log.warn('MAIL_GRAPH_URL/TOKEN not set, mail connector disabled')

  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      const { documents, mails, conflicts } = await ingestOnce(sharepoint, mail)
      if (documents + mails + conflicts > 0) log.info({ documents, mails, conflicts }, 'ingested ledger events')
    } catch (err) {
      log.error(err, 'ingestion run failed, retrying next interval')
    } finally {
      running = false
    }
  }

  await tick()
  setInterval(tick, Number(process.env.INGEST_INTERVAL_MS ?? 10_000))
}
