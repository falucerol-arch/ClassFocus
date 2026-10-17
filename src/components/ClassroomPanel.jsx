import { useMemo, useState } from 'react'
import { BookOpen, CheckCircle2, CloudDownload, ExternalLink, GraduationCap, Link2, Loader2, RefreshCw, UsersRound, Wifi, WifiOff } from 'lucide-react'
import { classroomService } from '../services/classroomService'
import { academicService } from '../services/academicService'

function dueLabel(dueDate) {
  if (!dueDate?.year) return 'Sin fecha límite'
  return new Date(dueDate.year, (dueDate.month || 1) - 1, dueDate.day || 1).toLocaleDateString('es-GT', { day: '2-digit', month: 'short' })
}

export default function ClassroomPanel({ onImported }) {
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [source, setSource] = useState('')
  const configured = classroomService.isConfigured()
  const totals = useMemo(() => ({
    students: courses.reduce((sum, course) => sum + (course.students?.length || 0), 0),
    tasks: courses.reduce((sum, course) => sum + (course.courseWork?.length || 0), 0)
  }), [courses])

  const load = async demo => {
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const result = await classroomService.listCourses({ demo })
      setCourses(result)
      setSource(demo ? 'demo' : 'google')
      setMessage(demo ? 'Datos demo de Classroom cargados.' : `Google Classroom conectado: ${result.length} cursos activos encontrados.`)
    } catch (e) {
      setError(e.message || 'No fue posible conectar con Google Classroom.')
    } finally {
      setLoading(false)
    }
  }

  const importCourse = course => {
    try {
      const summary = academicService.importClassroomCourse(course)
      setMessage(`Importado: ${summary.subjectName}. ${summary.studentsImported} alumnos vinculados a ${summary.teacherName}.`)
      setError('')
      onImported?.()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <section className="classroom-card">
      <div className="classroom-header">
        <div className="classroom-heading">
          <div className="google-classroom-mark"><GraduationCap size={22}/></div>
          <div><h2>Google Classroom</h2><p>Sincroniza cursos, docentes, alumnos y actividades.</p></div>
        </div>
        <span className={`connection-pill ${configured ? 'ready' : 'demo'}`}>
          {configured ? <Wifi size={15}/> : <WifiOff size={15}/>} {configured ? 'OAuth listo' : 'Modo demo'}
        </span>
      </div>

      <div className="classroom-actions">
        <button className="primary-button" type="button" onClick={() => load(false)} disabled={loading || !configured}>
          {loading ? <Loader2 className="spin" size={18}/> : <Link2 size={18}/>} Conectar Google Classroom
        </button>
        <button className="secondary-button" type="button" onClick={() => load(true)} disabled={loading}>
          <CloudDownload size={18}/> Cargar demo de Classroom
        </button>
        {courses.length > 0 && <button className="icon-button" type="button" onClick={() => load(source === 'demo')} title="Actualizar"><RefreshCw size={17}/></button>}
      </div>

      {!configured && (
        <div className="classroom-config-note">
          <strong>Para conexión real:</strong> crea <code>.env</code>, agrega <code>VITE_GOOGLE_CLIENT_ID</code> y registra <code>http://localhost:5173</code> como origen autorizado en Google Cloud.
        </div>
      )}

      {message && <div className="alert success"><CheckCircle2 size={17}/>{message}</div>}
      {error && <div className="alert error">{error}</div>}

      {courses.length > 0 && (
        <>
          <div className="classroom-summary">
            <div><BookOpen size={18}/><span><strong>{courses.length}</strong> cursos</span></div>
            <div><UsersRound size={18}/><span><strong>{totals.students}</strong> matrículas</span></div>
            <div><GraduationCap size={18}/><span><strong>{totals.tasks}</strong> actividades</span></div>
          </div>
          <div className="classroom-course-grid">
            {courses.map(course => (
              <article className="classroom-course" key={course.id}>
                <div className="course-topline"><span>CLASSROOM</span><small>{course.section || 'Curso activo'}</small></div>
                <h3>{course.name}</h3>
                <p>{course.teachers?.[0]?.profile?.name?.fullName || 'Docente no disponible'}</p>
                <div className="course-stats">
                  <span><UsersRound size={15}/>{course.students?.length || 0} alumnos</span>
                  <span><BookOpen size={15}/>{course.courseWork?.length || 0} actividades</span>
                </div>
                {!!course.courseWork?.length && (
                  <div className="coursework-preview">
                    {course.courseWork.slice(0, 2).map(item => <div key={item.id}><span>{item.title}</span><small>{dueLabel(item.dueDate)}</small></div>)}
                  </div>
                )}
                <div className="course-footer">
                  <button className="secondary-button compact-btn" type="button" onClick={() => importCourse(course)}><CloudDownload size={16}/> Importar a ClassFocus</button>
                  {course.alternateLink && <a className="icon-link" href={course.alternateLink} target="_blank" rel="noreferrer" title="Abrir Classroom"><ExternalLink size={17}/></a>}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
