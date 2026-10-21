import { apiClient } from './apiClient'

const EXAM_KEY = 'classfocus_exams_v1'

const seed = [
  {
    id: 'exam-demo-prog1',
    teacherId: 2,
    subjectId: 'prog1',
    title: 'Parcial 1 · Programación I',
    instructions: 'Responde todas las preguntas. Mantén la cámara activa durante toda la evaluación.',
    durationMinutes: 35,
    formUrl: '',
    status: 'published',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
]

const clone = value => JSON.parse(JSON.stringify(value))

class ExamService {
  getAll() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(EXAM_KEY))
      if (Array.isArray(saved)) return saved
    } catch {
      // Se reconstruyen los datos demo si el almacenamiento está dañado.
    }
    sessionStorage.setItem(EXAM_KEY, JSON.stringify(seed))
    return clone(seed)
  }

  save(exams, syncRemote = true) {
    sessionStorage.setItem(EXAM_KEY, JSON.stringify(exams))
    window.dispatchEvent(new Event('classfocus-exams-updated'))
    if (syncRemote) apiClient.syncExams(exams).catch(() => {})
  }

  hydrate(exams) {
    if (!Array.isArray(exams)) return
    this.save(exams, false)
  }

  getById(id) {
    return this.getAll().find(exam => exam.id === id) || null
  }

  getForTeacher(teacherId) {
    return this.getAll().filter(exam => Number(exam.teacherId) === Number(teacherId))
  }

  getPublishedForSubjects(subjectIds = []) {
    const allowed = new Set(subjectIds)
    return this.getAll().filter(exam => exam.status === 'published' && allowed.has(exam.subjectId))
  }

  create(payload) {
    if (!payload.title?.trim()) throw new Error('Escribe el nombre de la evaluación.')
    if (!payload.subjectId) throw new Error('Selecciona una materia.')
    const minutes = Number(payload.durationMinutes)
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 480) throw new Error('La duración debe estar entre 1 y 480 minutos.')

    const now = new Date().toISOString()
    const exam = {
      id: `exam-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      teacherId: Number(payload.teacherId),
      subjectId: payload.subjectId,
      title: payload.title.trim(),
      instructions: payload.instructions?.trim() || '',
      durationMinutes: minutes,
      formUrl: payload.formUrl?.trim() || '',
      status: payload.status === 'draft' ? 'draft' : 'published',
      createdAt: now,
      updatedAt: now
    }
    const exams = this.getAll()
    exams.unshift(exam)
    this.save(exams)
    return exam
  }

  update(id, payload) {
    const exams = this.getAll()
    const index = exams.findIndex(exam => exam.id === id)
    if (index < 0) throw new Error('Evaluación no encontrada.')
    const minutes = Number(payload.durationMinutes)
    if (!payload.title?.trim()) throw new Error('Escribe el nombre de la evaluación.')
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 480) throw new Error('La duración debe estar entre 1 y 480 minutos.')

    exams[index] = {
      ...exams[index],
      ...payload,
      title: payload.title.trim(),
      instructions: payload.instructions?.trim() || '',
      formUrl: payload.formUrl?.trim() || '',
      durationMinutes: minutes,
      teacherId: Number(exams[index].teacherId),
      updatedAt: new Date().toISOString()
    }
    this.save(exams)
    return exams[index]
  }

  remove(id) {
    this.save(this.getAll().filter(exam => exam.id !== id))
  }

  toggleStatus(id) {
    const exam = this.getById(id)
    if (!exam) return null
    return this.update(id, { ...exam, status: exam.status === 'published' ? 'draft' : 'published' })
  }
}

export const examService = new ExamService()
