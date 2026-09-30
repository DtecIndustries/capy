import type { TrustResult } from '../types'
import { TrustBadge } from './TrustBadge'

function DocItem({ doc }: { doc: TrustResult }) {
  return (
    <li className="doc">
      <TrustBadge verdict={doc.verdict} />
      <div className="doc-body">
        <div className="doc-title">
          <a href={`#/provenance/${doc.document_id}`}>{doc.title}</a>
          <span className="version">v{doc.version}</span>
        </div>
        <ul className="reasons">
          {doc.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
    </li>
  )
}

export function DocList({ trusted, excluded }: { trusted: TrustResult[]; excluded: TrustResult[] }) {
  return (
    <>
      {trusted.length === 0 ? (
        <p className="empty">No document in this context can be relied on.</p>
      ) : (
        <ol className="docs">
          {trusted.map((d) => (
            <DocItem key={d.document_version_id} doc={d} />
          ))}
        </ol>
      )}
      {excluded.length > 0 && (
        <details className="excluded" open={trusted.length === 0}>
          <summary>
            {excluded.length} excluded {excluded.length === 1 ? 'document' : 'documents'}, and why
          </summary>
          <ol className="docs">
            {excluded.map((d) => (
              <DocItem key={d.document_version_id} doc={d} />
            ))}
          </ol>
        </details>
      )}
    </>
  )
}
