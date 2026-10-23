import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Clock3, Maximize2, ShieldAlert, ShieldCheck } from 'lucide-react'
import Layout from '../components/Layout'
import CameraPanel from '../components/CameraPanel'
import IncidentList from '../components/IncidentList'
import { ExamMonitor } from '../core/ExamMonitor'
import { storageService } from '../services/storageService'
import { academicService } from '../services/academicService'
import { authService } from '../services/authService'
import { examService } from '../services/examService'

// La hora límite se guarda en la pestaña: recargar la página ya no reinicia el cronómetro.
const deadlineKey = (userId, examId) => `classfocus_exam_deadline_${userId}_${examId}`
const readDeadline = (userId, examId) => {
  const value = Number(sessionStorage.getItem(deadlineKey(userId, examId)))
  return Number.isFinite(value) && value > 0 ? value : 0
}

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
  const initialDeadline = exam ? readDeadline(user.id, exam.id) : 0
  const [started, setStarted] = useState(Boolean(initialDeadline))
  const [consent, setConsent] = useState(false)
  const [remainingSeconds, setRemainingSeconds] = useState(() => initialDeadline
    ? Math.max(0, Math.ceil((initialDeadline - Date.now()) / 1000))
    : (exam?.durationMinutes || 30) * 60)
  const [finished, setFinished] = useState(Boolean(initialDeadline) && initialDeadline <= Date.now())
  const monitorRef = useRef(null)
  const lastSampleRef = useRef(0)
  const lastFrameRef = useRef(Date.now())

  useEffect(() => {
    // Al cambiar de evaluación se recupera su estado (si ya había iniciado) o se vuelve a pedir el consentimiento.
    const deadline = exam ? readDeadline(user.id, exam.id) : 0
    setConsent(false)
    setStarted(Boolean(deadline))
    setFinished(Boolean(deadline) && deadline <= Date.now())
    setRemainingSeconds(deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : (exam?.durationMinutes || 30) * 60)
  }, [exam?.id])

  useEffect(() => {
    if (!exam || !started || finished) return
    const tick = () => {
      const deadline = readDeadline(user.id, exam.id)
      if (!deadline) return
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setRemainingSeconds(left)
      if (left === 0) setFinished(true)
    }
  
    tick()
    const timer = setInterval(tick, 500)
    return () => clearInterval(timer)
  }, [exam?.id, started, finished])

  useEffect(() => {
    if (!subject || !exam || !started || finished) return
    monitorRef.current = new ExamMonitor({
      onIncident: incident => {
        storageService.addIncident({ ...incident, subjectId: subject.id, examId: exam.id }, user.id)
        setIncidents(storageService.getIncidents(user.id, subject.id))
      }
    })
    monitorRef.current.start()
    return () => monitorRef.current?.stop()
  }, [subject?.id, exam?.id, user.id, started, finished])
    // Vigila que la cámara siga enviando imagen mientras dura el examen.
  useEffect(() => {
    if (!exam || !started || finished) return
    lastFrameRef.current = Date.now()
    const onVisible = () => { if (!document.hidden) lastFrameRef.current = Date.now() }
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(() => {
      if (document.hidden) return
      if (Date.now() - lastFrameRef.current > 12000) {
        monitorRef.current?.emit('camera-off', 'La cámara está apagada o no envía imagen', 'high', 20000)
      }
    }, 3000)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [exam?.id, started, finished])
  
  const startExam = () => {
    if (!exam || !consent) return
    sessionStorage.setItem(deadlineKey(user.id, exam.id), String(Date.now() + exam.durationMinutes * 60000))
    setRemainingSeconds(exam.durationMinutes * 60)
    setStarted(true)
    document.documentElement.requestFullscreen?.().catch(() => {})
  }

  const submitExam = () => {
    // Enviar cierra el intento: la hora límite pasa a ser ahora.
    if (exam) sessionStorage.setItem(deadlineKey(user.id, exam.id), String(Date.now()))
    setFinished(true)
  }

  const onMetric = metric => {
    if (finished || !started) return
    lastFrameRef.current = Date.now()
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
        {subject && exam && started && <button className="secondary-button" onClick={requestFullscreen}><Maximize2 size={17}/> Pantalla completa</button>}
      </div>

      {!subject ? (
        <div className="empty-panel"><h2>No tienes materias asignadas</h2><p>El Super Admin debe asignarte al menos una materia antes de iniciar un examen.</p></div>
      ) : !exam ? (
        <div className="empty-panel"><h2>No hay evaluaciones publicadas</h2><p>Tu maestro todavía no ha publicado un examen para {subject.name}.</p></div>
      ) : (
        <>
          <div className="exam-status-bar">
            <div><span className="eyebrow">{subject.code}</span><strong>{exam.title}</strong></div>
            <div className={`exam-countdown ${started && remainingSeconds < 300 ? 'danger' : ''}`}><Clock3 size={18}/><span>{finished ? 'Tiempo finalizado' : started ? formatTime(remainingSeconds) : `${exam.durationMinutes} min`}</span></div>
          </div>
          <div className="warning-banner"><ShieldAlert size={21}/><span>Durante el examen se detectan cambios de pestaña, ausencia de rostro, mirada desviada y salida de pantalla completa.</span></div>
          {exam.instructions && <div className="exam-instructions"><strong>Instrucciones:</strong><span>{exam.instructions}</span></div>}
          <div className="exam-grid">
            <div className="exam-main">
              <div className="form-card">
                <div className="section-title"><h3>{exam.title}</h3><span>{exam.durationMinutes} minutos</span></div>
                {!started ? (
                  <div className="exam-consent">
                    <ShieldCheck size={34}/>
                    <h2>Antes de comenzar</h2>
                    <p>Durante la evaluación ClassFocus usará tu cámara para estimar si tu rostro está presente y hacia dónde miras, y registrará cambios de pestaña, salidas de pantalla completa, copiar/pegar y la presencia de otras personas.</p>
                    <ul>
                      <li>El video se analiza en tu navegador y <strong>no se graba ni se almacena</strong>.</li>
                      <li>Solo se guardan indicadores numéricos y las incidencias, visibles para tu maestro.</li>
                      <li>Son estimaciones de apoyo: <strong>no se usan como única prueba</strong> para sancionarte.</li>
                      <li>El tiempo comienza al aceptar ({exam.durationMinutes} minutos) y no se reinicia al recargar la página.</li>
                    </ul>
                    <label className="consent-check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> He leído esta información y acepto el uso de la cámara durante la evaluación.</label>
                    <button className="primary-button" type="button" disabled={!consent} onClick={startExam}>Aceptar e iniciar examen</button>
                  </div>
                ) : finished ? (
                  <div className="exam-finished"><Clock3 size={42}/><h2>Tiempo finalizado</h2><p>La evaluación quedó cerrada en ClassFocus. Las incidencias registradas se conservaron.</p><button className="primary-button" onClick={() => navigate('/student')}>Volver al panel</button></div>
                ) : exam.formUrl ? (
                  <iframe title="Formulario de examen" src={exam.formUrl} className="exam-frame" />
                ) : (
                  <div className="mock-exam">
                    <label>1. Selecciona la respuesta correcta<select defaultValue=""><option value="" disabled>Selecciona...</option><option>Opción A</option><option>Opción B</option><option>Opción C</option></select></label>
                    <label>2. Describe un concepto visto en {subject.name}.<textarea rows="5" placeholder="Escribe tu respuesta..." /></label>
                    <button className="primary-button" type="button" onClick={submitExam}>Enviar examen demo</button>
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
