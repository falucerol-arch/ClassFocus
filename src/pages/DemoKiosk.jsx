import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Cpu, EyeOff, Lock, ScanFace, ShieldCheck, Sparkles } from 'lucide-react'
import BrandMark from '../components/BrandMark'
import CameraPanel from '../components/CameraPanel'
import IncidentList from '../components/IncidentList'
import { ExamMonitor } from '../core/ExamMonitor'
import './DemoKiosk.css'

const RING_RADIUS = 54
const RING_LENGTH = 2 * Math.PI * RING_RADIUS

function statusFor(metric) {
  if (!metric.hasFace) return { key: 'warn', label: 'Sin rostro', hint: 'Colócate frente a la cámara' }
  if (metric.faceCount > 1) return { key: 'warn', label: 'Varias personas', hint: 'Solo debería haber una persona' }
  if (metric.attention >= 70) return { key: 'ok', label: 'Atento', hint: 'Mirando al frente' }
  if (metric.attention >= 55) return { key: 'mid', label: 'Atención media', hint: 'Mirada ligeramente desviada' }
  return { key: 'bad', label: 'Distraído', hint: 'Mirada desviada' }
}

export default function DemoKiosk() {
  const navigate = useNavigate()
  const [showMesh, setShowMesh] = useState(true)
  const [anonymous, setAnonymous] = useState(false)
  const [engine, setEngine] = useState(null)
  const [view, setView] = useState({ hasFace: false, faceCount: 0, attention: 0, yaw: 0, gaze: 'Esperando cámara' })
  const [history, setHistory] = useState([])
  const [incidents, setIncidents] = useState([])
  const [stats, setStats] = useState({ attentivePct: 0, distractions: 0, tabs: 0, seconds: 0 })

  const monitorRef = useRef(null)
  const smoothRef = useRef(0)
  const lastUiRef = useRef(0)
  const lastSparkRef = useRef(0)
  const framesRef = useRef({ total: 0, attentive: 0 })
  const distractedRef = useRef(false)
  const countersRef = useRef({ distractions: 0, tabs: 0 })
  const startedAtRef = useRef(0)

  // Mismo motor de reglas que usan los exámenes, pero aquí nada se guarda: queda solo en esta pantalla.
  useEffect(() => {
    monitorRef.current = new ExamMonitor({
      onIncident: incident => {
        if (incident.type === 'tab') countersRef.current.tabs += 1
        setIncidents(items => [incident, ...items].slice(0, 30))
      }
    })
    monitorRef.current.start()
    return () => monitorRef.current?.stop()
  }, [])

  const onMetric = metric => {
    if (!startedAtRef.current) startedAtRef.current = Date.now()
    monitorRef.current?.processFaceMetric(metric)

    const now = Date.now()
    framesRef.current.total += 1
    const attentive = metric.hasFace && metric.faceCount <= 1 && metric.attention >= 55
    if (attentive) framesRef.current.attentive += 1

    // Una distracción es el paso de "atento" a "no atento", no cada fotograma.
    if (!attentive && !distractedRef.current) {
      distractedRef.current = true
      countersRef.current.distractions += 1
    } else if (attentive && metric.attention >= 62) {
      distractedRef.current = false
    }

    smoothRef.current = smoothRef.current ? smoothRef.current * 0.85 + metric.attention * 0.15 : metric.attention

    if (now - lastUiRef.current > 90) {
      lastUiRef.current = now
      setView({ hasFace: metric.hasFace, faceCount: metric.faceCount, attention: Math.round(smoothRef.current), yaw: metric.yaw, gaze: metric.gaze })
      const { total, attentive: ok } = framesRef.current
      setStats({
        attentivePct: total ? Math.round((ok / total) * 100) : 0,
        distractions: countersRef.current.distractions,
        tabs: countersRef.current.tabs,
        seconds: Math.round((now - startedAtRef.current) / 1000)
      })
    }
    if (now - lastSparkRef.current > 500) {
      lastSparkRef.current = now
      setHistory(items => [...items, metric.hasFace ? Math.round(smoothRef.current) : 0].slice(-80))
    }
  }

  const status = statusFor(view)
  const dash = RING_LENGTH * (1 - Math.min(100, view.attention) / 100)
  // Mismo criterio que la etiqueta de mirada: yaw positivo = izquierda.
  const dotX = 60 - Math.max(-0.5, Math.min(0.5, view.yaw)) * 90
  const spark = useMemo(() => {
    if (history.length < 2) return ''
    return history.map((value, index) => `${(index / (history.length - 1)) * 300},${60 - (value / 100) * 56}`).join(' ')
  }, [history])
  const mm = String(Math.floor(stats.seconds / 60)).padStart(2, '0')
  const ss = String(stats.seconds % 60).padStart(2, '0')

  return (
    <div className="demo-page">
      <header className="demo-top">
        <BrandMark />
        <button className="demo-back" onClick={() => navigate('/')}><ArrowLeft size={16} /> Ir al acceso</button>
      </header>

      <section className="demo-hero">
        <span className="demo-kicker"><Sparkles size={14} /> DEMO EN VIVO</span>
        <h1>Así “ve” ClassFocus a un estudiante</h1>
        <p>Inicia la cámara y mira el análisis en tiempo real. Intenta girar la cabeza, mirar a un lado, tapar tu rostro, acercar a otra persona o cambiar de pestaña.</p>
      </section>

      <div className="demo-grid">
        <div className="demo-camera">
          <CameraPanel showMesh={showMesh} anonymous={anonymous} hideMetrics onMetric={onMetric} onReady={setEngine} />
          <div className="demo-toggles">
            <label><input type="checkbox" checked={showMesh} onChange={e => setShowMesh(e.target.checked)} /> Mostrar malla facial</label>
            <label><input type="checkbox" checked={anonymous} onChange={e => setAnonymous(e.target.checked)} /> <EyeOff size={14} /> Modo anónimo (solo la malla)</label>
          </div>
          <div className="demo-privacy">
            <Lock size={15} />
            <span>El video se procesa en tu navegador. En esta demo no se guarda ni se envía nada.</span>
          </div>
          {engine && <div className="demo-engine"><Cpu size={14} /> Motor: {engine.source === 'local' ? 'archivos locales (sin internet)' : 'descarga desde CDN'} · {engine.delegate}</div>}
        </div>

        <div className="demo-panel">
          <div className={`demo-status ${status.key}`}>
            <div className="demo-ring">
              <svg viewBox="0 0 120 120" aria-hidden="true">
                <circle className="track" cx="60" cy="60" r={RING_RADIUS} />
                <circle className="value" cx="60" cy="60" r={RING_RADIUS} strokeDasharray={RING_LENGTH} strokeDashoffset={dash} transform="rotate(-90 60 60)" />
              </svg>
              <div className="demo-ring-number"><strong>{view.attention}</strong><span>% atención</span></div>
            </div>
            <div className="demo-status-copy">
              <span className="demo-badge">{status.label}</span>
              <p>{status.hint}</p>
              <small><ScanFace size={13} /> {view.gaze}</small>
            </div>
            <div className="demo-gaze" aria-label="Dirección de la mirada">
              <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" className="gaze-ring" /><line x1="60" y1="8" x2="60" y2="112" className="gaze-axis" /><line x1="8" y1="60" x2="112" y2="60" className="gaze-axis" /><circle cx={dotX} cy="60" r="8" className="gaze-dot" /></svg>
              <small>Giro de cabeza</small>
            </div>
          </div>

          <div className="demo-stats">
            <div><strong>{stats.attentivePct}%</strong><span>Tiempo atento</span></div>
            <div><strong>{stats.distractions}</strong><span>Distracciones</span></div>
            <div><strong>{stats.tabs}</strong><span>Cambios de pestaña</span></div>
            <div><strong>{mm}:{ss}</strong><span>Tiempo de sesión</span></div>
          </div>

          <div className="demo-spark">
            <div className="demo-spark-head"><strong>Atención en el tiempo</strong><span>últimos {Math.round(history.length / 2)} s</span></div>
            <svg viewBox="0 0 300 60" preserveAspectRatio="none">
              <line x1="0" y1="29.2" x2="300" y2="29.2" className="spark-threshold" />
              {spark && <polyline points={spark} className="spark-line" />}
            </svg>
            <small>La línea punteada marca el umbral de 55 % usado para generar alertas.</small>
          </div>

          <IncidentList incidents={incidents} />

          <div className="demo-note">
            <ShieldCheck size={16} />
            <span>Estas señales son estimaciones técnicas de apoyo para el docente. No son una prueba concluyente ni deben usarse como única base para sancionar.</span>
          </div>
        </div>
      </div>
    </div>
  )
}
