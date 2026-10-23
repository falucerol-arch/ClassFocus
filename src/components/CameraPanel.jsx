import { useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, ScanFace, Users } from 'lucide-react'
import { CameraManager } from '../core/CameraManager'
import { FaceAnalyzer } from '../core/FaceAnalyzer'
import { clearMesh, drawFaceMesh } from '../core/meshRenderer'

// showMesh: dibuja la malla facial. anonymous: oculta el video y deja solo la malla (nada de imagen real).
export default function CameraPanel({ onMetric, onStreamChange, onReady, compact = false, showMesh = false, anonymous = false, hideMetrics = false }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const cameraRef = useRef(null)
  const analyzerRef = useRef(null)
  const rafRef = useRef(null)
  const meshRef = useRef(showMesh)
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(false)
  const [metric, setMetric] = useState({ hasFace: false, attention: 0, gaze: 'Esperando cámara', expression: 'Sin analizar', faceCount: 0 })
  const [error, setError] = useState('')

  useEffect(() => {
    meshRef.current = showMesh
    if (!showMesh) clearMesh(canvasRef.current)
  }, [showMesh])

  const stop = () => {
    cancelAnimationFrame(rafRef.current)
    onStreamChange?.(null)
    cameraRef.current?.stop()
    analyzerRef.current?.close()
    clearMesh(canvasRef.current)
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
      onReady?.({ source: analyzerRef.current.source, delegate: analyzerRef.current.delegate })
      setRunning(true)

      const loop = () => {
        const next = analyzerRef.current?.analyze(videoRef.current)
        if (next) {
          setMetric(next)
          onMetric?.(next)
          if (meshRef.current) drawFaceMesh(canvasRef.current, videoRef.current, next.faces)
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
      <div className={`video-wrap ${anonymous ? 'anonymous' : ''}`}>
        <video ref={videoRef} muted playsInline />
        <canvas ref={canvasRef} className="mesh-canvas" />
        {!running && <div className="camera-placeholder"><Camera size={40} /><span>Cámara detenida</span></div>}
        {running && <div className={`face-pill ${metric.hasFace ? 'ok' : 'warn'}`}><ScanFace size={16} /> {metric.hasFace ? 'Rostro detectado' : 'Sin rostro'}</div>}
        {running && metric.faceCount > 1 && <div className="face-pill multi"><Users size={16} /> {metric.faceCount} personas</div>}
      </div>
      {!hideMetrics && (
        <div className="camera-metrics">
          <div><span>Atención</span><strong>{metric.attention}%</strong></div>
          <div><span>Mirada</span><strong>{metric.gaze}</strong></div>
          <div><span>Estado</span><strong>{metric.expression}</strong></div>
        </div>
      )}
      {error && <div className="alert error">{error}</div>}
      <button className={`primary-button ${running ? 'danger' : ''}`} onClick={running ? stop : start} disabled={loading}>
        {running ? <CameraOff size={18} /> : <Camera size={18} />}
        {loading ? 'Iniciando...' : running ? 'Detener cámara' : 'Iniciar cámara'}
      </button>
    </div>
  )
}
