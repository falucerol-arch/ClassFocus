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

export default function StudentDashboard() {
  const navigate = useNavigate()
  const user = authService.getCurrentUser()
  const assignment = academicService.getStudentAssignment(user.id)
  const metrics = storageService.getMetrics(user.id)
  const samples = storageService.getSamples(user.id)
  const incidents = storageService.getIncidents(user.id)
  const exams = examService.getPublishedForSubjects(assignment?.subjectIds || [])

  return (
    <Layout title="Panel del alumno" subtitle="Consulta tus materias, evaluaciones y entra a las sesiones supervisadas.">
      <ClassroomPanel />

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
              return (
                <article className="subject-course-card" key={subject.id}>
                  <div>
                    <small>{subject.code}{subject.source === 'google-classroom' ? ' · Classroom' : ''}</small>
                    <h3>{subject.name}</h3>
                    <p>Docente: {assignment.subjectTeachers?.[subject.id]?.name || 'Pendiente'}</p>
                    {subject.schedule && <p className="course-schedule">Horario: {subject.schedule}</p>}
                    {subject.courseWork?.length > 0 && <span className="task-count">{subject.courseWork.length} actividades sincronizadas</span>}
                    {subjectExams.length > 0 && <span className="task-count">{subjectExams.length} evaluación{subjectExams.length === 1 ? '' : 'es'} disponible{subjectExams.length === 1 ? '' : 's'}</span>}
                  </div>
                  <div className="course-actions">
                    <button className="secondary-button" onClick={() => navigate(`/student/class?subject=${subject.id}`)}><BookOpenCheck size={17}/> Clase</button>
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
