import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  createConversation,
  sendMessage,
  extractFlagsFromResponse,
  evaluateFlagsWithSecondAgent,
  extractAssistantResult,
} from '../services/serenityApi.js'

// Minimal, demo-focused chat with 3-column intervention view
export default function RiskInterventionChat() {
  const [chatId, setChatId] = useState(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [turns, setTurns] = useState([])
  const [error, setError] = useState('')
  const [pendingInterventionContext, setPendingInterventionContext] = useState('')

  // Initialize GAIA chat
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const id = await createConversation({})
        if (!alive) return
        setChatId(id)
      } catch (e) {
        setError('No fue posible iniciar la conversación. Verifique API Key/Agent.')
      }
    })()
    return () => { alive = false }
  }, [])

  const newChat = async () => {
    if (sending) return
    setError('')
    try {
      const id = await createConversation({})
      setChatId(id)
      setTurns([])
      setPendingInterventionContext('')
      setInput('')
    } catch (e) {
      setError('No fue posible iniciar un nuevo chat.')
    }
  }

  // Build a plain history for second agent (use intervention text when available)
  const buildHistory = () => {
    const history = []
    for (const t of turns) {
      history.push({ role: 'user', content: t.userText })
      const assistantContent = (t.interventionText && t.interventionText.trim()) ? t.interventionText : (t.gaiaText || '')
      if (assistantContent) history.push({ role: 'assistant', content: assistantContent })
    }
    return history
  }

  const onSend = async () => {
    const text = input.trim()
    if (!text || !chatId || sending) return
    setError('')

    // Optionally inform GAIA about last intervention, prefixed once on next user turn
    const finalText = pendingInterventionContext
      ? `[Contexto del sistema: En el turno anterior se reemplazó la respuesta por intervención de riesgo. Respuesta de intervención: "${pendingInterventionContext}"\n]\n${text}`
      : text

    const userAt = Date.now()
    const baseTurn = {
      id: `${userAt}-${Math.random().toString(16).slice(2)}`,
      userText: text,
      userAt,
      status: 'pending', // pending | normal | flagged
      gaiaText: '',
      flags: null,
      risk: null,
      interventionText: '',
    }
    setTurns((prev) => [...prev, baseTurn])
    setInput('')
    setSending(true)

    try {
      // 1) Send to GAIA (primary)
      const resp = await sendMessage({ chatId, message: finalText })
      const { text: gaiaTextCandidate } = extractAssistantResult(resp)
      const gaiaText = (gaiaTextCandidate || '').trim()
      // Expose raw for debugging
      try { window.__serenityLastPrimary = resp } catch {}
      const flags = extractFlagsFromResponse(resp)
      const hasFlags = !!(flags && (flags.TendenciaSuicida || flags.PautasDeAlarmaClinicas || flags.ViolenciaRiesgoExtremo))
      try { if (!hasFlags) console.debug('[Flags] none detected. Keys:', Object.keys(resp || {})) } catch {}

      if (!hasFlags) {
        // Normal turn: render GAIA answer immediately
        setTurns((prev) => prev.map((t) => (
          t.id === baseTurn.id
            ? { ...t, status: 'normal', gaiaText }
            : t
        )))
        // Clear any pending context after it has been sent
        if (pendingInterventionContext) setPendingInterventionContext('')
      } else {
        // Flagged turn: wait for second agent, then render all at once
        const history = [...buildHistory(), { role: 'user', content: text }]
        const { text: riskText, json: riskJson } = await evaluateFlagsWithSecondAgent({ history, flags })

        const intervention = pickInterventionText(riskJson, riskText)
        // Save context to inform GAIA on next turn (best-effort as per requirement "si posible")
        if (intervention && intervention.trim()) setPendingInterventionContext(intervention.trim())

        setTurns((prev) => prev.map((t) => (
          t.id === baseTurn.id
            ? {
                ...t,
                status: 'flagged',
                gaiaText,
                flags: { ...flags },
                risk: normalizeRisk(riskJson, riskText),
                interventionText: intervention,
              }
            : t
        )))
      }
    } catch (e) {
      setError('No fue posible enviar o procesar el mensaje.')
      // Roll back pending turn to error state
      setTurns((prev) => prev.map((t) => (t.id === baseTurn.id ? { ...t, status: 'error' } : t)))
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={styles.container}>
      <Header onNewChat={newChat} disabled={sending} />
      <div style={styles.scroll}>
        {turns.map((t) => (
          <TurnView key={t.id} turn={t} />
        ))}
      </div>
      {error ? <div style={styles.error}>{error}</div> : null}
      <Composer
        value={input}
        onChange={setInput}
        onSend={onSend}
        disabled={!chatId || sending}
      />
    </div>
  )
}

function TurnView({ turn }) {
  if (turn.status === 'pending') {
    return (
      <div style={styles.turn}>
        <Bubble who="user" text={turn.userText} />
        <div style={styles.pending}>Analizando…</div>
      </div>
    )
  }
  if (turn.status === 'error') {
    return (
      <div style={styles.turn}>
        <Bubble who="user" text={turn.userText} />
        <div style={styles.error}>Error al procesar el turno.</div>
      </div>
    )
  }
  if (turn.status === 'normal') {
    return (
      <div style={styles.turn}>
        <Bubble who="user" text={turn.userText} />
        <Bubble who="assistant" text={turn.gaiaText} />
      </div>
    )
  }
  // flagged
  const when = new Date(turn.userAt)
  return (
    <div style={styles.turn}>
      <Bubble who="user" text={turn.userText} />
      <div style={styles.columns}>
        <div style={{ ...styles.col, ...styles.colGaia }}>
          <SectionTitle title="GAIA Comunidad (Chat principal)" />
          <div style={styles.replacedTag}>Respuesta reemplazada por intervención de riesgo</div>
          <div style={styles.gaiaBox}>{turn.gaiaText}</div>
        </div>
        <div style={{ ...styles.col, ...styles.colRisk }}>
          <SectionTitle title="Detección y evaluación de alarmas" />
          <div style={styles.kv}><strong>Flag detectada:</strong> {prettyFlags(turn.flags)}</div>
          <div style={styles.kv}><strong>Mensaje activador:</strong> {truncate(turn.userText, 300)}</div>
          <div style={styles.kv}><strong>Timestamp:</strong> {when.toLocaleString()}</div>
          <hr style={styles.hr} />
          <div style={styles.kv}><strong>Tipo de riesgo:</strong> {turn.risk?.tipo_riesgo || '-'} </div>
          <div style={styles.kv}><strong>Nivel:</strong> {turn.risk?.nivel_riesgo || '-'} </div>
          <div style={styles.kv}><strong>Riesgo estimado:</strong> {turn.risk?.riesgo_porcentual != null ? `${turn.risk.riesgo_porcentual}%` : '-'} </div>
          {turn.risk?.justificacion ? (
            <div style={styles.block}><strong>Justificación:</strong><div>{turn.risk.justificacion}</div></div>
          ) : null}
          {turn.risk?.recomendacion ? (
            <div style={styles.block}><strong>Recomendación:</strong><div>{turn.risk.recomendacion}</div></div>
          ) : null}
        </div>
        <div style={{ ...styles.col, ...styles.colIntervention }}>
          <SectionTitle title="Intervención especializada" />
          <div style={styles.interventionTag}>Intervención automática por detección de riesgo</div>
          <div style={styles.interventionBox}>{turn.interventionText || 'No disponible'}</div>
        </div>
      </div>
    </div>
  )
}

function Header({ onNewChat, disabled }) {
  return (
    <div style={styles.header}>
      <div>
        <h1 style={styles.h1}>Serenity · Demo de intervención por riesgo</h1>
        <div style={styles.subtitle}>BID / Ministerio — Interacción de múltiples agentes ante flags</div>
      </div>
      <div>
        <button style={styles.newChatBtn} onClick={onNewChat} disabled={!!disabled}>Nuevo chat</button>
      </div>
    </div>
  )
}

function Composer({ value, onChange, onSend, disabled }) {
  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSend?.()
    }
  }
  return (
    <div style={styles.composer}>
      <textarea
        style={styles.input}
        placeholder="Escribí tu mensaje"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        disabled={disabled}
      />
      <button style={styles.sendBtn} onClick={onSend} disabled={disabled || !value.trim()}>
        Enviar
      </button>
    </div>
  )
}

function Bubble({ who, text }) {
  const isUser = who === 'user'
  return (
    <div style={{ ...styles.bubble, ...(isUser ? styles.bubbleUser : styles.bubbleAssistant) }}>
      <div style={styles.bubbleWho}>{isUser ? 'Usuario' : 'GAIA Comunidad'}</div>
      <div>{text}</div>
    </div>
  )
}

function SectionTitle({ title }) {
  return <div style={styles.sectionTitle}>{title}</div>
}

function pickInterventionText(json, fallbackText) {
  if (json && typeof json === 'object') {
    const keys = [
      'respuesta_usuario_sugerida',
      'respuesta_sugerida',
      'intervencion_sugerida',
      'respuesta_para_usuario',
      'respuesta',
    ]
    for (const k of keys) {
      const v = json[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
  }
  // If only text was provided, use it as last resort
  if (typeof fallbackText === 'string' && fallbackText.trim()) return fallbackText.trim()
  return ''
}

function normalizeRisk(json, text) {
  if (json && typeof json === 'object') {
    return {
      tipo_riesgo: json.tipo_riesgo || json.tipo || json.risk_type || '',
      nivel_riesgo: json.nivel_riesgo || json.nivel || json.risk_level || '',
      riesgo_porcentual: json.riesgo_porcentual ?? json.porcentaje ?? json.estimated_risk ?? null,
      justificacion: json.justificacion || json.motivo || json.why || '',
      recomendacion: json.recomendacion || json.sugerencia || json.recommendation || '',
    }
  }
  // Fallback: put all text as justificación so UI still shows context
  return { tipo_riesgo: '', nivel_riesgo: '', riesgo_porcentual: null, justificacion: (text || ''), recomendacion: '' }
}

function prettyFlags(f) {
  if (!f) return '-'
  const out = []
  if (f.TendenciaSuicida) out.push('TendenciaSuicida')
  if (f.PautasDeAlarmaClinicas) out.push('PautasDeAlarmaClinicas')
  if (f.ViolenciaRiesgoExtremo) out.push('ViolenciaRiesgoExtremo')
  return out.join(', ') || '-'
}

function truncate(s, max) {
  const str = String(s || '')
  if (str.length <= max) return str
  return str.slice(0, max - 1) + '…'
}

const styles = {
  container: { display: 'flex', flexDirection: 'column', height: '100vh' },
  header: { padding: '12px 16px', borderBottom: '1px solid #eee', background: '#fff', position: 'sticky', top: 0, zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  h1: { fontSize: 18, margin: 0 },
  subtitle: { fontSize: 12, color: '#666' },
  scroll: { flex: 1, overflow: 'auto', padding: 16, background: '#fafafa' },
  turn: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 },
  bubble: { maxWidth: 720, padding: 12, borderRadius: 8, border: '1px solid #e6e6e6', boxShadow: '0 1px 2px rgba(0,0,0,0.03)', background: '#fff' },
  bubbleUser: { alignSelf: 'flex-end', background: '#f0f7ff', borderColor: '#d0e6ff' },
  bubbleAssistant: { alignSelf: 'flex-start' },
  bubbleWho: { fontSize: 11, color: '#666', marginBottom: 6 },
  pending: { padding: 8, color: '#999', fontStyle: 'italic' },
  columns: { display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr', gap: 12 },
  col: { padding: 12, border: '1px solid #e6e6e6', borderRadius: 8, background: '#fff' },
  colGaia: { background: '#fff8f8', borderColor: '#ffd8d8' },
  colRisk: { background: '#fff', borderColor: '#eee' },
  colIntervention: { background: '#f9fff5', borderColor: '#e0ffd1' },
  sectionTitle: { fontWeight: 600, fontSize: 13, marginBottom: 8 },
  replacedTag: { fontSize: 11, color: '#b40000', marginBottom: 6 },
  gaiaBox: { whiteSpace: 'pre-wrap' },
  kv: { fontSize: 13, margin: '4px 0' },
  hr: { border: 0, borderTop: '1px solid #eee', margin: '8px 0' },
  block: { fontSize: 13, marginTop: 6 },
  interventionTag: { fontSize: 11, color: '#2b6b00', marginBottom: 6 },
  interventionBox: { whiteSpace: 'pre-wrap' },
  composer: { display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #eee', background: '#fff' },
  input: { flex: 1, resize: 'vertical', minHeight: 44, maxHeight: 120, padding: 10, borderRadius: 8, border: '1px solid #ddd' },
  sendBtn: { padding: '10px 16px', borderRadius: 8, border: '1px solid #0a66c2', background: '#0a66c2', color: '#fff', cursor: 'pointer' },
  newChatBtn: { padding: '8px 12px', borderRadius: 8, border: '1px solid #666', background: '#fff', color: '#333', cursor: 'pointer' },
  error: { color: '#b40000', background: '#fff2f2', border: '1px solid #ffd8d8', padding: 8, borderRadius: 8, margin: '8px 16px' },
}
