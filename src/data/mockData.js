export const USERS = [
  {
    id: 1,
    name: 'Alumno Demo',
    email: 'student@classfocus.com',
    password: '123456',
    role: 'student'
  },
  {
    id: 2,
    name: 'Ing. Carlos Méndez',
    email: 'teacher@classfocus.com',
    password: '123456',
    role: 'teacher'
  },
  {
    id: 3,
    name: 'Super Administrador',
    email: 'admin@classfocus.com',
    password: '123456',
    role: 'admin'
  },
  {
    id: 4,
    name: 'María López',
    email: 'maria@classfocus.com',
    password: '123456',
    role: 'student'
  },
  {
    id: 5,
    name: 'Lic. Ana García',
    email: 'ana@classfocus.com',
    password: '123456',
    role: 'teacher'
  },
  {
    id: 6,
    name: 'José Pérez',
    email: 'jose@classfocus.com',
    password: '123456',
    role: 'student'
  }
]

export const SUBJECTS = [
  { id: 'prog1', name: 'Programación I', code: 'SIS-101' },
  { id: 'db1', name: 'Base de Datos I', code: 'SIS-202' },
  { id: 'math1', name: 'Matemática I', code: 'MAT-101' },
  { id: 'net1', name: 'Redes I', code: 'RED-201' },
  { id: 'web1', name: 'Desarrollo Web', code: 'SIS-220' }
]

export const DEFAULT_ASSIGNMENTS = [
  { studentId: 1, teacherId: 2, subjectIds: ['prog1', 'db1'] },
  { studentId: 4, teacherId: 2, subjectIds: ['prog1', 'web1'] },
  { studentId: 6, teacherId: 5, subjectIds: ['math1', 'net1'] }
]

export const DEFAULT_METRICS = {
  attentionAverage: 84,
  classMinutes: 62,
  gazeAlerts: 3,
  tabChanges: 1,
  faceAbsences: 0,
  fullscreenExits: 0,
  lastExpression: 'Neutral'
}
