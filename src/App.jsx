import { useEffect, useState, useRef } from 'react'
import './App.css'
import AlertBanner, { FlagsPanel, FlagIndicator } from './components/AlertBanner.jsx'
// Debug panel removed from UI
import { initSerenityWidget, clearBannerOnUserMessage, getConversationLog, getLastTypedUserText } from './serenityWidget.js'
import { evaluateFlagsWithSecondAgent } from './services/serenityApi.js'

function App() {
  const [banner, setBanner] = useState(null)
  const [flagsState, setFlagsState] = useState(null)
  const [secondOpinion, setSecondOpinion] = useState('')
  const [isEvaluating, setIsEvaluating] = useState(false)
  const lastEvalKeyRef = useRef(null)

  useEffect(() => {
    // Initialize the Serenity Chat Widget with hooks
    initSerenityWidget({
      onFlagsDetected: (flags) => {
        // Determine banner text based on flags
        if (!flags) {
          setFlagsState(null)
          return
        }
        setFlagsState(flags)
        const { TendenciaSuicida, PautasDeAlarmaClinicas, ViolenciaRiesgoExtremo } = flags
        if (TendenciaSuicida) {
          setBanner({
            type: 'danger',
            text:
              'Necesitamos ayudarte de otra manera. Si estás pensando en lastimarte o no podés más, llamá gratis al 135 (línea de atención en crisis, 24 hs en CABA).',
          })
        } else if (PautasDeAlarmaClinicas) {
          setBanner({
            type: 'warning',
            text:
              'Esto puede ser un signo de alerta. Te recomiendo acercarte a la guardia más cercana para una evaluación rápida.',
          })
        } else if (ViolenciaRiesgoExtremo) {
          setBanner({
            type: 'info',
            text:
              'Si estás en peligro o viviendo violencia, podés pedir ayuda al 144. Es gratuito y funciona 24/7.',
          })
        } else {
          setBanner(null)
        }
      },
      onNoFlagsNextUserMessage: () => { setBanner(null); setFlagsState(null) },
      useAIHubForPrimary: true,
    })

    // Clear banner when the next user message has no flags
    clearBannerOnUserMessage(() => setBanner(null))
  }, [])
  const BASE_URL = (import.meta.env?.VITE_SERENITY_BASE_URL || 'https://api.serenitystar.ai/api').replace(/\/$/, '')
  const AGENT_ID = import.meta.env?.VITE_SERENITY_AGENT_CODE || 'GAIAComunidad'
  const API_KEY = import.meta.env?.VITE_SERENITY_API_KEY || ''

  // When flags are detected, send history + flags to the second agent and show its response
  useEffect(() => {
    const hasAny = !!(flagsState && (flagsState.TendenciaSuicida || flagsState.PautasDeAlarmaClinicas || flagsState.ViolenciaRiesgoExtremo))
    if (!hasAny) return
    async function run() {
      try {
        setIsEvaluating(true)
        // Small delay to let network/WS probes log the last user message
        await new Promise((r) => setTimeout(r, 500))
        let history = getConversationLog()
        // Fallback: ensure the latest user message is present and deduplicated
        const typed = getLastTypedUserText()?.trim()
        if (typed) {
          const hasTypedAlready = history.some((m) => m.role === 'user' && String(m.content || '').trim() === typed)
          if (!hasTypedAlready) history = [...history, { role: 'user', content: typed }]
        } else {
          // If no typed text available, but there is no recent user message, keep as-is
        }
        const evalKey = JSON.stringify({ h0: history[0]?.content?.slice(0,32) || '', len: history.length, flags: flagsState })
        if (lastEvalKeyRef.current === evalKey) return
        lastEvalKeyRef.current = evalKey
        try { window.__secondAgentEffect = { when: Date.now(), flags: flagsState, historyLen: history.length, lastUser: history[history.length-1]?.role === 'user' ? String(history[history.length-1]?.content||'').slice(0,120) : null } } catch {}
        try { console.debug('[SecondAgent] dispatch', { flagsState, historyLen: history.length }) } catch {}
        const { text, json } = await evaluateFlagsWithSecondAgent({ history, flags: flagsState })
        const pretty = formatSecondOpinion(text, json)
        setSecondOpinion(pretty)
        try { console.debug('[SecondAgent] result', { text, json, pretty }) } catch {}
      } catch (e) {
        setSecondOpinion('No fue posible obtener la segunda evaluación en este momento.')
        try { console.warn('[SecondAgent] evaluation failed', e) } catch {}
      } finally {
        setIsEvaluating(false)
      }
    }
    run()
  }, [flagsState])

  return (
    <div className="app-container">
      <h1>
        Serenity Chat Widget Demo
        {/* Always-visible flag indicator */}
        <FlagIndicator flags={flagsState} />
      </h1>
      <p>Chateá con el agente GAIA Comunidad y detectá flags.</p>

      {banner && <AlertBanner variant={banner.type} message={banner.text} />}
      <FlagsPanel flags={flagsState} />

      {/* Respuesta del segundo agente (evaluación científica/transparente) */}
      {(isEvaluating || secondOpinion) && (
        <div style={{
          margin: '12px 0',
          padding: '12px',
          border: '1px solid #e0e0e0',
          borderRadius: 8,
          background: '#fafafa',
        }}>
          <strong>Segunda opinión experta:</strong>
          <div style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
            {isEvaluating ? 'Analizando el riesgo reportado…' : (secondOpinion || '')}
          </div>
        </div>
      )}

      {/* Contenedor del chat primario (AIHubChat) */}
      {/* Contenedor visible del chat primario */}
      <div id="aihub-chat" className="chat-container" />

      {/* Debug info removed */}


      {/* Batch tester removed per request */}
    </div>
  )
}

export default App

function formatSecondOpinion(text, json) {
  try {
    if (json && typeof json === 'object') {
      const t = [
        json.tipo_riesgo ? `• Tipo de riesgo: ${json.tipo_riesgo}` : null,
        json.nivel_riesgo ? `• Nivel: ${json.nivel_riesgo}` : null,
        json.riesgo_porcentual != null ? `• Riesgo estimado: ${json.riesgo_porcentual}%` : null,
        json.justificacion ? `• Justificación: ${json.justificacion}` : null,
        json.recomendacion ? `• Recomendación: ${json.recomendacion}` : null,
      ].filter(Boolean).join('\n')
      if (t) return t
    }
  } catch {}
  return String(text || '')
}
