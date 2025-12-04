export default function DebugPanel({ flags }) {
  const dbg = typeof window !== 'undefined' ? window.__serenityDebug : null
  const keys = dbg?.keys || []
  const candidate = dbg?.flagsCandidate || null
  const responseKeys = dbg?.responseKeys || []
  const rawSnippet = dbg?.rawSnippet || null
  const rawResponse = dbg?.rawResponse || null
  return (
    <div style={{ marginTop: 12, fontSize: 12, color: '#555' }}>
      <div><strong>Debug:</strong></div>
      <div>response keys: {responseKeys.length ? responseKeys.join(', ') : '(none)'}</div>
      <div>action_results keys: {keys.length ? keys.join(', ') : '(none)'}</div>
      <div>candidate flags: {candidate ? JSON.stringify(candidate) : 'null'}</div>
      <div>ui flags: {flags ? JSON.stringify(flags) : 'null'}</div>
      <div>content snippet: {rawSnippet ? rawSnippet : '(none)'}</div>
      <details style={{ marginTop: 8 }}>
        <summary>Full response (JSON)</summary>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{rawResponse ? JSON.stringify(rawResponse, null, 2) : 'null'}</pre>
      </details>
    </div>
  )
}