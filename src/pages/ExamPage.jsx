import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Clock3, Maximize2, ShieldAlert } from 'lucide-react'
import Layout from '../components/Layout'
import CameraPanel from '../components/CameraPanel'
import IncidentList from '../components/IncidentList'
import { ExamMonitor } from '../core/ExamMonitor'
import { storageService } from '../services/storageService'
import { academicService } from '../services/academicService'
import { authService } from '../services/authService'
import { examService } from '../services/examService'

const formatTime = seconds => {
  const safe = Math.max(0, seconds)
  const min = String(Math.floor(safe / 60)).padStart(2, '0')
  const sec = String(safe % 60).padStart(2, '0')
  return `${min}:${sec}`
}

export default function ExamPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const user = authService.getCurrentUser()
  const assignment = academicService.getStudentAssignment(user.id)
  const requestedSubject = params.get('subject')
  const subject = assignment?.subjects.find(item => item.id === requestedSubject) || assignment?.subjects[0]
  const availableExams = useMemo(() => examService.getPublishedForSubjects(subject ? [subject.id] : []), [subject?.id])
  const requestedExam = params.get('exam')
  const exam = availableExams.find(item => item.id === requestedExam) || availableExams[0] || null
  const [incidents, setIncidents] = useState(() => storageService.getIncidents(user.id, subject?.id))
  const [remainingSeconds, setRemainingSeconds] = useState(() => (exam?.durationMinutes || 30) * 60)
  const [finished, setFinished] = useState(false)
  const monitorRef = useRef(null)
  const lastSampleRef = useRef(0)

  useEffect(() => {
    setRemainingSeconds((exam?.durationMinutes || 30) * 60)
    setFinished(false)
  }, [exam?.id])

  useEffect(() => {
    if (!exam || finished) return
    const timer = setInterval(() => {
      setRemainingSeconds(value => {
        if (value <= 1) {
          setFinished(true)
          return 0
        }
        return value - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [exam?.id, finished])

  useEffect(() => {
    if (!subject || !exam || finished) return
    monitorRef.current = new ExamMonitor({
      onIncident: incident => {
        storageService.addIncident({ ...incident, subjectId: subject.id, examId: exam.id }, user.id)
        setIncidents(storageService.getIncidents(user.id, subject.id))
      }
    })
    monitorRef.current.start()
    return () => monitorRef.current?.stop()
  }, [subject?.id, exam?.id, user.id, finished])

  const onMetric = metric => {
    if (finished) return
    monitorRef.current?.processFaceMetric(metric)
    if (metric?.hasFace && Date.now() - lastSampleRef.current > 5000) {
      lastSampleRef.current = Date.now()
      storageService.addSample({
        attention: metric.attention,
        expression: metric.expression,
        gaze: metric.gaze,
        subjectId: subject?.id || null,
        timestamp: new Date().toISOString(),
        label: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }, user.id)
    }
  }

  const requestFullscreen = () => document.documentElement.requestFullscreen?.()

  return (
    <Layout title="Examen supervisado" subtitle="La evaluación registra incidencias y respeta el tiempo definido por el maestro.">
      <div className="exam-toolbar">
        <button className="link-button" onClick={() => navigate('/student')}><ArrowLeft size={17}/> Volver</button>
        {subject && exam && <button className="secondary-button" onClick={requestFullscreen}><Maximize2 size={17}/> Pantalla completa</button>}
      </div>

      {!subject ? (
        <div className="empty-panel"><h2>No tienes materias asignadas</h2><p>El Super Admin debe asignarte al menos una materia antes de iniciar un examen.</p></div>
      ) : !exam ? (
        <div className="empty-panel"><h2>No hay evaluaciones publicadas</h2><p>Tu maestro todavía no ha publicado un examen para {subject.name}.</p></div>
      ) : (
        <>
          <div className="exam-status-bar">
            <div><span className="eyebrow">{subject.code}</span><strong>{exam.title}</strong></div>
            <div className={`exam-countdown ${remainingSeconds < 300 ? 'danger' : ''}`}><Clock3 size={18}/><span>{finished ? 'Tiempo finalizado' : formatTime(remainingSeconds)}</span></div>
          </div>
          <div className="warning-banner"><ShieldAlert size={21}/><span>Durante el examen se detectan cambios de pestaña, ausencia de rostro, mirada desviada y salida de pantalla completa.</span></div>
          {exam.instructions && <div className="exam-instructions"><strong>Instrucciones:</strong><span>{exam.instructions}</span></div>}
          <div className="exam-grid">
            <div className="exam-main">
              <div className="form-card">
                <div className="section-title"><h3>{exam.title}</h3><span>{exam.durationMinutes} minutos</span></div>
                {finished ? (
                  <div className="exam-finished"><Clock3 size={42}/><h2>Tiempo finalizado</h2><p>La evaluación quedó cerrada en ClassFocus. Las incidencias registradas se conservaron.</p><button className="primary-button" onClick={() => navigate('/student')}>Volver al panel</button></div>
                ) : exam.formUrl ? (
                  <iframe title="Formulario de examen" src={exam.formUrl} className="exam-frame" />
                ) : (
                  <div className="mock-exam">
                    <label>1. Selecciona la respuesta correcta<select defaultValue=""><option value="" disabled>Selecciona...</option><option>Opción A</option><option>Opción B</option><option>Opción C</option></select></label>
                    <label>2. Describe un concepto visto en {subject.name}.<textarea rows="5" placeholder="Escribe tu respuesta..." /></label>
                    <button className="primary-button" type="button" onClick={() => setFinished(true)}>Enviar examen demo</button>
                  </div>
                )}
                {!exam.formUrl && !finished && <p className="frame-help">El maestro puede editar esta evaluación y agregar un enlace embebible de Google Forms o Microsoft Forms.</p>}
              </div>
              <IncidentList incidents={incidents} />
            </div>
            {!finished && <CameraPanel onMetric={onMetric} compact />}
          </div>
        </>
      )}
    </Layout>
  )
}
