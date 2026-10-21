import { useNavigate } from 'react-router-dom'
import { AlertTriangle, BookMarked, BookOpenCheck, BrainCircuit, Clock3, ExternalLink, FileText, Timer, UserRoundCheck } from 'lucide-react'
import Layout from '../components/Layout'
import MetricCard from '../components/MetricCard'
import ClassroomPanel from '../components/ClassroomPanel'
import AttentionChart from '../components/AttentionChart'
import IncidentList from '../components/IncidentList'
import { storageService } from '../services/storageService'
import { academicService } from '../services/academicService'
import { authService } from '../services/authService'
import { examService } from '../services/examService'
import { useClassPresence } from '../hooks/useClassPresence'
import '../components/ClassPresence.css'

export default function StudentDashboard() {
  const navigate = useNavigate()
  const user = authService.getCurrentUser()
  const presence = useClassPresence(user.id)
  const activeClasses = new Map(presence.classes.map(item => [item.subjectId, item]))
  const noticeSubject = presence.notice && academicService.getSubjectById(presence.notice.subjectId)
  const assignment = academicService.getStudentAssignment(user.id)
  const metrics = storageService.getMetrics(user.id)
  const samples = storageService.getSamples(user.id)
  const incidents = storageService.getIncidents(user.id)
  const exams = examService.getPublishedForSubjects(assignment?.subjectIds || [])

  return (
    <Layout title="Panel del alumno" subtitle="Consulta tus materias, evaluaciones y entra a las sesiones supervisadas.">
      <ClassroomPanel />

      <div className="class-presence-summary" role="status" aria-live="polite">
        {presence.status === 'online' ? `${presence.classes.length} clase${presence.classes.length === 1 ? '' : 's'} en vivo en tus materias` :
          presence.status === 'connecting' ? 'Consultando clases en vivo…' :
            presence.status === 'unauthorized' ? presence.message :
              'No se pudo consultar si hay clases activas. Intentando reconectar…'}
      </div>
      {presence.notice && <div className="class-start-notice" role="status">
        <div><strong>Tu maestro inició la clase de {noticeSubject?.name || 'tu materia'}.</strong>
          <span>{presence.notice.teacherName}</span></div>
        <button className="primary-button" onClick={() => navigate(`/student/class?subject=${encodeURIComponent(presence.notice.subjectId)}`)}>Unirse a clase</button>
        <button className="secondary-button" aria-label="Cerrar aviso de clase" onClick={presence.dismiss}>Cerrar</button>
      </div>}

      <div className="info-banner">
        <UserRoundCheck size={22}/>
        <div>
          <strong>{assignment?.teachers?.length ? `${assignment.teachers.length} docente${assignment.teachers.length === 1 ? '' : 's'} vinculado${assignment.teachers.length === 1 ? '' : 's'}` : 'Aún no tienes docentes asignados'}</strong>
          <span>{assignment?.subjects.length ? `${assignment.subjects.length} materias asignadas · ${exams.length} evaluaciones publicadas` : 'El Super Admin debe configurar tu asignación.'}</span>
        </div>
      </div>

      <div className="metrics-grid">
        <MetricCard icon={BrainCircuit} label="Atención promedio" value={`${metrics.attentionAverage}%`} hint="Estimación" />
        <MetricCard icon={Clock3} label="Tiempo en clase" value={`${metrics.classMinutes} min`} hint="Última sesión" />
        <MetricCard icon={AlertTriangle} label="Incidencias" value={incidents.length} hint="Exámenes y clase" />
        <MetricCard icon={BookOpenCheck} label="Estado aparente" value={metrics.lastExpression} hint="Estimación facial" />
      </div>

      {exams.length > 0 && (
        <section className="subjects-section exams-available-section">
          <div className="section-title"><div><h3>Evaluaciones disponibles</h3><span>Publicadas por tus maestros</span></div><FileText size={21}/></div>
          <div className="student-exam-grid">
            {exams.map(exam => {
              const subject = academicService.getSubjectById(exam.subjectId)
              return (
                <article key={exam.id} className="student-exam-card">
                  <div className="student-exam-top"><span>{subject?.code || 'EXAM'}</span><span><Timer size={14}/>{exam.durationMinutes} min</span></div>
                  <h3>{exam.title}</h3>
                  <p>{exam.instructions || 'Evaluación supervisada por ClassFocus.'}</p>
                  <button className="primary-button" onClick={() => navigate(`/student/exam?subject=${exam.subjectId}&exam=${exam.id}`)}><FileText size={17}/> Iniciar evaluación</button>
                </article>
              )
            })}
          </div>
        </section>
      )}

      <section className="subjects-section">
        <div className="section-title"><div><h3>Mis materias</h3><span>Asignadas por administración</span></div><BookMarked size={21}/></div>
        {assignment?.subjects.length ? (
          <div className="subject-course-grid">
            {assignment.subjects.map(subject => {
              const subjectExams = exams.filter(exam => exam.subjectId === subject.id)
              const active = activeClasses.get(subject.id)
              const confirmed = presence.status === 'online'
              return (
                <article className="subject-course-card" key={subject.id}>
                  <div>
                    <small>{subject.code}{subject.source === 'google-classroom' ? ' · Classroom' : ''}</small>
                    <h3>{subject.name}</h3>
                    <span className={`subject-live-status ${active ? 'is-live' : ''}`}>
                      {active ? '● Clase en vivo' : confirmed ? 'Sin clase activa' : presence.status === 'connecting' ? 'Verificando clase…' : 'Estado de clase no disponible'}
                    </span>
                    {active && <p className="course-schedule">Impartiendo: {active.teacherName}</p>}
                    <p>Docente: {assignment.subjectTeachers?.[subject.id]?.name || 'Pendiente'}</p>
                    {subject.schedule && <p className="course-schedule">Horario: {subject.schedule}</p>}
                    {subject.courseWork?.length > 0 && <span className="task-count">{subject.courseWork.length} actividades sincronizadas</span>}
                    {subjectExams.length > 0 && <span className="task-count">{subjectExams.length} evaluación{subjectExams.length === 1 ? '' : 'es'} disponible{subjectExams.length === 1 ? '' : 's'}</span>}
                  </div>
                  <div className="course-actions">
                    <button className={active ? 'primary-button' : 'secondary-button'} disabled={!active}
                      onClick={() => navigate(`/student/class?subject=${encodeURIComponent(subject.id)}`)}>
                      <BookOpenCheck size={17}/>{active ? 'Unirse a clase' : confirmed ? 'Sin clase activa' : presence.status === 'connecting' ? 'Consultando clase' : 'Clase no disponible'}
                    </button>
                    <button className="secondary-button" onClick={() => navigate(`/student/exam?subject=${subject.id}${subjectExams[0] ? `&exam=${subjectExams[0].id}` : ''}`)}><FileText size={17}/> Examen</button>
                    {subject.classroomUrl && <a className="secondary-button classroom-link" href={subject.classroomUrl} target="_blank" rel="noreferrer"><ExternalLink size={17}/> Classroom</a>}
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <div className="empty-state">No tienes materias asignadas todavía.</div>
        )}
      </section>

      <div className="two-column"><AttentionChart data={samples} /><IncidentList incidents={incidents} /></div>
    </Layout>
  )
}
