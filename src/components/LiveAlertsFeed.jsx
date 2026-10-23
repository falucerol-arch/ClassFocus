import { useEffect, useRef, useState } from 'react'
import { Bell, BellOff, Radio } from 'lucide-react'
import { apiClient } from '../services/apiClient'
import { typeLabels } from './IncidentList'

const POLL_MS = 3000

// Muestra las incidencias de tus alumnos casi al instante (consulta cada 3 s). No guarda nada en el navegador.
export default function LiveAlertsFeed({ onNew }) {
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('connecting')
  const [sound, setSound] = useState(false)
  const cursorRef = useRef(null)
  const audioRef = useRef(null)
  const soundRef = useRef(false)
  const onNewRef = useRef(onNew)

  useEffect(() => { onNewRef.current = onNew }, [onNew])
  // Quita el resaltado de las alertas nuevas pasados unos segundos.
  useEffect(() => {
    const timer = setInterval(() => setItems(current => (current.some(item => item.freshUntil > Date.now()) ? [...current] : current)), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => { soundRef.current = sound }, [sound])

  const toggleSound = () => {
    const next = !sound
    setSound(next)
    // El navegador solo permite crear el audio tras un clic del usuario.
    if (next && !audioRef.current) {
      const Context = window.AudioContext || window.webkitAudioContext
      if (Context) audioRef.current = new Context()
    }
  }

  const beep = () => {
    const ctx = audioRef.current
    if (!ctx || !soundRef.current) return
    try {
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.frequency.value = 880
      gain.gain.value = 0.06
      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start()
      oscillator.stop(ctx.currentTime + 0.14)
    } catch { /* El sonido es opcional. */ }
  }

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      if (document.hidden) return
      try {
        const data = await apiClient.liveIncidents(cursorRef.current)
        if (cancelled) return
        cursorRef.current = data.lastId
        setStatus('live')
        if (data.incidents.length) {
          const fresh = data.incidents.map(item => ({ ...item, freshUntil: Date.now() + 5000 }))
          setItems(current => [...fresh.reverse(), ...current].slice(0, 12))
          beep()
          onNewRef.current?.(data.incidents)
        }
      } catch {
        if (!cancelled) setStatus('offline')
      }
    }
    poll()
    const timer = setInterval(poll, POLL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])

  return (
    <section className="live-alerts">
      <div className="live-alerts-head">
        <div>
          <span className="eyebrow">ALERTAS EN VIVO</span>
          <h2>Lo que está pasando ahora</h2>
        </div>
        <div className="live-alerts-actions">
          <span className={`live-chip ${status}`}><Radio size={14} /> {status === 'live' ? 'En vivo' : status === 'offline' ? 'Sin conexión' : 'Conectando…'}</span>
          <button className="secondary-button" type="button" onClick={toggleSound}>{sound ? <Bell size={16} /> : <BellOff size={16} />} {sound ? 'Sonido activado' : 'Activar sonido'}</button>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="empty-state">Sin alertas nuevas. Cuando un alumno tenga una incidencia durante un examen, aparecerá aquí al instante.</div>
      ) : (
        <div className="live-alert-list">
          {items.map(item => (
            <div key={item.id} className={`live-alert ${item.severity} ${item.freshUntil > Date.now() ? 'fresh' : ''}`}>
              <span className={`severity ${item.severity}`}></span>
              <div><strong>{item.studentName}</strong><small>{typeLabels[item.type] || item.type} · {item.subjectName}</small></div>
              <time>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
