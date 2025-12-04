import './AlertBanner.css'

function AlertBanner({ variant = 'info', message }) {
  if (!message) return null
  return (
    <div className={`alert-banner alert-${variant}`} role="alert">
      <span className="alert-banner__text">{message}</span>
    </div>
  )
}

export function FlagsPanel({ flags }) {
  if (!flags || Object.keys(flags).length === 0) return null
  const entries = Object.entries(flags).filter(([_, v]) => v === true)
  if (entries.length === 0) return null
  return (
    <div className="flags-panel">
      <strong>Flags capturados:</strong>
      <ul>
        {entries.map(([key]) => (
          <li key={key}>{key}</li>
        ))}
      </ul>
    </div>
  )
}

// Fixed minimal indicator squares that are always visible
export function FlagIndicator({ flags }) {
  const ts = !!(flags && flags.TendenciaSuicida);
  const ac = !!(flags && flags.PautasDeAlarmaClinicas);
  const ve = !!(flags && flags.ViolenciaRiesgoExtremo);
  return (
    <div className="flag-indicator" title="Estado de flags">
      <div className={`flag-square ts ${ts ? 'filled' : 'empty'}`} aria-label="Tendencia Suicida" title={`Tendencia Suicida: ${ts ? 'true' : 'false'}`} />
      <div className={`flag-square ac ${ac ? 'filled' : 'empty'}`} aria-label="Pautas De Alarma Clínicas" title={`Pautas De Alarma Clínicas: ${ac ? 'true' : 'false'}`} />
      <div className={`flag-square ve ${ve ? 'filled' : 'empty'}`} aria-label="Violencia / Riesgo Extremo" title={`Violencia / Riesgo Extremo: ${ve ? 'true' : 'false'}`} />
    </div>
  );
}

export default AlertBanner
