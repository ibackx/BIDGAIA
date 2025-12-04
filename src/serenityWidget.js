/* Serenity Chat Widget integration helpers */

const AGENT_ID = import.meta.env?.VITE_SERENITY_AGENT_CODE || 'GAIAComunidad'
const API_KEY = import.meta.env?.VITE_SERENITY_API_KEY || 'A56DFDA8-DA39-4705-9423-B73AD4A5E34F'
const BASE_URL = (import.meta.env?.VITE_SERENITY_BASE_URL || 'https://api.serenitystar.ai/api').replace(/\/$/, '')

let widgetInstance = null
let onNoFlagsNextUserMessageCb = null
let networkProbeInstalled = false
let wsProbeInstalled = false

function installNetworkProbe() {
  if (networkProbeInstalled) return
  networkProbeInstalled = true
  const origFetch = window.fetch
  window.fetch = async function(...args) {
    const res = await origFetch.apply(this, args)
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '')
      const clone = res.clone()
      const ct = clone.headers.get('content-type') || ''
      if (ct.includes('application/json')) {
        const data = await clone.json()
        try {
          window.__serenityDebug = window.__serenityDebug || {}
          window.__serenityDebug.lastFetchUrl = url
          window.__serenityDebug.rawResponse = data
          window.__serenityDebug.responseKeys = data ? Object.keys(data) : []
          const ar = data?.action_results || data?.result || data?.skills || null
          window.__serenityDebug.actionResultsKeys = ar ? Object.keys(ar) : []
        } catch {}
      }
    } catch {}
    return res
  }
}

function installWebSocketProbe() {
  if (wsProbeInstalled) return
  wsProbeInstalled = true
  const OrigWS = window.WebSocket
  window.WebSocket = function(url, protocols) {
    const ws = new OrigWS(url, protocols)
    try {
      ws.addEventListener('message', (ev) => {
        try {
          const data = ev.data
          // Try JSON parse; widget may use SSE-over-WS or plain JSON frames
          let parsed = null
          if (typeof data === 'string') {
            try { parsed = JSON.parse(data) } catch {}
          }
          window.__serenityDebug = window.__serenityDebug || {}
          window.__serenityDebug.lastWSUrl = url
          window.__serenityDebug.lastWSMessage = parsed || data
          const obj = parsed || {}
          const ar = obj?.action_results || obj?.result || obj?.skills || null
          window.__serenityDebug.responseKeys = obj ? Object.keys(obj) : []
          window.__serenityDebug.actionResultsKeys = ar ? Object.keys(ar) : []
        } catch {}
      })
    } catch {}
    return ws
  }
  window.WebSocket.prototype = OrigWS.prototype
}

export function initSerenityWidget({ onFlagsDetected, onNoFlagsNextUserMessage }) {
  onNoFlagsNextUserMessageCb = onNoFlagsNextUserMessage
  try { installNetworkProbe() } catch {}
  try { installWebSocketProbe() } catch {}

  const container = document.getElementById('serenity-chat-container')
  if (!container) {
    console.error('Chat container not found: #serenity-chat-container')
    return
  }

  if (window.AIHubChat) {
    try {
      const chat = new AIHubChat('aihub-chat', {
        apiKey: API_KEY,
        agentCode: AGENT_ID,
        baseURL: BASE_URL,
        onAgentResponse: (response) => {
          try {
            const ar = response?.action_results || null
            let flags = null
            // Debug snapshot
            try {
              window.__serenityDebug = {
                responseKeys: response ? Object.keys(response) : [],
                actionResultsKeys: ar ? Object.keys(ar) : [],
                rawSnippet: typeof response?.content === 'string' ? response.content.slice(0, 300) : null,
                rawResponse: response || null,
                flagsCandidate: null,
              }
            } catch {}

            // Consolidated flags
            if (ar?.ConditionChecker?.result?.flags) {
              flags = ar.ConditionChecker.result.flags
            } else if (ar && typeof ar === 'object') {
              // Direct keys normalization
              const norm = (v) => {
                if (v === true || v === 'true') return true
                if (v && typeof v === 'object') {
                  if (v.json_content === true) return true
                  if (v.content === true || v.content === 'true') return true
                  if (v.output && (v.output.content === true || v.output.content === 'true')) return true
                  if (v.output && v.output.type === 'CheckCondition' && (v.output.content === true || v.output.content === 'true')) return true
                }
                return false
              }
              const direct = {
                TendenciaSuicida: norm(ar.TendenciaSuicida?.result ?? ar.TendenciaSuicida?.output ?? ar.TendenciaSuicida),
                PautasDeAlarmaClinicas: norm(ar.PautasDeAlarmaClinicas?.result ?? ar.PautasDeAlarmaClinicas?.output ?? ar.PautasDeAlarmaClinicas),
                ViolenciaRiesgoExtremo: norm(ar.ViolenciaRiesgoExtremo?.result ?? ar.ViolenciaRiesgoExtremo?.output ?? ar.ViolenciaRiesgoExtremo),
              }
              if (direct.TendenciaSuicida || direct.PautasDeAlarmaClinicas || direct.ViolenciaRiesgoExtremo) {
                flags = direct
              } else {
                for (const [k, v] of Object.entries(ar)) {
                  const rf = v?.result?.flags
                  if (rf && typeof rf === 'object') { flags = rf; break }
                }
                if (!flags) {
                  const mapped = { TendenciaSuicida: false, PautasDeAlarmaClinicas: false, ViolenciaRiesgoExtremo: false }
                  for (const [k, v] of Object.entries(ar)) {
                    const out = v?.output ?? v?.result ?? v
                    if (out?.type === 'CheckCondition' && (out.content === true || out.content === 'true')) {
                      if (k.includes('TendenciaSuicida')) mapped.TendenciaSuicida = true
                      if (k.includes('PautasDeAlarmaClinicas')) mapped.PautasDeAlarmaClinicas = true
                      if (k.includes('ViolenciaRiesgoExtremo')) mapped.ViolenciaRiesgoExtremo = true
                    }
                  }
                  if (mapped.TendenciaSuicida || mapped.PautasDeAlarmaClinicas || mapped.ViolenciaRiesgoExtremo) flags = mapped
                }
              }
            }

            try {
              if (window.__serenityDebug) {
                window.__serenityDebug.flagsCandidate = flags || null
                window.__serenityDebug.actionResultsKeys = ar ? Object.keys(ar) : []
              }
            } catch {}
            handleFlags(flags, onFlagsDetected)
          } catch (err) {
            console.warn('onAgentResponse error:', err)
          }
        },
      })
      chat.init()
      widgetInstance = chat

      if (typeof chat.on === 'function') {
        chat.on('message', (raw) => {
          try {
            // Capture assistant messages broadly
            window.__serenityDebug = window.__serenityDebug || {}
            window.__serenityDebug.lastMessage = raw
            window.__serenityDebug.responseKeys = raw ? Object.keys(raw) : []
            const ar = raw?.action_results || raw?.skills || raw?.result || null
            window.__serenityDebug.actionResultsKeys = ar ? Object.keys(ar) : []

            const skills = raw?.skills
            handleFlags(skills, onFlagsDetected)
          } catch (e) {
            console.warn('AIHubChat message parse error', e)
          }
        })
      }
      if (typeof chat.onBeforeRender === 'function') {
        chat.onBeforeRender((payload) => {
          try {
            const raw = payload?.raw ?? payload
            const skills = raw?.skills
            handleFlags(skills, onFlagsDetected)
          } catch {}
          return payload
        })
      }
      return
    } catch (e) {
      console.error('Failed to init AIHubChat:', e)
    }
  }

  if (!window.SerenityChatWidget || !window.SerenityChatWidget.init) {
    console.warn('SDK no disponible: ni AIHubChat ni SerenityChatWidget están cargados. Agregá el script del SDK en index.html.')
    return
  }

  widgetInstance = window.SerenityChatWidget.init({
    mount: container,
    agentId: AGENT_ID,
    theme: 'light',
    onBeforeRender: (payload) => {
      try {
        const raw = payload?.raw ?? payload
        const skills = raw?.skills
        handleFlags(skills, onFlagsDetected)
      } catch (e) {
        console.warn('onBeforeRender parse error', e)
      }
      return payload
    },
    onMessage: (raw) => {
      try {
        const skills = raw?.skills
        handleFlags(skills, onFlagsDetected)
      } catch (e) {
        console.warn('onMessage parse error', e)
      }
    },
    onUserMessage: () => {},
  })
}

function handleFlags(flags, onFlagsDetected) {
  const hasAny = flags && (flags.TendenciaSuicida || flags.PautasDeAlarmaClinicas || flags.ViolenciaRiesgoExtremo)
  if (hasAny) {
    onFlagsDetected?.(flags)
  } else {
    onNoFlagsNextUserMessageCb?.()
    onFlagsDetected?.(null)
  }
}

export function clearBannerOnUserMessage(cb) {
  onNoFlagsNextUserMessageCb = cb
}
