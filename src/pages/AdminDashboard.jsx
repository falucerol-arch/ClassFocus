import { useMemo, useState } from 'react'
import { BookOpen, Crown, GraduationCap, Link2, Pencil, Plus, Save, Trash2, UserRound, UsersRound } from 'lucide-react'
import Layout from '../components/Layout'
import ClassroomPanel from '../components/ClassroomPanel'
import MetricCard from '../components/MetricCard'
import { academicService } from '../services/academicService'

const EMPTY_SUBJECT = { name: '', code: '', section: '', schedule: '', defaultTeacherId: '' }

export default function AdminDashboard() {
  const [version, setVersion] = useState(0)
  const students = useMemo(() => academicService.getStudents(), [version])
  const teachers = useMemo(() => academicService.getTeachers(), [version])
  const subjects = useMemo(() => academicService.getSubjects(), [version])
  const assignments = useMemo(() => academicService.getAssignments(), [version])

  const [subjectForm, setSubjectForm] = useState(EMPTY_SUBJECT)
  const [editingSubjectId, setEditingSubjectId] = useState(null)
  const [subjectMessage, setSubjectMessage] = useState('')
  const [subjectError, setSubjectError] = useState('')

  const [studentId, setStudentId] = useState(students[0]?.id || '')
  const [teacherId, setTeacherId] = useState(teachers[0]?.id || '')
  const [subjectId, setSubjectId] = useState(subjects[0]?.id || '')
  const [assignmentMessage, setAssignmentMessage] = useState('')
  const [assignmentError, setAssignmentError] = useState('')

  const refresh = () => setVersion(v => v + 1)

  const saveSubject = event => {
    event.preventDefault()
    try {
      if (editingSubjectId) academicService.updateSubject(editingSubjectId, subjectForm)
      else academicService.createSubject(subjectForm)
      setSubjectMessage(editingSubjectId ? 'Materia actualizada correctamente.' : 'Materia creada correctamente.')
      setSubjectError('')
      setSubjectForm(EMPTY_SUBJECT)
      setEditingSubjectId(null)
      refresh()
    } catch (error) {
      setSubjectMessage('')
      setSubjectError(error.message)
    }
  }

  const editSubject = subject => {
    setEditingSubjectId(subject.id)
    setSubjectForm({
      name: subject.name || '',
      code: subject.code || '',
      section: subject.section || '',
      schedule: subject.schedule || '',
      defaultTeacherId: subject.defaultTeacherId || ''
    })
    setSubjectMessage('')
    setSubjectError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const deleteSubject = subject => {
    if (!window.confirm(`¿Eliminar la materia ${subject.name}?`)) return
    academicService.removeSubject(subject.id)
    setSubjectMessage('Materia eliminada.')
    if (subjectId === subject.id) setSubjectId('')
    refresh()
  }

  const saveAssignment = event => {
    event.preventDefault()
    try {
      academicService.assignSubject(studentId, teacherId, subjectId)
      setAssignmentMessage('Materia asignada correctamente al alumno.')
      setAssignmentError('')
      refresh()
    } catch (error) {
      setAssignmentMessage('')
      setAssignmentError(error.message)
    }
  }

  const removeStudentSubject = (student, subject) => {
    academicService.removeStudentSubject(student.id, subject.id)
    setAssignmentMessage(`${subject.name} fue retirada de ${student.name}.`)
    refresh()
  }

  return (
    <Layout title="Panel Super Admin" subtitle="Administra materias, docentes, alumnos e integraciones académicas desde un solo lugar.">
      <div className="metrics-grid admin-metrics">
        <MetricCard icon={UserRound} label="Alumnos" value={students.length} hint="Usuarios registrados" />
        <MetricCard icon={UsersRound} label="Maestros" value={teachers.length} hint="Docentes disponibles" />
        <MetricCard icon={BookOpen} label="Materias" value={subjects.length} hint="Cursos creados" />
        <MetricCard icon={Link2} label="Asignaciones" value={assignments.reduce((sum, row) => sum + row.subjectIds.length, 0)} hint="Alumno · materia · maestro" />
      </div>

      <section className="admin-section-block">
        <div className="section-heading-wide">
          <div><span className="eyebrow">GESTIÓN ACADÉMICA</span><h2>Crear y administrar materias</h2><p>Define el curso, código, sección, horario y docente base.</p></div>
          <BookOpen size={28} />
        </div>

        <div className="admin-grid subjects-admin-grid">
          <form className="form-card admin-form" onSubmit={saveSubject}>
            <div className="section-title">
              <div><h3>{editingSubjectId ? 'Editar materia' : 'Nueva materia'}</h3><span>{editingSubjectId ? 'Modifica los datos del curso' : 'Crea una clase para poder asignarla'}</span></div>
              {editingSubjectId ? <Pencil size={21} /> : <Plus size={21} />}
            </div>

            <div className="form-two-cols">
              <label className="field-label">Nombre de la materia
                <input value={subjectForm.name} onChange={e => setSubjectForm({ ...subjectForm, name: e.target.value })} placeholder="Ej. Programación III" />
              </label>
              <label className="field-label">Código
                <input value={subjectForm.code} onChange={e => setSubjectForm({ ...subjectForm, code: e.target.value })} placeholder="Ej. SIS-305" />
              </label>
              <label className="field-label">Sección
                <input value={subjectForm.section} onChange={e => setSubjectForm({ ...subjectForm, section: e.target.value })} placeholder="Ej. A" />
              </label>
              <label className="field-label">Horario
                <input value={subjectForm.schedule} onChange={e => setSubjectForm({ ...subjectForm, schedule: e.target.value })} placeholder="Ej. Lun 18:00–20:00" />
              </label>
            </div>

            <label className="field-label">Docente base
              <select value={subjectForm.defaultTeacherId} onChange={e => setSubjectForm({ ...subjectForm, defaultTeacherId: e.target.value })}>
                <option value="">Sin docente por defecto</option>
                {teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
              </select>
            </label>

            {subjectMessage && <div className="alert success">{subjectMessage}</div>}
            {subjectError && <div className="alert error">{subjectError}</div>}
            <div className="form-actions-row">
              <button className="primary-button" type="submit"><Save size={18} /> {editingSubjectId ? 'Guardar cambios' : 'Crear materia'}</button>
              {editingSubjectId && <button className="secondary-button" type="button" onClick={() => { setEditingSubjectId(null); setSubjectForm(EMPTY_SUBJECT) }}>Cancelar</button>}
            </div>
          </form>

          <section className="table-card">
            <div className="section-title"><h3>Materias disponibles</h3><span>{subjects.length} creadas</span></div>
            <div className="subject-admin-list">
              {subjects.map(subject => {
                const teacher = academicService.getUserById(subject.defaultTeacherId)
                return (
                  <article key={subject.id} className="subject-admin-row">
                    <div className="subject-code-badge">{subject.code}</div>
                    <div>
                      <strong>{subject.name}</strong>
                      <small>{subject.section ? `Sección ${subject.section}` : 'Sin sección'} · {subject.schedule || 'Horario pendiente'}</small>
                      <span>{teacher?.name || 'Sin docente base'}{subject.source === 'google-classroom' ? ' · Google Classroom' : ''}</span>
                    </div>
                    <div className="row-actions">
                      <button className="icon-button" type="button" title="Editar" onClick={() => editSubject(subject)}><Pencil size={17} /></button>
                      <button className="icon-button danger-icon" type="button" title="Eliminar" onClick={() => deleteSubject(subject)}><Trash2 size={17} /></button>
                    </div>
                  </article>
                )
              })}
              {!subjects.length && <div className="empty-state">Todavía no hay materias creadas.</div>}
            </div>
          </section>
        </div>
      </section>

      <ClassroomPanel onImported={refresh} />

      <section className="admin-section-block">
        <div className="section-heading-wide">
          <div><span className="eyebrow">MATRÍCULA</span><h2>Asignar alumnos a materias y maestros</h2><p>Cada materia puede tener un docente distinto para el mismo alumno.</p></div>
          <Crown size={28} />
        </div>

        <div className="admin-grid">
          <form className="form-card admin-form" onSubmit={saveAssignment}>
            <div className="section-title"><div><h3>Nueva asignación</h3><span>Alumno → materia → maestro</span></div><GraduationCap size={22} /></div>

            <label className="field-label">Alumno
              <select value={studentId} onChange={e => setStudentId(Number(e.target.value))}>
                {students.map(student => <option key={student.id} value={student.id}>{student.name} · {student.email}</option>)}
              </select>
            </label>
            <label className="field-label">Materia
              <select value={subjectId} onChange={e => setSubjectId(e.target.value)}>
                <option value="">Selecciona una materia</option>
                {subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.code} · {subject.name}</option>)}
              </select>
            </label>
            <label className="field-label">Maestro
              <select value={teacherId} onChange={e => setTeacherId(Number(e.target.value))}>
                {teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}
              </select>
            </label>

            {assignmentMessage && <div className="alert success">{assignmentMessage}</div>}
            {assignmentError && <div className="alert error">{assignmentError}</div>}
            <button className="primary-button" type="submit"><Save size={18} /> Asignar materia</button>
          </form>

          <section className="table-card assignments-card">
            <div className="section-title"><h3>Alumnos y materias</h3><span>{students.length} alumnos</span></div>
            <div className="assignment-list">
              {students.map(student => {
                const assignment = academicService.getStudentAssignment(student.id)
                return (
                  <article key={student.id} className="assignment-row expanded-assignment">
                    <div className="avatar small"><GraduationCap size={20} /></div>
                    <div className="assignment-info">
                      <strong>{student.name}</strong>
                      <small>{student.email}</small>
                      {assignment ? (
                        <div className="student-subject-assignment-list">
                          {assignment.subjects.map(subject => (
                            <div key={subject.id} className="student-subject-assignment">
                              <span><b>{subject.name}</b><small>{assignment.subjectTeachers?.[subject.id]?.name || 'Sin maestro'}</small></span>
                              <button type="button" className="icon-button danger-icon tiny" title="Quitar materia" onClick={() => removeStudentSubject(student, subject)}><Trash2 size={14} /></button>
                            </div>
                          ))}
                        </div>
                      ) : <span className="unassigned">Sin materias asignadas</span>}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        </div>
      </section>
    </Layout>
  )
}
