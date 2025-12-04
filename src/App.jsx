import { useEffect, useState } from 'react'
import './App.css'
import AlertBanner, { FlagsPanel, FlagIndicator } from './components/AlertBanner.jsx'
// Debug panel removed from UI
import { initSerenityWidget, clearBannerOnUserMessage } from './serenityWidget.js'

function App() {
  const [banner, setBanner] = useState(null)
  const [flagsState, setFlagsState] = useState(null)

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
    })

    // Clear banner when the next user message has no flags
    clearBannerOnUserMessage(() => setBanner(null))
  }, [])
  const BASE_URL = (import.meta.env?.VITE_SERENITY_BASE_URL || 'https://api.serenitystar.ai/api').replace(/\/$/, '')
  const AGENT_ID = import.meta.env?.VITE_SERENITY_AGENT_CODE || 'GAIAComunidad'
  const API_KEY = import.meta.env?.VITE_SERENITY_API_KEY || ''

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

      {/* Container for SerenityChatWidget mount */}
      <div id="serenity-chat-container" className="chat-container" />
      {/* Container for AIHubChat (matches your snippet id) */}
      <div id="aihub-chat" className="chat-container" />

      {/* Debug info removed */}


      {/* Using only the Widget integration to avoid confusion */}
    </div>
  )
}

export default App
