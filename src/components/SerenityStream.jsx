import { useEffect } from 'react'

export default function SerenityStream({ baseURL, agentId, apiKey, onFlagsDetected, onFinalMessage }) {
  useEffect(() => {
    const controller = new AbortController()

    const run = async () => {
      try {
        // If baseURL contains '/api', strip it for REST v1 root
        const apiRoot = baseURL.replace(/\/$/, '').replace(/\/api$/, '')
        const res = await fetch(`${apiRoot}/v1/agents/${agentId}/run`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'text/event-stream',
          },
          body: JSON.stringify({ input: { messages: [{ role: 'user', content: 'Me quiero suicidar' }] } }),
          signal: controller.signal,
        })
        const reader = res.body.getReader()
        const decoder = new TextDecoder('utf-8')
        let suicidalFlag = false
        let clinicalFlag = false
        let violenceFlag = false

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value)
          const lines = chunk.split('\n').filter(l => l.startsWith('data:'))
          for (const line of lines) {
            const raw = line.replace(/^data:\s*/, '')
            if (!raw) continue
            let json
            try { json = JSON.parse(raw) } catch { continue }

            // Detect skill outputs
            if (json.type === 'task_stop' && typeof json.task_key === 'string') {
              const out = json.output
              const truthy = out && (out.content === true || out.content === 'true')
              if (truthy) {
                if (json.task_key.includes('TendenciaSuicida')) suicidalFlag = true
                if (json.task_key.includes('PautasDeAlarmaClinicas')) clinicalFlag = true
                if (json.task_key.includes('ViolenciaRiesgoExtremo')) violenceFlag = true
                onFlagsDetected?.({ TendenciaSuicida: suicidalFlag, PautasDeAlarmaClinicas: clinicalFlag, ViolenciaRiesgoExtremo: violenceFlag })
              }
            }

            // Final agent message
            if (json.type === 'stop' && json.result?.content) {
              onFinalMessage?.(json.result.content)
              onFlagsDetected?.({ TendenciaSuicida: suicidalFlag, PautasDeAlarmaClinicas: clinicalFlag, ViolenciaRiesgoExtremo: violenceFlag })
            }
          }
        }
      } catch (e) {
        console.warn('SSE stream error:', e)
      }
    }

    run()
    return () => controller.abort()
  }, [baseURL, agentId, apiKey, onFlagsDetected, onFinalMessage])

  return null
}