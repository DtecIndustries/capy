import { sql } from '../db/client.js'

// Minimal Microsoft Graph client: works against the mocks and against graph.microsoft.com.

export class GraphError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export class GraphClient {
  constructor(
    readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async get<T>(pathOrUrl: string, headers: Record<string, string> = {}): Promise<T> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`
    const res = await fetch(url, { headers: { authorization: `Bearer ${this.token}`, ...headers } })
    if (!res.ok) {
      const body = await res.text()
      throw new GraphError(res.status, `GET ${url} -> ${res.status}: ${body.slice(0, 200)}`)
    }
    const type = res.headers.get('content-type') ?? ''
    return (type.includes('application/json') ? await res.json() : await res.text()) as T
  }

  // Runs a delta query from the stored position (or from scratch), following nextLinks.
  // The new deltaLink is only stored after `handle` succeeded for every page, so a failed
  // run is retried from the same position. A 410 means the position expired: start over.
  async delta<T>(stateId: string, initialPath: string, handle: (items: T[]) => Promise<void>): Promise<void> {
    const deltaLink = await this.walk(stateId, initialPath, handle)
    await saveDeltaLink(stateId, deltaLink)
  }

  // Same, but returns everything that changed; call commit() once it has been processed.
  async collectDelta<T>(stateId: string, initialPath: string): Promise<{ items: T[]; commit: () => Promise<void> }> {
    const items: T[] = []
    const deltaLink = await this.walk<T>(stateId, initialPath, async (page) => {
      items.push(...page)
    })
    return { items, commit: () => saveDeltaLink(stateId, deltaLink) }
  }

  private async walk<T>(stateId: string, initialPath: string, handle: (items: T[]) => Promise<void>): Promise<string> {
    const [state] = await sql<{ delta_link: string }[]>`SELECT delta_link FROM connector_state WHERE id = ${stateId}`
    let url = state?.delta_link ?? initialPath
    for (;;) {
      let page: { value: T[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string }
      try {
        page = await this.get(url, { prefer: 'odata.maxpagesize=50' })
      } catch (err) {
        if (err instanceof GraphError && err.status === 410 && url !== initialPath) {
          await sql`DELETE FROM connector_state WHERE id = ${stateId}`
          url = initialPath
          continue
        }
        throw err
      }
      await handle(page.value)
      if (page['@odata.deltaLink']) return page['@odata.deltaLink']
      url = page['@odata.nextLink']!
    }
  }
}

async function saveDeltaLink(stateId: string, deltaLink: string): Promise<void> {
  await sql`
    INSERT INTO connector_state (id, delta_link) VALUES (${stateId}, ${deltaLink})
    ON CONFLICT (id) DO UPDATE SET delta_link = EXCLUDED.delta_link, updated_at = now()
  `
}

// Sources identify people by email; the directory seed maps those to person ids.
export async function personByEmail(email: string | null | undefined): Promise<string | undefined> {
  if (!email) return undefined
  const [row] = await sql<{ id: string }[]>`SELECT id FROM person WHERE lower(email) = lower(${email})`
  return row?.id
}
