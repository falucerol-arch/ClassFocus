import { useMemo, useState } from 'react'
import { BrainCircuit, Download, ExternalLink, EyeOff, Maximize2, Monitor, ScanFace, UserRound, UsersRound } from 'lucide-react'
import Layout from '../components/Layout'
import MetricCard from '../components/MetricCard'
import AttentionChart from '../components/AttentionChart'
import IncidentList from '../components/IncidentList'
import LiveStudentMonitor from '../components/LiveStudentMonitor'
import ExamManager from '../components/ExamManager'
import ClassroomPanel from '../components/ClassroomPanel'
import { storageService } from '../services/storageService'
import { academicService } from '../services/academicService'
import { authService } from '../services/authService'

export default function TeacherDashboard() {
  const user = authService.getCurrentUser()
  const [version, setVersion] = useState(0)
  const assignedStudents = useMemo(() => academicService.getStudentsForTeacher(user.id), [user.id, version])
  const teacherSubjects = useMemo(() => academicService.getSubjectsForTeacher(user.id), [user.id, version])
  const [studentId, setStudentId] = useState(assignedStudents[0]?.student.id || '')
  const [subjectId, setSubjectId] = useState('all')

  const selected = assignedStudents.find(item => item.student.id === Number(studentId)) || assignedStudents[0]
  const activeStudentId = selected?.student.id
  const selectedSubject = subjectId !== 'all' ? academicService.getSubjectById(subjectId) : null
  const metrics = activeStudentId ? storageService.getMetrics(activeStudentId, subjectId) : null
  const samples = activeStudentId ? storageService.getSamples(activeStudentId, subjectId) : []
  const incidents = activeStudentId ? storageService.getIncidents(activeStudentId, subjectId) : []

  const changeStudent = value => {
    setStudentId(Number(value))
    setSubjectId('all')
  }

  const exportCsv = () => {
    if (!selected) return
    const header = 'alumno,materia,tipo,mensaje,severidad,fecha\n'
    const rows = incidents.map(i => {
      const subject = academicService.getSubjectById(i.subjectId)?.name || 'General'
      return `"${selected.student.name}","${subject}",${i.type},"${i.message}",${i.severity},${i.timestamp}`
    }).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `classfocus-${selected.student.name.toLowerCase().replaceAll(' ', '-')}-incidencias.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Layout title="Panel del maestro" subtitle="Supervisa clases en vivo, crea evaluaciones y revisa las métricas de tus alumnos.">
      <ClassroomPanel onImported={() => setVersion(value => value + 1)} />

      <LiveStudentMonitor teacherId={user.id} subjects={teacherSubjects} />

      <ExamManager teacher={user} subjects={teacherSubjects} />

      {!selected ? (
        <div className="empty-panel"><UsersRound size={42}/><h2>No tienes alumnos asignados</h2><p>El Super Admin debe asignarte alumnos y materias para poder consultar métricas individuales.</p></div>
      ) : (
        <>
          <section className="analytics-section">
            <div className="section-heading-wide">
              <div><span className="eyebrow">ANALÍTICA</span><h2>Métricas por alumno</h2><p>Filtra por estudiante y materia para revisar su comportamiento registrado.</p></div>
              <BrainCircuit size={28} />
            </div>

            <div className="teacher-controls">
              <label className="field-label">Alumno
                <select value={selected.student.id} onChange={e => changeStudent(e.target.value)}>
                  {assignedStudents.map(item => <option key={item.student.id} value={item.student.id}>{item.student.name}</option>)}
                </select>
              </label>
              <label className="field-label">Materia
                <select value={subjectId} onChange={e => setSubjectId(e.target.value)}>
                  <option value="all">Todas las materias</option>
                  {selected.subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
                </select>
              </label>
            </div>

            <div className="student-summary">
              <div className="avatar"><UserRound size={28}/></div>
              <div>
                <strong>{selected.student.name}</strong>
                <span>{selected.student.email} · Maestro: {user.name}</span>
                <div className="subject-pills compact-pills">{selected.subjects.map(subject => <span key={subject.id}>{subject.name}</span>)}</div>
              </div>
              <span className="status-dot">Asignado</span>
            </div>

            <div className="metrics-grid">
              <MetricCard icon={BrainCircuit} label="Atención promedio" value={`${metrics.attentionAverage}%`} hint={subjectId === 'all' ? 'Todas las materias' : 'Materia seleccionada'} />
              <MetricCard icon={EyeOff} label="Mirada desviada" value={metrics.gazeAlerts} hint="Incidencias" />
              <MetricCard icon={Monitor} label="Cambios de pestaña" value={metrics.tabChanges} hint="En examen" />
              <MetricCard icon={ScanFace} label="Ausencia de rostro" value={metrics.faceAbsences} hint="Detecciones" />
              <MetricCard icon={Maximize2} label="Salidas de fullscreen" value={metrics.fullscreenExits} hint="En examen" />
            </div>

            {selectedSubject?.source === 'google-classroom' && (
              <section className="teacher-classroom-strip">
                <div><span className="eyebrow">GOOGLE CLASSROOM</span><strong>{selectedSubject.courseWork?.length || 0} actividades sincronizadas</strong><small>Materia vinculada automáticamente desde Classroom.</small></div>
                {selectedSubject.classroomUrl && <a className="secondary-button" href={selectedSubject.classroomUrl} target="_blank" rel="noreferrer"><ExternalLink size={17}/> Abrir Classroom</a>}
              </section>
            )}
            <div className="dashboard-actions"><button className="secondary-button" onClick={exportCsv}><Download size={17}/> Exportar incidencias CSV</button></div>
            <div className="two-column"><AttentionChart data={samples} /><IncidentList incidents={incidents} /></div>
          </section>
        </>
      )}
    </Layout>
  )
}
