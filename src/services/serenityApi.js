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
    // 0) skillsResults array variant (as seen in SerenityAPIChat.jsx)
    if (Array.isArray(response?.skillsResults)) {
      // Prefer an entry with explicit result.flags
      const withFlags = response.skillsResults.find((s) => s?.result && typeof s.result.flags === 'object')
      if (withFlags) {
        const f = withFlags.result.flags
        return {
          TendenciaSuicida: !!(f?.TendenciaSuicida || (Array.isArray(f) && f.includes('TendenciaSuicida'))),
          PautasDeAlarmaClinicas: !!(f?.PautasDeAlarmaClinicas || (Array.isArray(f) && f.includes('PautasDeAlarmaClinicas'))),
          ViolenciaRiesgoExtremo: !!(f?.ViolenciaRiesgoExtremo || (Array.isArray(f) && f.includes('ViolenciaRiesgoExtremo'))),
        }
      }
      // Otherwise inspect each skill's output/result booleans and names
      const mapped = { ...flags }
      for (const s of response.skillsResults) {
        const name = String(s?.name || '')
        const out = s?.output ?? s?.result ?? s
        const val = out?.content ?? out?.json_content ?? out
        const isTrue = val === true || val === 'true'
        if (out?.type === 'CheckCondition' && isTrue) {
          if (name.includes('TendenciaSuicida')) mapped.TendenciaSuicida = true
          if (name.includes('PautasDeAlarmaClinicas')) mapped.PautasDeAlarmaClinicas = true
          if (name.includes('Violencia') || name.includes('RiesgoExtremo')) mapped.ViolenciaRiesgoExtremo = true
        }
      }
      if (mapped.TendenciaSuicida || mapped.PautasDeAlarmaClinicas || mapped.ViolenciaRiesgoExtremo) return mapped
    }

    const ar = response?.action_results || null
    // 1) Preferred: explicit flags array from ConditionChecker
    if (ar?.ConditionChecker?.result?.flags && Array.isArray(ar.ConditionChecker.result.flags)) {
      const arr = ar.ConditionChecker.result.flags
      flags = {
        TendenciaSuicida: arr.includes('TendenciaSuicida'),
        PautasDeAlarmaClinicas: arr.includes('PautasDeAlarmaClinicas'),
        ViolenciaRiesgoExtremo: arr.includes('ViolenciaRiesgoExtremo'),
      }
      return flags
    }

    // 2) Skill-specific objects: inspect known keys and their result/output/content booleans
    if (ar && typeof ar === 'object') {
      const norm = (v) => {
        if (v === true || v === 'true') return true
        if (v && typeof v === 'object') {
          if (v.json_content === true) return true
          if (v.content === true || v.content === 'true') return true
          if (v.output && (v.output.content === true || v.output.content === 'true')) return true
          if (v.output && v.output.type === 'CheckCondition' && (v.output.content === true || v.output.content === 'true')) return true
          if (v.result && (v.result.content === true || v.result === true)) return true
        }
        return false
      }
      // Direct named skills
      const ts = ar.TendenciaSuicida?.result ?? ar.TendenciaSuicida?.output ?? ar.TendenciaSuicida
      const ac = ar.PautasDeAlarmaClinicas?.result ?? ar.PautasDeAlarmaClinicas?.output ?? ar.PautasDeAlarmaClinicas
      const ve = ar.ViolenciaRiesgoExtremo?.result ?? ar.ViolenciaRiesgoExtremo?.output ?? ar.ViolenciaRiesgoExtremo
      if (norm(ts) || norm(ac) || norm(ve)) {
        flags = {
          TendenciaSuicida: norm(ts),
          PautasDeAlarmaClinicas: norm(ac),
          ViolenciaRiesgoExtremo: norm(ve),
        }
        return flags
      }
      // Scan generic entries for CheckCondition
      const mapped = { ...flags }
      for (const [k, v] of Object.entries(ar)) {
        const out = v?.output ?? v?.result ?? v
        if (out?.type === 'CheckCondition' && (out.content === true || out.content === 'true')) {
          if (k.includes('TendenciaSuicida')) mapped.TendenciaSuicida = true
          if (k.includes('PautasDeAlarmaClinicas')) mapped.PautasDeAlarmaClinicas = true
          if (k.includes('Violencia') || k.includes('RiesgoExtremo')) mapped.ViolenciaRiesgoExtremo = true
        }
      }
      if (mapped.TendenciaSuicida || mapped.PautasDeAlarmaClinicas || mapped.ViolenciaRiesgoExtremo) return mapped
    }

    // 3) skills.CheckCondition as a boolean: keep defaults if unknown which
    const out = response?.skills?.CheckCondition?.output
    if (out && (out.content === true || out.content === 'true')) {
      // Unknown specific flag; leave as false for each to avoid false positives
      return flags
    }
  } catch {}
  return flags
}
