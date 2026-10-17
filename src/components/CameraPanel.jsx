import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, ScanFace } from 'lucide-react'
import { CameraManager } from '../core/CameraManager'
import { FaceAnalyzer } from '../core/FaceAnalyzer'

export default function CameraPanel({ onMetric, onStreamChange, compact = false }) {
  const videoRef = useRef(null)
  const cameraRef = useRef(null)
  const analyzerRef = useRef(null)
  const rafRef = useRef(null)
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(false)
  const [metric, setMetric] = useState({ hasFace: false, attention: 0, gaze: 'Esperando cámara', expression: 'Sin analizar' })
  const [error, setError] = useState('')

  const stop = () => {
    cancelAnimationFrame(rafRef.current)
    onStreamChange?.(null)
    cameraRef.current?.stop()
    analyzerRef.current?.close()
    setRunning(false)
  }

  const start = async () => {
    setLoading(true)
    setError('')
    try {
      cameraRef.current = new CameraManager(videoRef.current)
      analyzerRef.current = new FaceAnalyzer()
      const stream = await cameraRef.current.start()
      onStreamChange?.(stream)
      await analyzerRef.current.initialize()
      setRunning(true)

      const loop = () => {
        const next = analyzerRef.current?.analyze(videoRef.current)
        if (next) {
          setMetric(next)
          onMetric?.(next)
        }
        rafRef.current = requestAnimationFrame(loop)
      }
      loop()
    } catch (e) {
      setError(e.message || 'No se pudo iniciar la cámara o MediaPipe.')
      cameraRef.current?.stop()
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => () => stop(), [])

  return (
    <div className={`camera-card ${compact ? 'compact' : ''}`}>
      <div className="video-wrap">
        <video ref={videoRef} muted playsInline />
        {!running && <div className="camera-placeholder"><Camera size={40} /><span>Cámara detenida</span></div>}
        {running && <div className={`face-pill ${metric.hasFace ? 'ok' : 'warn'}`}><ScanFace size={16} /> {metric.hasFace ? 'Rostro detectado' : 'Sin rostro'}</div>}
      </div>
      <div className="camera-metrics">
        <div><span>Atención</span><strong>{metric.attention}%</strong></div>
        <div><span>Mirada</span><strong>{metric.gaze}</strong></div>
        <div><span>Estado</span><strong>{metric.expression}</strong></div>
      </div>
      {error && <div className="alert error">{error}</div>}
      <button className={`primary-button ${running ? 'danger' : ''}`} onClick={running ? stop : start} disabled={loading}>
        {running ? <CameraOff size={18} /> : <Camera size={18} />}
        {loading ? 'Iniciando...' : running ? 'Detener cámara' : 'Iniciar cámara'}
      </button>
    </div>
  )
}
