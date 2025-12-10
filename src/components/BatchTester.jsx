import { useState } from 'react'

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function loadPhrases() {
  const base = import.meta.env?.BASE_URL || '/BIDGAIA/'
  const url = `${base}alarm_phrases.json`
  try {
    const res = await fetch(url, { cache: 'no-cache' })
    return await res.json()
  } catch (e) {
    console.error('Failed to load phrases:', e)
    return []
  }
}

function extractAssistantTextFromDOM() {
  const root = document.getElementById('serenity-chat-container')
  if (!root) return ''
  // Try multiple selectors used by different widget renders
  const bubbles = root.querySelectorAll(
    '[data-role="assistant"], .assistant, .message.assistant, .serenity-message-assistant, [data-author="assistant"], .chat-message.assistant'
  )
  const last = bubbles[bubbles.length - 1]
  if (last) {
    const textEl = last.querySelector('.content, .text, p, span, div') || last
    return (textEl.textContent || '').trim()
  }
  return ''
}

function inferFlagsFromDebug() {
  const dbg = window.__serenityDebug || {}
  const raw = dbg.lastWSMessage || dbg.rawResponse || null
  let flags = { TendenciaSuicida: false, PautasDeAlarmaClinicas: false, ViolenciaRiesgoExtremo: false }
  if (!raw) return flags
  const ar = raw?.action_results || raw?.result || raw?.skills || null
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
  if (ar && typeof ar === 'object') {
    const direct = {
      TendenciaSuicida: norm(ar.TendenciaSuicida?.result ?? ar.TendenciaSuicida?.output ?? ar.TendenciaSuicida),
      PautasDeAlarmaClinicas: norm(ar.PautasDeAlarmaClinicas?.result ?? ar.PautasDeAlarmaClinicas?.output ?? ar.PautasDeAlarmaClinicas),
      ViolenciaRiesgoExtremo: norm(ar.ViolenciaRiesgoExtremo?.result ?? ar.ViolenciaRiesgoExtremo?.output ?? ar.ViolenciaRiesgoExtremo),
    }
    if (direct.TendenciaSuicida || direct.PautasDeAlarmaClinicas || direct.ViolenciaRiesgoExtremo) return direct
    for (const [k, v] of Object.entries(ar)) {
      const rf = v?.result?.flags
      if (rf && typeof rf === 'object') {
        flags = { ...flags, ...rf }
        return flags
      }
    }
    for (const [k, v] of Object.entries(ar)) {
      const out = v?.output ?? v?.result ?? v
      if (out?.type === 'CheckCondition' && (out.content === true || out.content === 'true')) {
        if (k.includes('TendenciaSuicida')) flags.TendenciaSuicida = true
        if (k.includes('PautasDeAlarmaClinicas')) flags.PautasDeAlarmaClinicas = true
        if (k.includes('ViolenciaRiesgoExtremo')) flags.ViolenciaRiesgoExtremo = true
      }
    }
  }
  return flags
}

async function sendMessageToWidget(text) {
  // Try AIHubChat API first
  try {
    if (window.AIHubChat) {
      const el = document.getElementById('aihub-chat') || document.getElementById('serenity-chat-container')
      // Some SDKs expose a global active instance; if not, fallback to DOM
    }
  } catch {}
  // DOM fallback: find input/textarea/contenteditable in widget and simulate send
  const root = document.getElementById('serenity-chat-container')
  if (!root) return
  const input = root.querySelector('textarea, input[type="text"], [contenteditable="true"], .serenity-input, .chat-input')
  if (input) {
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      input.value = text
      input.dispatchEvent(new Event('input', { bubbles: true }))
    } else {
      input.textContent = text
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    // Look for send button
    const btn = root.querySelector('button[type="submit"], .send, .serenity-send, [aria-label*="Enviar"], [title*="Enviar"], [aria-label*="Send"], [title*="Send"]')
    if (btn) {
      btn.click()
    } else {
      // Press Enter
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
    }
  }
}

async function waitForResponseAndFlags({ maxMs = 8000, pollMs = 200 }) {
  const start = Date.now()
  let lastAssistant = ''
  let lastDebugSig = ''
  while (Date.now() - start < maxMs) {
    const txt = extractAssistantTextFromDOM()
    const dbg = window.__serenityDebug || {}
    const sig = JSON.stringify({ k: dbg.responseKeys, ar: dbg.actionResultsKeys, raw: !!dbg.rawResponse, ws: !!dbg.lastWSMessage })
    if (txt && txt !== lastAssistant) {
      return true
    }
    if (sig !== lastDebugSig && (dbg.rawResponse || dbg.lastWSMessage)) {
      // Network debug changed; give flags extractor a chance
      await sleep(pollMs)
      return true
    }
    lastAssistant = txt
    lastDebugSig = sig
    await sleep(pollMs)
  }
  return false
}

function toCSV(rows) {
  const header = ['id','label','conversation','response','flag_suicida','flag_clinico','flag_violencia']
  const escape = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"'
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push([
      r.id,
      r.label,
      escape(r.conversation),
      escape(r.response),
      r.flag_suicida ? 'TRUE' : 'FALSE',
      r.flag_clinico ? 'TRUE' : 'FALSE',
      r.flag_violencia ? 'TRUE' : 'FALSE',
    ].join(','))
  }
  return lines.join('\n')
}

export default function BatchTester() {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  const run = async () => {
    setRunning(true)
    const phrases = await loadPhrases()
    setProgress({ done: 0, total: phrases.length })
    const results = []
    for (let i = 0; i < phrases.length; i++) {
      const p = phrases[i]
      await sendMessageToWidget(p.conversation)
      // wait until DOM response or network debug changes
      await waitForResponseAndFlags({ maxMs: 8000, pollMs: 250 })
      const responseText = extractAssistantTextFromDOM()
      const flags = inferFlagsFromDebug()
      const flag_suicida = !!flags.TendenciaSuicida
      const flag_clinico = !!flags.PautasDeAlarmaClinicas
      const flag_violencia = !!flags.ViolenciaRiesgoExtremo
      results.push({ id: p.id, label: p.label, conversation: p.conversation, response: responseText, flag_suicida, flag_clinico, flag_violencia })
      setProgress({ done: i + 1, total: phrases.length })
      await sleep(350)
    }
    const csv = toCSV(results)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'alarm_phrases_results.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setRunning(false)
  }

  return (
    <div style={{ marginTop: 16 }}>
      <button onClick={run} disabled={running}>
        {running ? `Corriendo... (${progress.done}/${progress.total})` : 'Ejecutar test 200 frases'}
      </button>
      <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>
        Guarda un CSV con id, label, conversación, respuesta y si el flag fue correcto.
      </div>
    </div>
  )
}
