/* Serenity Chat Widget integration helpers */

const AGENT_ID = import.meta.env?.VITE_SERENITY_AGENT_CODE || 'GAIAComunidad'
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
  return import.meta.env?.VITE_SERENITY_API_KEY || ''
}
const BASE_URL = (import.meta.env?.VITE_SERENITY_BASE_URL || 'https://api.serenitystar.ai/api').replace(/\/$/, '')

let widgetInstance = null
let conversationLog = []
let onNoFlagsNextUserMessageCb = null
let networkProbeInstalled = false
let wsProbeInstalled = false
let lastAssistantCallback = null
let probePollTimer = null
let primaryChatId = null
let lastTypedUserText = ''
let lastPushedUserText = ''
let pendingClearOnNextNoFlag = false

function installNetworkProbe() {
  if (networkProbeInstalled) return
  networkProbeInstalled = true
  const origFetch = window.fetch
  window.fetch = async function(...args) {
    try {
      // Capture outgoing user messages to build conversation history
      const reqInfo = args[0]
      const reqInit = args[1] || {}
      let url = ''
      let method = ''
      let body = null
      if (typeof reqInfo === 'string') {
        url = reqInfo
        method = String((reqInit.method || 'GET')).toUpperCase()
        body = reqInit.body || null
      } else if (reqInfo && typeof reqInfo === 'object') {
        url = reqInfo.url || ''
        method = String((reqInfo.method || 'GET')).toUpperCase()
        // Best-effort body extraction from Request or init
        body = reqInfo.body || reqInit.body || null
      }
      // Extract agentCode from URL if present: /v2/agent/{agentCode}/...
      let urlAgentCode = null
      try {
        const m = url.match(/\/v2\/agent\/([^/]+)\//)
        if (m && m[1]) urlAgentCode = decodeURIComponent(m[1])
      } catch {}

      // When the primary chat starts a fresh conversation, clear history
      if (url.includes('/v2/agent/') && url.endsWith('/conversation') && method === 'POST') {
        if (urlAgentCode && urlAgentCode === AGENT_ID) {
          try { conversationLog = [] } catch {}
          // We'll capture chatId from the response below
        }
      }

      if (url.includes('/v2/agent/') && url.endsWith('/execute') && method === 'POST' && typeof body === 'string') {
        // Only record messages for the PRIMARY agent chatId
        try {
          const parsed = JSON.parse(body)
          if (Array.isArray(parsed)) {
              const chatEntry = parsed.find((e) => e && e.Key === 'chatId')
              const postedChatId = chatEntry?.Value ? String(chatEntry.Value) : null
              // Initialize primaryChatId if missing and this is the primary agent
              if (!primaryChatId && urlAgentCode === AGENT_ID && postedChatId) primaryChatId = postedChatId
              if (!postedChatId || postedChatId !== primaryChatId) {
                // Different chat (likely second agent) → ignore
              } else {
            const msgEntry = parsed.find((e) => e && e.Key === 'message')
            const msgVal = msgEntry?.Value
            if (msgVal) conversationLog.push({ role: 'user', content: String(msgVal) })
            // Mark that the next no-flag event after a user message should clear UI
            pendingClearOnNextNoFlag = true
              }
          }
        } catch {}
      }
    } catch {}

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
          // Capture chatId on conversation creation for primary agent
          if (url.includes('/v2/agent/') && url.endsWith('/conversation')) {
            try {
              const m = url.match(/\/v2\/agent\/([^/]+)\//)
              const agentFromUrl = m && m[1] ? decodeURIComponent(m[1]) : null
              if (agentFromUrl === AGENT_ID && data?.chatId) {
                primaryChatId = String(data.chatId)
              }
            } catch {}
          }
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
  // Intercept outgoing frames to capture user messages with chatId
  try {
    const _send = OrigWS.prototype.send
    OrigWS.prototype.send = function(data) {
      try {
        let payload = null
        if (typeof data === 'string') {
          try { payload = JSON.parse(data) } catch {}
        } else if (data && typeof data === 'object') {
          try { payload = JSON.parse(data.toString()) } catch {}
        }
        const msg = payload?.message || payload?.data?.message || null
        const cid = payload?.chatId || payload?.data?.chatId || null
        if (msg) lastTypedUserText = String(msg)
        if (msg && cid && primaryChatId && cid === primaryChatId) {
          if (lastPushedUserText !== String(msg)) {
            conversationLog.push({ role: 'user', content: String(msg) })
            lastPushedUserText = String(msg)
          }
        }
      } catch {}
      return _send.apply(this, arguments)
    }
  } catch {}
}

export function initSerenityWidget({ onFlagsDetected, onNoFlagsNextUserMessage, useAIHubForPrimary = false }) {
  onNoFlagsNextUserMessageCb = onNoFlagsNextUserMessage
  try { installNetworkProbe() } catch {}
  try { installWebSocketProbe() } catch {}

  // Start a lightweight poller to infer flags from network/debug snapshots
  try {
    if (!probePollTimer) {
      probePollTimer = setInterval(() => {
        try {
          const dbg = window.__serenityDebug || {}
          const raw = dbg.lastWSMessage || dbg.rawResponse || null
          if (!raw) return
          let flags = null
          const ar = raw?.action_results || raw?.result || raw?.skills || null
          if (ar && typeof ar === 'object') {
            // Same normalization as below
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
          if (flags) {
            handleFlags(flags, onFlagsDetected)
          }
        } catch {}
      }, 500)
    }
  } catch {}

  // If using AIHubChat as the primary widget, initialize it first and skip Serenity container check
  if (useAIHubForPrimary && window.AIHubChat) {
    try {
      const aiHubContainerId = 'aihub-chat'
      const aiHubEl = document.getElementById(aiHubContainerId)
      if (!aiHubEl) {
        console.error('Chat container not found: #aihub-chat')
        return
      }
      const chat = new AIHubChat('aihub-chat', {
        apiKey: getApiKey(),
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
            // Log assistant content if available
            try {
              const content = typeof response?.content === 'string' ? response.content : null
              if (content) conversationLog.push({ role: 'assistant', content })
            } catch {}
            handleFlags(flags, onFlagsDetected)
          } catch (err) {
            console.warn('onAgentResponse error:', err)
          }
        },
      })
      chat.init()
      widgetInstance = chat

      // Wrap sendMessage to capture user text when invoked programmatically
      try {
        if (typeof chat.sendMessage === 'function') {
          const _origSend = chat.sendMessage.bind(chat)
          chat.sendMessage = function(text, ...rest) {
            try {
              const t = typeof text === 'string' ? text : (text?.content || '')
              if (t) {
                lastTypedUserText = String(t)
                if (lastPushedUserText !== lastTypedUserText) {
                  conversationLog.push({ role: 'user', content: lastTypedUserText })
                  lastPushedUserText = lastTypedUserText
                }
              }
            } catch {}
            return _origSend(text, ...rest)
          }
        }
      } catch {}

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
            try { if (raw?.content) conversationLog.push({ role: 'assistant', content: String(raw.content) }) } catch {}
            handleFlags(skills, onFlagsDetected)
          } catch (e) {
            console.warn('AIHubChat message parse error', e)
          }
        })
      }
      // Capture user input from DOM as a fallback
      try { installInputCapture('aihub-chat') } catch {}
      if (typeof chat.onBeforeRender === 'function') {
        chat.onBeforeRender((payload) => {
          try {
            const raw = payload?.raw ?? payload
            const skills = raw?.skills
            try { if (raw?.content) conversationLog.push({ role: 'assistant', content: String(raw.content) }) } catch {}
            handleFlags(skills, onFlagsDetected)
            // Capture assistant text if available
            try { if (lastAssistantCallback && raw?.content) lastAssistantCallback(String(raw.content)) } catch {}
          } catch {}
          return payload
        })
      }
      return
    } catch (e) {
      console.error('Failed to init AIHubChat:', e)
    }
  }

  // From here, proceed with SerenityChatWidget fallback which requires #serenity-chat-container
  const container = document.getElementById('serenity-chat-container')
  if (!container) {
    console.error('Chat container not found: #serenity-chat-container')
    return
  }

  if (!window.SerenityChatWidget || !window.SerenityChatWidget.init) {
    console.warn('SDK no disponible: ni AIHubChat ni SerenityChatWidget están cargados. Continuo con detector por red.')
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
        try { if (raw?.content) conversationLog.push({ role: 'assistant', content: String(raw.content) }) } catch {}
        handleFlags(skills, onFlagsDetected)
        try { if (lastAssistantCallback && raw?.content) lastAssistantCallback(String(raw.content)) } catch {}
      } catch (e) {
        console.warn('onBeforeRender parse error', e)
      }
      return payload
    },
    onMessage: (raw) => {
      try {
        const skills = raw?.skills
        try { if (raw?.content) conversationLog.push({ role: 'assistant', content: String(raw.content) }) } catch {}
        handleFlags(skills, onFlagsDetected)
        try { if (lastAssistantCallback && raw?.content) lastAssistantCallback(String(raw.content)) } catch {}
      } catch (e) {
        console.warn('onMessage parse error', e)
      }
    },
    onUserMessage: (text) => {
      try {
        const content = typeof text === 'string' ? text : (text?.content || '')
        if (content) conversationLog.push({ role: 'user', content: String(content) })
      } catch {}
    },
  })
}

function handleFlags(flags, onFlagsDetected) {
  // Normalize flags to a boolean-map shape
  let norm = { TendenciaSuicida: false, PautasDeAlarmaClinicas: false, ViolenciaRiesgoExtremo: false }
  try {
    if (Array.isArray(flags)) {
      norm = {
        TendenciaSuicida: flags.includes('TendenciaSuicida'),
        PautasDeAlarmaClinicas: flags.includes('PautasDeAlarmaClinicas'),
        ViolenciaRiesgoExtremo: flags.includes('ViolenciaRiesgoExtremo'),
      }
    } else if (flags && typeof flags === 'object') {
      // Sometimes a nested { result: { flags: [...] } }
      const inner = Array.isArray(flags.flags) ? flags.flags : (Array.isArray(flags.result?.flags) ? flags.result.flags : null)
      if (inner) {
        norm = {
          TendenciaSuicida: inner.includes('TendenciaSuicida'),
          PautasDeAlarmaClinicas: inner.includes('PautasDeAlarmaClinicas'),
          ViolenciaRiesgoExtremo: inner.includes('ViolenciaRiesgoExtremo'),
        }
      } else {
        norm = {
          TendenciaSuicida: !!flags.TendenciaSuicida || flags.TendenciaSuicida === 'true',
          PautasDeAlarmaClinicas: !!flags.PautasDeAlarmaClinicas || flags.PautasDeAlarmaClinicas === 'true',
          ViolenciaRiesgoExtremo: !!flags.ViolenciaRiesgoExtremo || flags.ViolenciaRiesgoExtremo === 'true',
        }
      }
    }
  } catch {}

  const hasAny = norm.TendenciaSuicida || norm.PautasDeAlarmaClinicas || norm.ViolenciaRiesgoExtremo
  if (hasAny) {
    onFlagsDetected?.(norm)
    pendingClearOnNextNoFlag = false
  } else {
    if (pendingClearOnNextNoFlag) {
      onNoFlagsNextUserMessageCb?.()
      pendingClearOnNextNoFlag = false
    }
    onFlagsDetected?.(null)
  }
}

export function clearBannerOnUserMessage(cb) {
  onNoFlagsNextUserMessageCb = cb
}

export function getWidgetInstance() {
  return widgetInstance
}

export function getConversationLog() {
  try { return conversationLog.slice(-100) } catch { return [] }
}

function installInputCapture(containerId) {
  const host = document.getElementById(containerId)
  if (!host) return

  const getAllRoots = (start) => {
    const roots = []
    const stack = [start]
    const seen = new Set()
    while (stack.length) {
      const el = stack.pop()
      if (!el || seen.has(el)) continue
      seen.add(el)
      roots.push(el)
      // Traverse shadow roots
      if (el.shadowRoot) stack.push(el.shadowRoot)
      // Traverse children
      if (el.children) for (const c of el.children) stack.push(c)
      // If this is a ShadowRoot, dive into its children
      try {
        if (typeof ShadowRoot !== 'undefined' && el instanceof ShadowRoot) {
          for (const c of el.children) stack.push(c)
        }
      } catch {}
    }
    // Ensure document also scanned for detached overlays
    if (!roots.includes(document)) roots.push(document)
    return roots
  }

  const selectors = 'textarea, input[type="text"], [contenteditable="true"]'
  const sendSelectors = 'button[type="submit"], .send, .serenity-send, [aria-label*="Enviar"], [title*="Enviar"], [aria-label*="Send"], [title*="Send"], button, .button'

  const pushIfNew = (text) => {
    const t = (text || '').trim()
    if (!t) return
    lastTypedUserText = t
    if (lastPushedUserText === t) return
    conversationLog.push({ role: 'user', content: t })
    lastPushedUserText = t
  }

  const attachListeners = () => {
    const roots = getAllRoots(host)
    for (const r of roots) {
      try {
        // capture typing
        r.addEventListener('input', (ev) => {
          try {
            const el = ev.target
            const isText = el && (el.matches?.(selectors) || el.isContentEditable)
            if (!isText) return
            const val = el.isContentEditable ? el.textContent : el.value
            lastTypedUserText = String(val || '').trim()
          } catch {}
        }, true)
        // capture Enter submit
        r.addEventListener('keydown', (ev) => {
          try {
            const el = ev.target
            const isText = el && (el.matches?.(selectors) || el.isContentEditable)
            if (!isText) return
            if (ev.key === 'Enter' && !ev.shiftKey) {
              const val = el.isContentEditable ? el.textContent : el.value
              pushIfNew(val)
            }
          } catch {}
        }, true)
        // capture click submit
        r.addEventListener('click', (ev) => {
          try {
            const el = ev.target
            const label = (el?.getAttribute?.('aria-label') || el?.getAttribute?.('title') || '').toLowerCase()
            if (label.includes('enviar') || label.includes('send') || el.matches?.(sendSelectors)) {
              const input = r.querySelector?.(selectors)
              const val = input?.isContentEditable ? input.textContent : input?.value
              pushIfNew(val)
            }
          } catch {}
        }, true)
      } catch {}
    }
  }

  attachListeners()
  // Observe future DOM changes (shadow DOM included via subtree on host)
  try {
    const mo = new MutationObserver(() => attachListeners())
    mo.observe(host, { subtree: true, childList: true })
  } catch {}
}

export function getLastTypedUserText() {
  // If we already captured typed text, use it
  if (lastTypedUserText && lastTypedUserText.trim()) return lastTypedUserText.trim()
  // Fallback: inspect last user bubble in the chat UI, including shadow roots
  try {
    const host = document.getElementById('aihub-chat') || document.getElementById('serenity-chat-container')
    if (!host) return ''
    const getAllRoots = (start) => {
      const roots = []
      const stack = [start]
      const seen = new Set()
      while (stack.length) {
        const el = stack.pop()
        if (!el || seen.has(el)) continue
        seen.add(el)
        roots.push(el)
        if (el.shadowRoot) stack.push(el.shadowRoot)
        if (el.children) for (const c of el.children) stack.push(c)
        try {
          if (typeof ShadowRoot !== 'undefined' && el instanceof ShadowRoot) {
            for (const c of el.children) stack.push(c)
          }
        } catch {}
      }
      return roots
    }
    const roots = getAllRoots(host)
    const bubbleSelectors = [
      '[data-role="user"]', '[data-owner="user"]', '[data-author="user"]', '[data-message-author="user"]',
      '.user', '.from-user', '.message-user', '.chat-message.user', '.bubble.user', '.msg.user'
    ]
    let lastText = ''
    for (const r of roots) {
      try {
        for (const sel of bubbleSelectors) {
          const nodes = r.querySelectorAll?.(sel)
          if (!nodes || !nodes.length) continue
          const arr = Array.from(nodes)
          const last = arr[arr.length - 1]
          const t = String(last?.textContent || '').trim()
          if (t) lastText = t
        }
      } catch {}
    }
    return lastText
  } catch { return '' }
}

export async function sendUserMessage(text, { waitMs = 8000 } = {}) {
  // Prefer widget API if available
  try {
    const inst = widgetInstance
    if (inst && typeof inst.sendMessage === 'function') {
      let resolved = false
      const prom = new Promise((resolve) => {
        lastAssistantCallback = (msg) => { if (!resolved) { resolved = true; resolve(msg) } }
        setTimeout(() => { if (!resolved) { resolved = true; resolve('') } }, waitMs)
      })
      inst.sendMessage(text)
      const msg = await prom
      lastAssistantCallback = null
      return msg
    }
  } catch {}

  // DOM fallback: type into input and submit
  const root = document.getElementById('aihub-chat') || document.getElementById('serenity-chat-container')
  if (!root) return ''
  const input = root.querySelector('textarea, input[type="text"], [contenteditable="true"], .serenity-input, .chat-input, input, .input')
  let resolved = false
  const prom = new Promise((resolve) => {
    lastAssistantCallback = (msg) => { if (!resolved) { resolved = true; resolve(msg) } }
    setTimeout(() => { if (!resolved) { resolved = true; resolve('') } }, waitMs)
  })
  if (input) {
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      input.value = text
      input.dispatchEvent(new Event('input', { bubbles: true }))
    } else {
      input.textContent = text
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const btn = root.querySelector('button[type="submit"], .send, .serenity-send, [aria-label*="Enviar"], [title*="Enviar"], [aria-label*="Send"], [title*="Send"], button, .button')
    if (btn) btn.click();
    else {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    }
  }
  const msg = await prom
  lastAssistantCallback = null
  return msg
}
