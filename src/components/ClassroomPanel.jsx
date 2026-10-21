import { useEffect, useState } from 'react'
import { BookOpen, CheckCircle2, ExternalLink, GraduationCap, Link2, Loader2, RefreshCw, Unplug } from 'lucide-react'
import { classroomService } from '../services/classroomService'
import { databaseService } from '../services/databaseService'
import { academicService } from '../services/academicService'
import { authService } from '../services/authService'

export default function ClassroomPanel({ onImported }) {
  const user = authService.getCurrentUser()
  const [status, setStatus] = useState(null)
  const [connectionId, setConnectionId] = useState('')
  const [courses, setCourses] = useState([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    classroomService.status().then(value => {
      if (!active) return
      setStatus(value)
      setConnectionId(String(value.connections[0]?.id || ''))
    }).catch(error => { if (active) setError(error.message) })
    // El callback solo devuelve el resultado; nunca transporta tokens en la dirección del navegador.
    const url = new URL(window.location.href)
    const result = url.searchParams.get('classroom')
    if (result === 'connected') setMessage('Cuenta de Google conectada. Selecciona la cuenta y consulta sus cursos.')
    if (result === 'denied') setError('No autorizaste la conexión. Puedes volver a intentarlo.')
    if (result === 'failed') setError(url.searchParams.get('reason') === 'account'
      ? 'La cuenta ya está vinculada a otro usuario o Google no concedió acceso renovable. Revisa la conexión y vuelve a autorizar.'
      : 'No se pudo completar la autorización de Google. Revisa la configuración y vuelve a conectar.')
    if (result) {
      url.searchParams.delete('classroom')
      url.searchParams.delete('reason')
      window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    }
    return () => { active = false }
  }, [])

  const run = async action => {
    setBusy(true)
    setError('')
    setMessage('')
    try { await action() } catch (error) { setError(error.message) } finally { setBusy(false) }
  }

  const loadCourses = () => run(async () => {
    setCourses([])
    const result = await classroomService.listCourses(connectionId)
    setCourses(result.courses)
    setMessage(result.courses.length ? `${result.courses.length} cursos activos encontrados.` : 'Esta cuenta no tiene cursos activos visibles para ClassFocus.')
  })

  const importCourse = course => run(async () => {
    const { summary } = await classroomService.importCourse(connectionId, course.id)
    // La importación ya fue confirmada en PostgreSQL. Si falla la recarga, lo indicamos con precisión.
    try {
      await databaseService.refresh()
      onImported?.()
      setMessage(`${summary.subjectName}: ${summary.studentsImported} alumnos sincronizados; ${summary.studentsCreated} nuevos y ${summary.enrollmentsRemoved} matrículas retiradas.`)
    } catch {
      setMessage(`${summary.subjectName} se guardó en PostgreSQL con ${summary.studentsImported} alumnos.`)
      setError('No se pudo actualizar el panel. Recarga la página para consultar los datos guardados.')
    }
  })

  const disconnect = () => run(async () => {
    await classroomService.disconnect(connectionId)
    const current = await classroomService.status()
    setStatus(current)
    setConnectionId(String(current.connections[0]?.id || ''))
    setCourses([])
    setMessage('Cuenta desvinculada. Los datos que ya importaste se conservan.')
  })

  return (
    <section className="classroom-card" aria-busy={busy}>
      <div className="classroom-header">
        <div className="classroom-heading">
          <div className="google-classroom-mark"><GraduationCap size={22}/></div>
          <div><h2>Google Classroom</h2><p>Conecta tus cuentas y elige los cursos que deseas consultar o sincronizar.</p></div>
        </div>
        <span className={`connection-pill ${status?.configured ? 'ready' : 'demo'}`}>
          {status ? (status.configured ? 'Configurado' : 'Falta configurar Google') : 'Consultando conexión…'}
        </span>
      </div>
      <div className="classroom-actions">
        <button className="primary-button" type="button" disabled={busy || !status?.configured} onClick={() => run(() => classroomService.connect())}>
          <Link2 size={18}/> {status?.connections.length ? 'Conectar otra cuenta' : 'Conectar Google Classroom'}
        </button>
        {!!status?.connections.length && <>
          <label className="field-label">Cuenta de Google
            <select value={connectionId} disabled={busy} onChange={event => { setConnectionId(event.target.value); setCourses([]); setMessage(''); setError('') }}>
              {status.connections.map(account => <option key={account.id} value={account.id}>{account.email}</option>)}
            </select>
          </label>
          <button className="secondary-button" type="button" disabled={busy || !connectionId} onClick={loadCourses}><RefreshCw size={17}/> Consultar cursos</button>
          <button className="secondary-button" type="button" disabled={busy || !connectionId} onClick={disconnect}><Unplug size={17}/> Desvincular cuenta</button>
        </>}
        {busy && <span role="status"><Loader2 className="spin" size={18}/> Procesando…</span>}
      </div>
      {status && !status.configured && <div className="classroom-config-note">La conexión aún no está habilitada. Solicita su configuración al administrador.</div>}
      <div className="classroom-config-note">
        {user?.role === 'student'
          ? 'Con tu cuenta de estudiante puedes comprobar la conexión y consultar tus cursos. La importación de alumnos corresponde al maestro.'
          : user?.role === 'admin'
            ? 'La conexión muestra los cursos accesibles a tu cuenta de Google. Para importar, ingresa al panel del maestro.'
            : 'Solo puedes importar cursos donde Google te reconoce como docente. Sincronizar actualiza la matrícula de ese curso sin modificar tus otros cursos.'}
      </div>
      {message && <div className="alert success" role="status"><CheckCircle2 size={17}/>{message}</div>}
      {error && <div className="alert error" role="alert">{error}</div>}
      <div className="classroom-course-grid">
        {courses.map(course => {
          const imported = academicService.getSubjects().find(subject => subject.classroomId === course.id)
          const canImport = user?.role === 'teacher' && course.googleRole === 'teacher'
          return <article className="classroom-course" key={course.id}>
            <div className="course-topline"><span>{course.googleRole === 'teacher' ? 'DOCENTE' : 'ESTUDIANTE'}</span><small>{course.section || 'Sin sección'}</small></div>
            <h3>{course.name}</h3>
            <p>{course.descriptionHeading || 'Curso de Google Classroom'}</p>
            {imported?.classroomSyncedAt && <small>Última sincronización: {new Date(imported.classroomSyncedAt).toLocaleString('es-GT')}</small>}
            <div className="course-footer">
              {canImport ? <button className="secondary-button compact-btn" type="button" disabled={busy} onClick={() => importCourse(course)}>
                <BookOpen size={16}/> {imported ? 'Sincronizar alumnos' : 'Importar curso y alumnos'}
              </button> : <small>Disponible para consulta</small>}
              {course.alternateLink && <a className="icon-link" href={course.alternateLink} target="_blank" rel="noreferrer" aria-label={`Abrir ${course.name} en Classroom`}><ExternalLink size={17}/></a>}
            </div>
          </article>
        })}
      </div>
    </section>
  )
}
