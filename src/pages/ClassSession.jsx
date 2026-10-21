import { useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import LiveClassroom from '../components/LiveClassroom'
import { storageService } from '../services/storageService'
import { academicService } from '../services/academicService'
import { authService } from '../services/authService'

export default function ClassSession() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const user = authService.getCurrentUser()
  const teacher = user.role === 'teacher'
  const subjects = teacher ? academicService.getSubjectsForTeacher(user.id) : academicService.getStudentAssignment(user.id)?.subjects || []
  const requested = params.get('subject')
  const subject = requested ? subjects.find(item => item.id === requested) : subjects[0]
  const lastSaved = useRef(0)
  const exit = () => navigate(teacher ? '/teacher' : '/student')
  function onMetric(metric) {
    if (!metric?.hasFace || Date.now() - lastSaved.current < 5000) return
    lastSaved.current = Date.now()
    storageService.addSample({ attention: metric.attention, expression: metric.expression, gaze: metric.gaze,
      subjectId: subject.id, timestamp: new Date().toISOString(),
      label: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }, user.id)
  }
  return subject ? <LiveClassroom key={subject.id} role={user.role} user={user} subject={subject}
    onMetric={teacher ? undefined : onMetric} onExit={exit} /> :
    <main className="meeting-unavailable"><h1>Esta materia no está disponible</h1>
      <p>Vuelve a tu panel y selecciona una materia que tengas asignada.</p><button className="primary-button" onClick={exit}>Volver al panel</button></main>
}
