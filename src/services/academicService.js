import { DEFAULT_ASSIGNMENTS, SUBJECTS, USERS } from '../data/mockData'
import { apiClient } from './apiClient'

const ACADEMIC_KEY = 'classfocus_academic_data_v3'
const clone = value => JSON.parse(JSON.stringify(value))

class AcademicService {
  getState() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(ACADEMIC_KEY))
      if (saved?.users && saved?.subjects && saved?.assignments) return saved
    } catch {
      // Si el almacenamiento se dañó, se reconstruye con datos demo.
    }

    const initial = { users: clone(USERS), subjects: clone(SUBJECTS), assignments: clone(DEFAULT_ASSIGNMENTS) }
    sessionStorage.setItem(ACADEMIC_KEY, JSON.stringify(initial))
    return initial
  }

  saveState(state, syncRemote = true) {
    sessionStorage.setItem(ACADEMIC_KEY, JSON.stringify(state))
    window.dispatchEvent(new Event('classfocus-academic-updated'))
    if (syncRemote) apiClient.syncAcademic(state).catch(() => {})
  }

  hydrate(state) {
    if (!state?.users || !state?.subjects || !state?.assignments) return
    // La API no entrega contraseñas. No se inventan claves demo para alumnos importados.
    const next = {
      users: clone(state.users),
      subjects: clone(state.subjects),
      assignments: clone(state.assignments)
    }
    this.saveState(next, false)
  }

  getUsers() { return this.getState().users }
  getUserById(id) { return this.getUsers().find(user => user.id === Number(id)) || null }
  getStudents() { return this.getUsers().filter(user => user.role === 'student') }
  getTeachers() { return this.getUsers().filter(user => user.role === 'teacher') }
  getSubjects() { return this.getState().subjects }
  getSubjectById(id) { return this.getSubjects().find(subject => subject.id === id) || null }
  getAssignments() { return this.getState().assignments }

  getStudentAssignments(studentId) {
    return this.getAssignments()
      .filter(item => item.studentId === Number(studentId))
      .map(item => ({
        ...item,
        teacher: this.getUserById(item.teacherId),
        subjects: this.getSubjects().filter(subject => item.subjectIds.includes(subject.id))
      }))
  }

  getStudentAssignment(studentId) {
    const rows = this.getStudentAssignments(studentId)
    if (!rows.length) return null
    const subjects = []
    const seen = new Set()
    const subjectTeachers = {}

    rows.forEach(row => row.subjects.forEach(subject => {
      if (!seen.has(subject.id)) {
        seen.add(subject.id)
        subjects.push(subject)
      }
      subjectTeachers[subject.id] = row.teacher
    }))

    return {
      studentId: Number(studentId),
      teacherId: rows[0].teacherId,
      teacher: rows[0].teacher,
      teachers: [...new Map(rows.filter(row => row.teacher).map(row => [row.teacher.id, row.teacher])).values()],
      subjects,
      subjectIds: subjects.map(subject => subject.id),
      subjectTeachers
    }
  }

  getTeacherForStudentSubject(studentId, subjectId) {
    return this.getStudentAssignment(studentId)?.subjectTeachers?.[subjectId] || null
  }

  getStudentsForTeacher(teacherId) {
    const teacherAssignments = this.getAssignments().filter(item => item.teacherId === Number(teacherId))
    const grouped = new Map()

    teacherAssignments.forEach(assignment => {
      const existing = grouped.get(assignment.studentId) || { studentId: assignment.studentId, subjectIds: [] }
      existing.subjectIds = [...new Set([...existing.subjectIds, ...assignment.subjectIds])]
      grouped.set(assignment.studentId, existing)
    })

    return [...grouped.values()].map(assignment => ({
      student: this.getUserById(assignment.studentId),
      teacher: this.getUserById(teacherId),
      subjectIds: assignment.subjectIds,
      subjects: this.getSubjects().filter(subject => assignment.subjectIds.includes(subject.id))
    })).filter(item => item.student)
  }

  getSubjectsForTeacher(teacherId) {
    const ids = new Set()
    this.getAssignments().forEach(item => {
      if (Number(item.teacherId) === Number(teacherId)) item.subjectIds.forEach(id => ids.add(id))
    })
    this.getSubjects().forEach(subject => {
      if (Number(subject.defaultTeacherId) === Number(teacherId)) ids.add(subject.id)
    })
    return this.getSubjects().filter(subject => ids.has(subject.id))
  }

  createSubject(payload) {
    const name = payload.name?.trim()
    const code = payload.code?.trim().toUpperCase()
    if (!name) throw new Error('Escribe el nombre de la materia.')
    if (!code) throw new Error('Escribe el código de la materia.')

    const state = this.getState()
    if (state.subjects.some(subject => subject.code?.toLowerCase() === code.toLowerCase())) {
      throw new Error('Ya existe una materia con ese código.')
    }

    const subject = {
      id: `sub-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      name,
      code,
      section: payload.section?.trim() || '',
      schedule: payload.schedule?.trim() || '',
      defaultTeacherId: payload.defaultTeacherId ? Number(payload.defaultTeacherId) : null,
      source: 'classfocus',
      createdAt: new Date().toISOString()
    }
    state.subjects.push(subject)
    this.saveState(state)
    return subject
  }

  updateSubject(id, payload) {
    const state = this.getState()
    const index = state.subjects.findIndex(subject => subject.id === id)
    if (index < 0) throw new Error('Materia no encontrada.')
    const name = payload.name?.trim()
    const code = payload.code?.trim().toUpperCase()
    if (!name || !code) throw new Error('Nombre y código son obligatorios.')
    if (state.subjects.some(subject => subject.id !== id && subject.code?.toLowerCase() === code.toLowerCase())) {
      throw new Error('Ya existe otra materia con ese código.')
    }
    state.subjects[index] = {
      ...state.subjects[index],
      ...payload,
      id,
      name,
      code,
      section: payload.section?.trim() || '',
      schedule: payload.schedule?.trim() || '',
      defaultTeacherId: payload.defaultTeacherId ? Number(payload.defaultTeacherId) : null
    }
    this.saveState(state)
    return state.subjects[index]
  }

  removeSubject(id) {
    const state = this.getState()
    state.subjects = state.subjects.filter(subject => subject.id !== id)
    state.assignments = state.assignments
      .map(item => ({ ...item, subjectIds: item.subjectIds.filter(subjectId => subjectId !== id) }))
      .filter(item => item.subjectIds.length)
    this.saveState(state)
  }

  assignSubject(studentId, teacherId, subjectId) {
    const student = this.getUserById(studentId)
    const teacher = this.getUserById(teacherId)
    const subject = this.getSubjectById(subjectId)
    if (!student || student.role !== 'student') throw new Error('Selecciona un alumno válido.')
    if (!teacher || teacher.role !== 'teacher') throw new Error('Selecciona un maestro válido.')
    if (!subject) throw new Error('Selecciona una materia válida.')

    const state = this.getState()
    state.assignments = state.assignments
      .map(item => item.studentId === Number(studentId)
        ? { ...item, subjectIds: item.subjectIds.filter(id => id !== subjectId) }
        : item)
      .filter(item => item.subjectIds.length)

    const row = state.assignments.find(item => item.studentId === Number(studentId) && item.teacherId === Number(teacherId))
    if (row) row.subjectIds = [...new Set([...row.subjectIds, subjectId])]
    else state.assignments.push({ studentId: Number(studentId), teacherId: Number(teacherId), subjectIds: [subjectId] })

    this.saveState(state)
    return { studentId: Number(studentId), teacherId: Number(teacherId), subjectId }
  }

  assignStudent(studentId, teacherId, subjectIds) {
    if (!subjectIds?.length) throw new Error('Selecciona al menos una materia.')
    subjectIds.forEach(subjectId => this.assignSubject(studentId, teacherId, subjectId))
    return this.getStudentAssignment(studentId)
  }

  removeStudentSubject(studentId, subjectId) {
    const state = this.getState()
    state.assignments = state.assignments
      .map(item => item.studentId === Number(studentId)
        ? { ...item, subjectIds: item.subjectIds.filter(id => id !== subjectId) }
        : item)
      .filter(item => item.subjectIds.length)
    this.saveState(state)
  }

  removeAssignment(studentId) {
    const state = this.getState()
    state.assignments = state.assignments.filter(item => item.studentId !== Number(studentId))
    this.saveState(state)
  }

  resetDemoData() {
    const initial = { users: clone(USERS), subjects: clone(SUBJECTS), assignments: clone(DEFAULT_ASSIGNMENTS) }
    this.saveState(initial)
    return initial
  }
}

export const academicService = new AcademicService()
