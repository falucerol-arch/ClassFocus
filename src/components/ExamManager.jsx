import { useMemo, useState } from 'react'
import { Clock3, FilePenLine, FilePlus2, Link2, Pencil, Send, Trash2 } from 'lucide-react'
import { examService } from '../services/examService'

const emptyForm = { title: '', subjectId: '', instructions: '', durationMinutes: 30, formUrl: '', status: 'published' }

export default function ExamManager({ teacher, subjects }) {
  const [version, setVersion] = useState(0)
  const exams = useMemo(() => examService.getForTeacher(teacher.id), [teacher.id, version])
  const [form, setForm] = useState({ ...emptyForm, subjectId: subjects[0]?.id || '' })
  const [editingId, setEditingId] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const refresh = () => setVersion(v => v + 1)

  const save = event => {
    event.preventDefault()
    try {
      if (editingId) examService.update(editingId, { ...form, teacherId: teacher.id })
      else examService.create({ ...form, teacherId: teacher.id })
      setMessage(editingId ? 'Evaluación actualizada.' : 'Evaluación creada y lista para tus alumnos.')
      setError('')
      setEditingId(null)
      setForm({ ...emptyForm, subjectId: subjects[0]?.id || '' })
      refresh()
    } catch (e) {
      setMessage('')
      setError(e.message)
    }
  }

  const edit = exam => {
    setEditingId(exam.id)
    setForm({
      title: exam.title,
      subjectId: exam.subjectId,
      instructions: exam.instructions || '',
      durationMinutes: exam.durationMinutes,
      formUrl: exam.formUrl || '',
      status: exam.status
    })
    setMessage('')
    setError('')
  }

  const remove = exam => {
    if (!window.confirm(`¿Eliminar ${exam.title}?`)) return
    examService.remove(exam.id)
    if (editingId === exam.id) {
      setEditingId(null)
      setForm({ ...emptyForm, subjectId: subjects[0]?.id || '' })
    }
    refresh()
  }

  const toggle = exam => {
    examService.toggleStatus(exam.id)
    refresh()
  }

  return (
    <section className="exam-manager-card">
      <div className="section-heading-wide">
        <div><span className="eyebrow">EVALUACIONES</span><h2>Crear y administrar exámenes</h2><p>Define la materia, duración, instrucciones y un enlace opcional de Google/Microsoft Forms.</p></div>
        <FilePenLine size={28} />
      </div>

      <div className="exam-manager-grid">
        <form className="form-card teacher-exam-form" onSubmit={save}>
          <div className="section-title">
            <div><h3>{editingId ? 'Editar evaluación' : 'Nueva evaluación'}</h3><span>{editingId ? 'Actualiza los datos y el tiempo' : 'Configura un nuevo examen'}</span></div>
            {editingId ? <Pencil size={21} /> : <FilePlus2 size={21} />}
          </div>

          <label className="field-label">Título
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Ej. Parcial 2 · Base de Datos" />
          </label>
          <div className="form-two-cols">
            <label className="field-label">Materia
              <select value={form.subjectId} onChange={e => setForm({ ...form, subjectId: e.target.value })}>
                <option value="">Selecciona una materia</option>
                {subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.code} · {subject.name}</option>)}
              </select>
            </label>
            <label className="field-label">Duración (minutos)
              <input type="number" min="1" max="480" value={form.durationMinutes} onChange={e => setForm({ ...form, durationMinutes: e.target.value })} />
            </label>
          </div>
          <label className="field-label">Instrucciones
            <textarea rows="4" value={form.instructions} onChange={e => setForm({ ...form, instructions: e.target.value })} placeholder="Indicaciones para el estudiante…" />
          </label>
          <label className="field-label">Enlace de Google/Microsoft Forms (opcional)
            <div className="input-with-icon"><Link2 size={17} /><input value={form.formUrl} onChange={e => setForm({ ...form, formUrl: e.target.value })} placeholder="https://docs.google.com/forms/..." /></div>
          </label>
          <label className="field-label">Estado
            <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
              <option value="published">Publicado · visible para alumnos</option>
              <option value="draft">Borrador · solo maestro</option>
            </select>
          </label>

          {message && <div className="alert success">{message}</div>}
          {error && <div className="alert error">{error}</div>}
          <div className="form-actions-row">
            <button className="primary-button" type="submit"><Send size={17} /> {editingId ? 'Guardar cambios' : 'Crear evaluación'}</button>
            {editingId && <button type="button" className="secondary-button" onClick={() => { setEditingId(null); setForm({ ...emptyForm, subjectId: subjects[0]?.id || '' }) }}>Cancelar</button>}
          </div>
        </form>

        <div className="exam-list-card">
          <div className="section-title"><h3>Mis evaluaciones</h3><span>{exams.length} creadas</span></div>
          <div className="teacher-exam-list">
            {exams.map(exam => {
              const subject = subjects.find(item => item.id === exam.subjectId)
              return (
                <article key={exam.id} className="teacher-exam-row">
                  <div className={`exam-status-icon ${exam.status}`}><Clock3 size={20} /></div>
                  <div className="teacher-exam-info">
                    <strong>{exam.title}</strong>
                    <span>{subject?.name || 'Materia no disponible'} · {exam.durationMinutes} min</span>
                    <small>{exam.status === 'published' ? 'Publicado para alumnos' : 'Borrador'}</small>
                  </div>
                  <div className="row-actions">
                    <button className="secondary-button compact-btn" type="button" onClick={() => toggle(exam)}>{exam.status === 'published' ? 'Ocultar' : 'Publicar'}</button>
                    <button className="icon-button" type="button" title="Editar" onClick={() => edit(exam)}><Pencil size={16} /></button>
                    <button className="icon-button danger-icon" type="button" title="Eliminar" onClick={() => remove(exam)}><Trash2 size={16} /></button>
                  </div>
                </article>
              )
            })}
            {!exams.length && <div className="empty-state">Todavía no has creado evaluaciones.</div>}
          </div>
        </div>
      </div>
    </section>
  )
}
