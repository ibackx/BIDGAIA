import React, { useState } from 'react'

// Read credentials from Vite env
const API_KEY = import.meta?.env?.VITE_SERENITY_API_KEY || ''
const AGENT_CODE = import.meta?.env?.VITE_SERENITY_AGENT_CODE || ''
const BASE_URL = import.meta?.env?.VITE_SERENITY_BASE_URL || 'https://api.serenitystar.ai/api/v2'

export default function SerenityAPIChat() {
  const [chatId, setChatId] = useState(null)
  const [userMessage, setUserMessage] = useState('')
  const [conditionResult, setConditionResult] = useState(null)
  const [skillsResults, setSkillsResults] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const startConversation = async () => {
    if (!API_KEY || !AGENT_CODE) {
      setError('Config faltante: defina VITE_SERENITY_API_KEY y VITE_SERENITY_AGENT_CODE en .env.local')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`${BASE_URL}/agent/${AGENT_CODE}/conversation?culture=es`, {
        method: 'POST',
        headers: {
          'X-API-KEY': API_KEY,
          'Content-Type': 'application/json',
        },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setChatId(data.chatId)
    } catch (e) {
      setError(`Error iniciando conversación: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  const sendMessage = async () => {
    if (!chatId || !userMessage.trim()) return
    if (!API_KEY || !AGENT_CODE) {
      setError('Config faltante: defina VITE_SERENITY_API_KEY y VITE_SERENITY_AGENT_CODE en .env.local')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`${BASE_URL}/agent/${AGENT_CODE}/execute`, {
        method: 'POST',
        headers: {
          'X-API-KEY': API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          { Key: 'message', Value: userMessage },
          { Key: 'chatId', Value: chatId },
        ]),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSkillsResults(data.skillsResults || [])
      const conditionCheckerResult = (data.skillsResults || []).find((s) => s.name === 'ConditionChecker')
      setConditionResult(conditionCheckerResult?.result ?? null)
    } catch (e) {
      setError(`Error enviando mensaje: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  const flags = (() => {
    // If your agent returns flags inside a particular skill (e.g., ConditionChecker.result.flags)
    const resultFlags = conditionResult?.flags
    if (resultFlags && typeof resultFlags === 'object') return resultFlags
    // Or search any skill with a flags object
    const anyFlags = (skillsResults || []).find((s) => s.result && s.result.flags)
    return anyFlags?.result?.flags || null
  })()

  return (
    <div className="api-chat">
      <h2>API Directa: Captura de Skills</h2>
      {!chatId && (
        <button onClick={startConversation} disabled={loading}>
          {loading ? 'Iniciando…' : 'Iniciar chat'}
        </button>
      )}
      {chatId && (
        <div className="api-chat__controls">
          <input
            value={userMessage}
            onChange={(e) => setUserMessage(e.target.value)}
            placeholder="Escribe tu mensaje"
          />
          <button onClick={sendMessage} disabled={loading}>
            {loading ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      )}

      {error && <div className="api-chat__error">{error}</div>}

      {conditionResult && (
        <div className="api-chat__panel">
          <strong>Resultado Condition Checker:</strong>
          <pre>{JSON.stringify(conditionResult, null, 2)}</pre>
        </div>
      )}

      {flags && (
        <div className="api-chat__panel">
          <strong>Flags capturados (API):</strong>
          <pre>{JSON.stringify(flags, null, 2)}</pre>
        </div>
      )}

      {skillsResults && skillsResults.length > 0 && (
        <div className="api-chat__panel">
          <strong>skillsResults:</strong>
          <pre>{JSON.stringify(skillsResults, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}
