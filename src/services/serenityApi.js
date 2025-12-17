const BASE_URL = (import.meta.env?.VITE_SERENITY_BASE_URL || 'https://api.serenitystar.ai/api').replace(/\/$/, '')
const AGENT_CODE = import.meta.env?.VITE_SERENITY_AGENT_CODE || 'GAIAComunidad'
const SECOND_AGENT_CODE = import.meta.env?.VITE_SECOND_AGENT_CODE || 'GAIARSA'
const CULTURE = import.meta.env?.VITE_CULTURE || 'es-AR'

function getApiKey() {
  try {
    const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null
    const fromQs = (qs && (qs.get('apiKey') || qs.get('key'))) || ''
    if (fromQs) {
      try { localStorage.setItem('SERENITY_API_KEY', fromQs) } catch {}
      return fromQs
    }
    try {
      const fromLS = localStorage.getItem('SERENITY_API_KEY')
      if (fromLS) return fromLS
    } catch {}
    if (typeof window !== 'undefined' && window.__SERENITY_API_KEY__) return String(window.__SERENITY_API_KEY__)
  } catch {}
  // Demo fallback (requested): hardcode API key so published builds work without setup
  return import.meta.env?.VITE_SERENITY_API_KEY || 'A56DFDA8-DA39-4705-9423-B73AD4A5E34F'
}
export function setApiKey(key) { try { localStorage.setItem('SERENITY_API_KEY', key || '') } catch {} }

export async function createConversation({ agentCode = AGENT_CODE, apiKey = getApiKey(), culture = 'en' } = {}) {
  const url = `${BASE_URL}/v2/agent/${encodeURIComponent(agentCode)}/conversation?culture=${encodeURIComponent(culture)}`
  const data = await fetchJsonWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
  })
  if (!data.chatId) throw new Error('createConversation: missing chatId')
  return data.chatId
}

export async function sendMessage({ chatId, message, agentCode = AGENT_CODE, apiKey = getApiKey() }) {
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

export async function evaluateFlagsWithSecondAgent({
  history = [],
  flags = {},
  agentCode = SECOND_AGENT_CODE,
  apiKey = getApiKey(),
  baseURL = BASE_URL,
  culture = CULTURE,
} = {}) {
  const urlCreate = `${baseURL.replace(/\/$/, '')}/v2/agent/${encodeURIComponent(agentCode)}/conversation?culture=${encodeURIComponent(culture)}`
  try { window.__secondAgentCreate = { url: urlCreate, agentCode, culture } } catch {}
  const createData = await fetchJsonWithRetry(urlCreate, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
  })
  const chatId = createData.chatId
  if (!chatId) throw new Error('secondAgent.createConversation: missing chatId')

  const flagsArray = flagsToArray(flags)
  const truncated = history.map((m) => ({ role: m.role, content: String(m.content || '') })).slice(-12)
  const historyLines = truncated.map((m) => `${m.role === 'assistant' ? 'Agente' : 'Usuario'}: ${m.content}`).join('\n')
  const correlationId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const message = [
    'Historial:',
    historyLines || '(sin mensajes previos)',
    '',
    `Flags detectados: ${flagsArray.join(', ') || 'ninguno'}`,
  ].join('\n')

  const urlExec = `${baseURL.replace(/\/$/, '')}/v2/agent/${encodeURIComponent(agentCode)}/execute`
  const body = [
    { Key: 'message', Value: message },
    { Key: 'chatId', Value: String(chatId) },
    { Key: 'flags', Value: flagsArray.join(',') },
    { Key: 'flagsJson', Value: JSON.stringify(flagsArray) },
    { Key: 'correlationId', Value: correlationId },
    { Key: 'culture', Value: culture },
  ]
  try { window.__secondAgentRequest = { url: urlExec, headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey, 'X-Request-ID': correlationId }, body, chatId } } catch {}
  const data = await fetchJsonWithRetry(urlExec, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey, 'X-Request-ID': correlationId },
    body: JSON.stringify(body),
  })
  const { text, json } = extractAssistantResult(data)
  try { window.__secondAgentDebug = { chatId, response: data, textCandidate: text, jsonCandidate: json } } catch {}
  return { chatId, response: data, text, json }
}

function extractAssistantResult(resp) {
  try {
    if (!resp) return { text: '', json: null }
    // Prefer explicit json fields
    const jc = resp.json_content || resp.jsonContent || null
    if (jc && typeof jc === 'object') {
      const text = resp.content || resp.message || ''
      return { text, json: jc }
    }
    if (typeof resp.content === 'string') {
      const parsed = parseJsonFromCodeFence(resp.content)
      if (parsed) return { text: resp.content, json: parsed }
      return { text: resp.content, json: null }
    }
    if (typeof resp.message === 'string') {
      const parsed = parseJsonFromCodeFence(resp.message)
      if (parsed) return { text: resp.message, json: parsed }
      return { text: resp.message, json: null }
    }
    if (resp.result) {
      if (resp.result.json_content && typeof resp.result.json_content === 'object') {
        const t = resp.result.content || resp.result.message || ''
        return { text: t, json: resp.result.json_content }
      }
      if (typeof resp.result.content === 'string') {
        const parsed = parseJsonFromCodeFence(resp.result.content)
        if (parsed) return { text: resp.result.content, json: parsed }
        return { text: resp.result.content, json: null }
      }
      if (resp.result.output && typeof resp.result.output.content === 'string') {
        const parsed = parseJsonFromCodeFence(resp.result.output.content)
        if (parsed) return { text: resp.result.output.content, json: parsed }
        return { text: resp.result.output.content, json: null }
      }
      if (Array.isArray(resp.result.skillsResults)) {
        for (const s of resp.result.skillsResults) {
          const out = s?.output ?? s?.result ?? s
          if (out?.json_content && typeof out.json_content === 'object') return { text: out.content || '', json: out.json_content }
          if (typeof out?.content === 'string') {
            const parsed = parseJsonFromCodeFence(out.content)
            if (parsed) return { text: out.content, json: parsed }
            return { text: out.content, json: null }
          }
        }
      }
    }
    const ar = resp.action_results || resp.skills || null
    if (ar && typeof ar === 'object') {
      const texts = []
      for (const v of Object.values(ar)) {
        const out = v?.output ?? v?.result ?? v
        if (out?.json_content && typeof out.json_content === 'object') return { text: out.content || '', json: out.json_content }
        const c = out?.content ?? out?.text
        if (typeof c === 'string') {
          const parsed = parseJsonFromCodeFence(c)
          if (parsed) return { text: c, json: parsed }
          texts.push(c)
        }
      }
      if (texts.length) return { text: texts.join('\n\n'), json: null }
    }
    if (Array.isArray(resp.skillsResults)) {
      for (const s of resp.skillsResults) {
        const out = s?.output ?? s?.result ?? s
        if (out?.json_content && typeof out.json_content === 'object') return { text: out.content || '', json: out.json_content }
        if (typeof out?.content === 'string') {
          const parsed = parseJsonFromCodeFence(out.content)
          if (parsed) return { text: out.content, json: parsed }
          return { text: out.content, json: null }
        }
      }
    }
    // Deep search for any "content"/"text" string
    const found = deepFindContentString(resp)
    if (found) {
      const parsed = parseJsonFromCodeFence(found)
      return { text: found, json: parsed }
    }
  } catch {}
  try { return { text: JSON.stringify(resp, null, 2), json: null } } catch { return { text: '', json: null } }
}

function deepFindContentString(obj, limit = 3000) {
  try {
    const stack = [obj]
    const seen = new Set()
    let budget = limit
    while (stack.length && budget-- > 0) {
      const cur = stack.pop()
      if (!cur || typeof cur !== 'object' || seen.has(cur)) continue
      seen.add(cur)
      if (Array.isArray(cur)) { for (const it of cur) stack.push(it); continue }
      for (const [k, v] of Object.entries(cur)) {
        if (typeof v === 'string' && (k.toLowerCase().includes('content') || k.toLowerCase().includes('text') || k.toLowerCase().includes('message'))) {
          if (v.trim()) return v
        }
        if (v && typeof v === 'object') stack.push(v)
      }
    }
  } catch {}
  return ''
}

function parseJsonFromCodeFence(text) {
  try {
    if (!text || typeof text !== 'string') return null
    const fence = /```(?:json)?\n([\s\S]*?)```/i
    const m = text.match(fence)
    const raw = m ? m[1] : null
    const candidate = raw || null
    if (candidate) {
      return JSON.parse(candidate)
    }
  } catch {}
  return null
}

function flagsToArray(f = {}) {
  try {
    const out = []
    if (f.TendenciaSuicida) out.push('TendenciaSuicida')
    if (f.PautasDeAlarmaClinicas) out.push('PautasDeAlarmaClinicas')
    if (f.ViolenciaRiesgoExtremo) out.push('ViolenciaRiesgoExtremo')
    for (const [k, v] of Object.entries(f)) {
      if (!['TendenciaSuicida','PautasDeAlarmaClinicas','ViolenciaRiesgoExtremo'].includes(k) && v === true) out.push(k)
    }
    return out
  } catch { return [] }
}

async function fetchJsonWithRetry(url, options, tries = 3) {
  let lastErr = null
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, options)
      if (res.status === 429 && i < tries - 1) {
        await delay((i + 1) * 300)
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json().catch(() => ({}))
    } catch (e) {
      lastErr = e
      try { window.__secondAgentError = { url, options: { method: options?.method, headers: options?.headers }, error: String(e?.message || e) } } catch {}
      if (i < tries - 1) await delay((i + 1) * 300)
    }
  }
  throw lastErr || new Error('fetchJsonWithRetry failed')
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)) }
