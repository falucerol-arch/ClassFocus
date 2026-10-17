import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Info, Radio, Video } from 'lucide-react'
import Layout from '../components/Layout'
import CameraPanel from '../components/CameraPanel'
import { storageService } from '../services/storageService'
import { academicService } from '../services/academicService'
import { authService } from '../services/authService'
import { StudentLiveBroadcaster } from '../services/liveClassService'

export default function ClassSession() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const user = authService.getCurrentUser()
  const assignment = academicService.getStudentAssignment(user.id)
  const requestedSubject = params.get('subject')
  const subject = assignment?.subjects.find(item => item.id === requestedSubject) || assignment?.subjects[0]
  const teacher = subject ? academicService.getTeacherForStudentSubject(user.id, subject.id) : null
  const lastSavedRef = useRef(0)
  const broadcasterRef = useRef(null)
  const [liveStatus, setLiveStatus] = useState('Inicia la cámara para aparecer en el monitor del maestro.')

  useEffect(() => () => broadcasterRef.current?.stop(), [])

  const onMetric = metric => {
    if (!metric?.hasFace || Date.now() - lastSavedRef.current < 5000) return
    lastSavedRef.current = Date.now()
    storageService.addSample({
      attention: metric.attention,
      expression: metric.expression,
      gaze: metric.gaze,
      subjectId: subject?.id || null,
      timestamp: new Date().toISOString(),
      label: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }, user.id)
  }

  const onStreamChange = stream => {
    broadcasterRef.current?.stop()
    broadcasterRef.current = null
    if (!stream || !subject) {
      setLiveStatus('Cámara detenida. Ya no estás transmitiendo al monitor de clase.')
      return
    }
    broadcasterRef.current = new StudentLiveBroadcaster({
      student: user,
      subject,
      stream,
      onStatus: setLiveStatus
    })
  }

  return (
    <Layout title="Clase en vivo" subtitle="Tu cámara y métricas se mantienen activas mientras participas en la sesión.">
      <button className="link-button" onClick={() => navigate('/student')}><ArrowLeft size={17}/> Volver al panel</button>
      {!subject ? (
        <div className="empty-panel"><h2>No tienes materias asignadas</h2><p>Solicita al Super Admin que configure tu maestro y materias.</p></div>
      ) : (
        <div className="session-grid">
          <CameraPanel onMetric={onMetric} onStreamChange={onStreamChange} />
          <section className="lesson-card">
            <div className="lesson-tag"><Video size={18}/> Sesión activa</div>
            <h2>{subject.name} — Clase en vivo</h2>
            <p>Al iniciar la cámara, el docente asignado puede verla desde su monitor de clase. Las métricas de atención siguen guardándose para esta materia.</p>
            <div className="live-share-status"><Radio size={18}/><div><strong>Transmisión al maestro</strong><span>{liveStatus}</span></div></div>
            <div className="note"><Info size={18}/><span>La cámara solo se comparte mientras tú la mantienes encendida dentro de esta sesión.</span></div>
            <div className="fake-meeting">
              <div className="meeting-person">{teacher?.name?.split(' ').map(x => x[0]).slice(-2).join('') || 'CF'}</div>
              <div><strong>{teacher?.name || 'Maestro pendiente'}</strong><span>Impartiendo {subject.name}...</span></div>
            </div>
          </section>
        </div>
      )}
    </Layout>
  )
}
