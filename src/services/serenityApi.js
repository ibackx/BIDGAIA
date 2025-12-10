const BASE_URL = (import.meta.env?.VITE_SERENITY_BASE_URL || 'https://api.serenitystar.ai/api').replace(/\/$/, '')
const AGENT_CODE = import.meta.env?.VITE_SERENITY_AGENT_CODE || 'GAIAComunidad'
const API_KEY = import.meta.env?.VITE_SERENITY_API_KEY || 'A56DFDA8-DA39-4705-9423-B73AD4A5E34F'

export async function createConversation({ agentCode = AGENT_CODE, apiKey = API_KEY, culture = 'en' } = {}) {
  const url = `${BASE_URL}/v2/agent/${encodeURIComponent(agentCode)}/conversation?culture=${encodeURIComponent(culture)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
  })
  if (!res.ok) throw new Error(`createConversation failed: ${res.status}`)
  const data = await res.json().catch(() => ({}))
  if (!data.chatId) throw new Error('createConversation: missing chatId')
  return data.chatId
}

export async function sendMessage({ chatId, message, agentCode = AGENT_CODE, apiKey = API_KEY }) {
  const url = `${BASE_URL}/v2/agent/${encodeURIComponent(agentCode)}/execute`
  const body = [
    { Key: 'message', Value: String(message ?? '') },
    { Key: 'chatId', Value: String(chatId ?? '') },
  ]
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`sendMessage failed: ${res.status}`)
  return await res.json()
}

export function extractFlagsFromResponse(response) {
  let flags = { TendenciaSuicida: false, PautasDeAlarmaClinicas: false, ViolenciaRiesgoExtremo: false }
  try {
    const ar = response?.action_results || null
    if (ar?.ConditionChecker?.result?.flags && Array.isArray(ar.ConditionChecker.result.flags)) {
      const arr = ar.ConditionChecker.result.flags
      flags = {
        TendenciaSuicida: arr.includes('TendenciaSuicida'),
        PautasDeAlarmaClinicas: arr.includes('PautasDeAlarmaClinicas'),
        ViolenciaRiesgoExtremo: arr.includes('ViolenciaRiesgoExtremo'),
      }
    } else {
      const out = response?.skills?.CheckCondition?.output
      const content = out?.content
      if (content === true || content === 'true') {
        // When only a boolean is present, we cannot know which flag; keep defaults
      }
    }
  } catch {}
  return flags
}
