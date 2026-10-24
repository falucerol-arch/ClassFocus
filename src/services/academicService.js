import { DEFAULT_ASSIGNMENTS, SUBJECTS, USERS } from '../data/mockData'
import { apiClient } from './apiClient'

const ACADEMIC_KEY = 'classfocus_academic_data_v3'

const VALID_ROLES = new Set([
  'student',
  'teacher',
  'admin'
])

const clone = value =>
  JSON.parse(
    JSON.stringify(value)
  )


// =====================================================
// HELPERS DE USUARIOS Y ROLES
// =====================================================

const normalizeEmail = value =>
  String(value || '')
    .trim()
    .toLowerCase()


const getRoles = user => {
  const source =
    Array.isArray(user?.roles)
      ? user.roles
      : [user?.role]

  const roles = [
    ...new Set(
      source
        .map(role =>
          String(role || '')
            .trim()
        )
        .filter(role =>
          VALID_ROLES.has(role)
        )
    )
  ]

  return roles.length
    ? roles
    : ['student']
}


const getPrimaryRole = (
  roles,
  preferredRole
) => {

  if (
    preferredRole &&
    roles.includes(preferredRole)
  ) {
    return preferredRole
  }

  if (
    roles.includes('admin')
  ) {
    return 'admin'
  }

  if (
    roles.includes('teacher')
  ) {
    return 'teacher'
  }

  return roles[0]
}


const normalizeUser = user => {
  const roles =
    getRoles(user)

  return {
    ...user,

    id:
      Number(user.id),

    name:
      String(
        user.name ||
        ''
      ).trim(),

    email:
      normalizeEmail(
        user.email
      ),

    role:
      getPrimaryRole(
        roles,
        user.role
      ),

    roles,

    source:
      user.source ||
      'classfocus'
  }
}


const normalizeState = state => ({
  users:
    clone(
      state.users ||
      []
    ).map(
      normalizeUser
    ),

  subjects:
    clone(
      state.subjects ||
      []
    ),

  assignments:
    clone(
      state.assignments ||
      []
    )
})


// =====================================================
// SERVICIO ACADÉMICO
// =====================================================

class AcademicService {

  // ===================================================
  // ESTADO
  // ===================================================

  getState() {
    try {

      const saved =
        JSON.parse(
          sessionStorage.getItem(
            ACADEMIC_KEY
          )
        )

      if (
        saved?.users &&
        saved?.subjects &&
        saved?.assignments
      ) {
        // Convierte automáticamente datos viejos
        // user.role -> user.roles[]
        const normalized =
          normalizeState(saved)

        sessionStorage.setItem(
          ACADEMIC_KEY,
          JSON.stringify(
            normalized
          )
        )

        return normalized
      }

    } catch {
      // Si el almacenamiento se dañó,
      // se reconstruye con los datos demo.
    }


    const initial =
      normalizeState({
        users:
          USERS,

        subjects:
          SUBJECTS,

        assignments:
          DEFAULT_ASSIGNMENTS
      })


    sessionStorage.setItem(
      ACADEMIC_KEY,
      JSON.stringify(
        initial
      )
    )


    return initial
  }


  // ===================================================
  // GUARDAR ESTADO
  // ===================================================

  saveState(
    state,
    syncRemote = true
  ) {

    const normalized =
      normalizeState(state)


    sessionStorage.setItem(
      ACADEMIC_KEY,
      JSON.stringify(
        normalized
      )
    )


    window.dispatchEvent(
      new Event(
        'classfocus-academic-updated'
      )
    )


    if (syncRemote) {

      apiClient
        .syncAcademic(
          normalized
        )
        .catch(
          error => {
            console.error(
              'No se pudieron sincronizar los datos académicos:',
              error
            )
          }
        )
    }
  }


  // ===================================================
  // HIDRATAR DESDE API
  // ===================================================

  hydrate(state) {

    if (
      !state?.users ||
      !state?.subjects ||
      !state?.assignments
    ) {
      return
    }


    // La API no entrega contraseñas.
    // También normalizamos roles antiguos.

    const next =
      normalizeState(state)


    this.saveState(
      next,
      false
    )
  }


  // ===================================================
  // USUARIOS
  // ===================================================

  getUsers() {
    return this
      .getState()
      .users
  }


  getUserById(id) {

    return (
      this
        .getUsers()
        .find(
          user =>
            Number(user.id) ===
            Number(id)
        ) ||
      null
    )
  }


  userHasRole(
    user,
    role
  ) {

    return Boolean(
      user &&
      getRoles(user)
        .includes(role)
    )
  }


  // ===================================================
  // ALUMNOS
  // ===================================================

  getStudents() {

    return this
      .getUsers()
      .filter(
        user =>
          this.userHasRole(
            user,
            'student'
          )
      )
  }


  // ===================================================
  // MAESTROS
  // ===================================================

  getTeachers() {

    return this
      .getUsers()
      .filter(
        user =>
          this.userHasRole(
            user,
            'teacher'
          )
      )
  }


  // ===================================================
  // ADMINISTRADORES
  // ===================================================

  getAdmins() {

    return this
      .getUsers()
      .filter(
        user =>
          this.userHasRole(
            user,
            'admin'
          )
      )
  }


  // ===================================================
  // CREAR USUARIO
  // ===================================================

  createUser(payload) {

    const name =
      String(
        payload.name ||
        ''
      ).trim()


    const email =
      normalizeEmail(
        payload.email
      )


    if (!name) {
      throw new Error(
        'Escribe el nombre del usuario.'
      )
    }


    if (!email) {
      throw new Error(
        'Escribe el correo del usuario.'
      )
    }


    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
        .test(email)
    ) {
      throw new Error(
        'El correo no es válido.'
      )
    }


    const roles =
      getRoles(payload)


    if (
      !roles.length
    ) {
      throw new Error(
        'Selecciona al menos un rol.'
      )
    }


    const state =
      this.getState()


    // =================================================
    // REUTILIZAR CORREO EXISTENTE
    // =================================================
    //
    // Si Pepita ya existe como alumno:
    //
    // pepita@gmail.com -> student
    //
    // y el admin vuelve a usar ese correo como maestro,
    // NO creamos otro usuario.
    //
    // El resultado será:
    //
    // roles: ['student', 'teacher']
    // =================================================

    const existingIndex =
      state.users.findIndex(
        user =>
          normalizeEmail(
            user.email
          ) === email
      )


    if (
      existingIndex >= 0
    ) {

      const existing =
        state.users[
          existingIndex
        ]


      const existingRoles =
        getRoles(existing)


      const mergedRoles = [
        ...new Set([
          ...existingRoles,
          ...roles
        ])
      ]


      const updated = {
        ...existing,

        name,

        email,

        roles:
          mergedRoles,

        role:
          getPrimaryRole(
            mergedRoles,
            payload.role ||
            existing.role
          ),

        source:
          existing.source ||
          payload.source ||
          'classfocus',

        updatedAt:
          new Date()
            .toISOString()
      }


      state.users[
        existingIndex
      ] =
        updated


      this.saveState(state)


      return updated
    }


    // =================================================
    // GENERAR ID
    // =================================================

    const maxId =
      state.users.reduce(
        (
          max,
          user
        ) => {

          const id =
            Number(user.id)

          return Number.isFinite(id)
            ? Math.max(
                max,
                id
              )
            : max
        },

        0
      )


    const id =
      maxId + 1


    const user = {

      id,

      name,

      email,

      roles,

      role:
        getPrimaryRole(
          roles,
          payload.role
        ),

      source:
        payload.source ||
        'classfocus',

      createdAt:
        new Date()
          .toISOString(),

      updatedAt:
        new Date()
          .toISOString()
    }


    state.users.push(
      user
    )


    this.saveState(state)


    return user
  }


  // ===================================================
  // ACTUALIZAR USUARIO
  // ===================================================

  updateUser(
    id,
    payload
  ) {

    const state =
      this.getState()


    const index =
      state.users.findIndex(
        user =>
          Number(user.id) ===
          Number(id)
      )


    if (
      index < 0
    ) {
      throw new Error(
        'Usuario no encontrado.'
      )
    }


    const existing =
      state.users[index]


    const name =
      String(
        payload.name ??
        existing.name ??
        ''
      ).trim()


    const email =
      normalizeEmail(
        payload.email ??
        existing.email
      )


    if (!name) {
      throw new Error(
        'El nombre es obligatorio.'
      )
    }


    if (!email) {
      throw new Error(
        'El correo es obligatorio.'
      )
    }


    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
        .test(email)
    ) {
      throw new Error(
        'El correo no es válido.'
      )
    }


    // No permitir que dos personas distintas
    // terminen con el mismo correo.

    const duplicated =
      state.users.some(
        user =>
          Number(user.id) !==
            Number(id) &&

          normalizeEmail(
            user.email
          ) ===
            email
      )


    if (duplicated) {
      throw new Error(
        'Ese correo ya pertenece a otro usuario.'
      )
    }


    const roles =
      getRoles(payload)


    if (
      !roles.length
    ) {
      throw new Error(
        'Selecciona al menos un rol.'
      )
    }


    const primaryRole =
      getPrimaryRole(
        roles,
        payload.role ||
        existing.role
      )


    state.users[index] = {
      ...existing,
      ...payload,

      id:
        Number(id),

      name,

      email,

      role:
        primaryRole,

      roles,

      source:
        existing.source ||
        payload.source ||
        'classfocus',

      updatedAt:
        new Date()
          .toISOString()
    }


    // =================================================
    // LIMPIAR ASIGNACIONES SI QUITA ROL ALUMNO
    // =================================================

    if (
      !roles.includes(
        'student'
      )
    ) {

      state.assignments =
        state.assignments.filter(
          assignment =>
            Number(
              assignment.studentId
            ) !==
            Number(id)
        )
    }


    // =================================================
    // LIMPIAR ASIGNACIONES SI QUITA ROL MAESTRO
    // =================================================

    if (
      !roles.includes(
        'teacher'
      )
    ) {

      state.assignments =
        state.assignments.filter(
          assignment =>
            Number(
              assignment.teacherId
            ) !==
            Number(id)
        )


      state.subjects =
        state.subjects.map(
          subject => {

            if (
              Number(
                subject.defaultTeacherId
              ) ===
              Number(id)
            ) {

              return {
                ...subject,

                defaultTeacherId:
                  null
              }
            }


            return subject
          }
        )
    }


    this.saveState(state)


    return state.users[
      index
    ]
  }


  // ===================================================
  // MATERIAS
  // ===================================================

  getSubjects() {

    return this
      .getState()
      .subjects
  }


  getSubjectById(id) {

    return (
      this
        .getSubjects()
        .find(
          subject =>
            subject.id === id
        ) ||
      null
    )
  }


  // ===================================================
  // ASIGNACIONES
  // ===================================================

  getAssignments() {

    return this
      .getState()
      .assignments
  }


  // ===================================================
  // ASIGNACIONES DE ALUMNO
  // ===================================================

  getStudentAssignments(
    studentId
  ) {

    return this
      .getAssignments()

      .filter(
        item =>
          Number(
            item.studentId
          ) ===
          Number(studentId)
      )

      .map(
        item => ({
          ...item,

          teacher:
            this.getUserById(
              item.teacherId
            ),

          subjects:
            this
              .getSubjects()
              .filter(
                subject =>
                  item.subjectIds
                    .includes(
                      subject.id
                    )
              )
        })
      )
  }


  // ===================================================
  // ASIGNACIÓN AGRUPADA DEL ALUMNO
  // ===================================================

  getStudentAssignment(
    studentId
  ) {

    const rows =
      this.getStudentAssignments(
        studentId
      )


    if (
      !rows.length
    ) {
      return null
    }


    const subjects = []

    const seen =
      new Set()

    const subjectTeachers = {}


    rows.forEach(
      row => {

        row.subjects.forEach(
          subject => {

            if (
              !seen.has(
                subject.id
              )
            ) {

              seen.add(
                subject.id
              )

              subjects.push(
                subject
              )
            }


            subjectTeachers[
              subject.id
            ] =
              row.teacher
          }
        )
      }
    )


    return {

      studentId:
        Number(
          studentId
        ),

      teacherId:
        rows[0]
          .teacherId,

      teacher:
        rows[0]
          .teacher,

      teachers:
        [
          ...new Map(
            rows
              .filter(
                row =>
                  row.teacher
              )
              .map(
                row => [
                  row.teacher.id,
                  row.teacher
                ]
              )
          ).values()
        ],

      subjects,

      subjectIds:
        subjects.map(
          subject =>
            subject.id
        ),

      subjectTeachers
    }
  }


  // ===================================================
  // DOCENTE DE UNA MATERIA DEL ALUMNO
  // ===================================================

  getTeacherForStudentSubject(
    studentId,
    subjectId
  ) {

    return (
      this
        .getStudentAssignment(
          studentId
        )
        ?.subjectTeachers
        ?.[subjectId] ||
      null
    )
  }


  // ===================================================
  // ALUMNOS DE MAESTRO
  // ===================================================

  getStudentsForTeacher(
    teacherId
  ) {

    const teacherAssignments =
      this
        .getAssignments()
        .filter(
          item =>
            Number(
              item.teacherId
            ) ===
            Number(
              teacherId
            )
        )


    const grouped =
      new Map()


    teacherAssignments
      .forEach(
        assignment => {

          const existing =
            grouped.get(
              assignment.studentId
            ) || {
              studentId:
                assignment.studentId,

              subjectIds: []
            }


          existing.subjectIds = [
            ...new Set([
              ...existing.subjectIds,
              ...assignment.subjectIds
            ])
          ]


          grouped.set(
            assignment.studentId,
            existing
          )
        }
      )


    return [
      ...grouped.values()
    ]
      .map(
        assignment => ({
          student:
            this.getUserById(
              assignment.studentId
            ),

          teacher:
            this.getUserById(
              teacherId
            ),

          subjectIds:
            assignment.subjectIds,

          subjects:
            this
              .getSubjects()
              .filter(
                subject =>
                  assignment
                    .subjectIds
                    .includes(
                      subject.id
                    )
              )
        })
      )

      .filter(
        item =>
          item.student &&
          this.userHasRole(
            item.student,
            'student'
          )
      )
  }


  // ===================================================
  // MATERIAS DE MAESTRO
  // ===================================================

  getSubjectsForTeacher(
    teacherId
  ) {

    const ids =
      new Set()


    this
      .getAssignments()
      .forEach(
        item => {

          if (
            Number(
              item.teacherId
            ) ===
            Number(
              teacherId
            )
          ) {

            item.subjectIds
              .forEach(
                id =>
                  ids.add(id)
              )
          }
        }
      )


    this
      .getSubjects()
      .forEach(
        subject => {

          if (
            Number(
              subject.defaultTeacherId
            ) ===
            Number(
              teacherId
            )
          ) {

            ids.add(
              subject.id
            )
          }
        }
      )


    return this
      .getSubjects()
      .filter(
        subject =>
          ids.has(
            subject.id
          )
      )
  }


  // ===================================================
  // CREAR MATERIA
  // ===================================================

  createSubject(payload) {

    const name =
      payload.name
        ?.trim()


    const code =
      payload.code
        ?.trim()
        .toUpperCase()


    if (!name) {
      throw new Error(
        'Escribe el nombre de la materia.'
      )
    }


    if (!code) {
      throw new Error(
        'Escribe el código de la materia.'
      )
    }


    const state =
      this.getState()


    if (
      state.subjects.some(
        subject =>
          subject.code
            ?.toLowerCase() ===
          code.toLowerCase()
      )
    ) {
      throw new Error(
        'Ya existe una materia con ese código.'
      )
    }


    const subject = {

      id:
        `sub-${Date.now()}-${Math.random()
          .toString(16)
          .slice(2, 6)}`,

      name,

      code,

      section:
        payload.section
          ?.trim() ||
        '',

      schedule:
        payload.schedule
          ?.trim() ||
        '',

      defaultTeacherId:
        payload.defaultTeacherId
          ? Number(
              payload.defaultTeacherId
            )
          : null,

      source:
        'classfocus',

      createdAt:
        new Date()
          .toISOString()
    }


    state.subjects.push(
      subject
    )


    this.saveState(state)


    return subject
  }


  // ===================================================
  // ACTUALIZAR MATERIA
  // ===================================================

  updateSubject(
    id,
    payload
  ) {

    const state =
      this.getState()


    const index =
      state.subjects
        .findIndex(
          subject =>
            subject.id === id
        )


    if (
      index < 0
    ) {
      throw new Error(
        'Materia no encontrada.'
      )
    }


    const name =
      payload.name
        ?.trim()


    const code =
      payload.code
        ?.trim()
        .toUpperCase()


    if (
      !name ||
      !code
    ) {
      throw new Error(
        'Nombre y código son obligatorios.'
      )
    }


    if (
      state.subjects.some(
        subject =>
          subject.id !== id &&

          subject.code
            ?.toLowerCase() ===
          code.toLowerCase()
      )
    ) {
      throw new Error(
        'Ya existe otra materia con ese código.'
      )
    }


    state.subjects[index] = {

      ...state.subjects[index],

      ...payload,

      id,

      name,

      code,

      section:
        payload.section
          ?.trim() ||
        '',

      schedule:
        payload.schedule
          ?.trim() ||
        '',

      defaultTeacherId:
        payload.defaultTeacherId
          ? Number(
              payload.defaultTeacherId
            )
          : null
    }


    this.saveState(state)


    return state.subjects[
      index
    ]
  }


  // ===================================================
  // ELIMINAR MATERIA
  // ===================================================

  removeSubject(id) {

    const state =
      this.getState()


    state.subjects =
      state.subjects
        .filter(
          subject =>
            subject.id !== id
        )


    state.assignments =
      state.assignments

        .map(
          item => ({
            ...item,

            subjectIds:
              item.subjectIds
                .filter(
                  subjectId =>
                    subjectId !== id
                )
          })
        )

        .filter(
          item =>
            item.subjectIds.length
        )


    this.saveState(state)
  }


  // ===================================================
  // ASIGNAR MATERIA
  // ===================================================

  assignSubject(
    studentId,
    teacherId,
    subjectId
  ) {

    const student =
      this.getUserById(
        studentId
      )


    const teacher =
      this.getUserById(
        teacherId
      )


    const subject =
      this.getSubjectById(
        subjectId
      )


    if (
      !student ||
      !this.userHasRole(
        student,
        'student'
      )
    ) {
      throw new Error(
        'Selecciona un alumno válido.'
      )
    }


    if (
      !teacher ||
      !this.userHasRole(
        teacher,
        'teacher'
      )
    ) {
      throw new Error(
        'Selecciona un maestro válido.'
      )
    }


    if (!subject) {
      throw new Error(
        'Selecciona una materia válida.'
      )
    }


    const state =
      this.getState()


    // Una materia del alumno solo puede
    // estar asociada a un maestro.

    state.assignments =
      state.assignments

        .map(
          item =>
            Number(
              item.studentId
            ) ===
            Number(
              studentId
            )

              ? {
                  ...item,

                  subjectIds:
                    item.subjectIds
                      .filter(
                        id =>
                          id !==
                          subjectId
                      )
                }

              : item
        )

        .filter(
          item =>
            item.subjectIds.length
        )


    const row =
      state.assignments
        .find(
          item =>
            Number(
              item.studentId
            ) ===
              Number(
                studentId
              ) &&

            Number(
              item.teacherId
            ) ===
              Number(
                teacherId
              )
        )


    if (row) {

      row.subjectIds = [
        ...new Set([
          ...row.subjectIds,
          subjectId
        ])
      ]

    } else {

      state.assignments.push({
        studentId:
          Number(
            studentId
          ),

        teacherId:
          Number(
            teacherId
          ),

        subjectIds: [
          subjectId
        ]
      })
    }


    this.saveState(state)


    return {
      studentId:
        Number(
          studentId
        ),

      teacherId:
        Number(
          teacherId
        ),

      subjectId
    }
  }


  // ===================================================
  // ASIGNAR VARIAS MATERIAS
  // ===================================================

  assignStudent(
    studentId,
    teacherId,
    subjectIds
  ) {

    if (
      !subjectIds?.length
    ) {
      throw new Error(
        'Selecciona al menos una materia.'
      )
    }


    subjectIds.forEach(
      subjectId =>
        this.assignSubject(
          studentId,
          teacherId,
          subjectId
        )
    )


    return this
      .getStudentAssignment(
        studentId
      )
  }


  // ===================================================
  // QUITAR MATERIA
  // ===================================================

  removeStudentSubject(
    studentId,
    subjectId
  ) {

    const state =
      this.getState()


    state.assignments =
      state.assignments

        .map(
          item =>
            Number(
              item.studentId
            ) ===
            Number(
              studentId
            )

              ? {
                  ...item,

                  subjectIds:
                    item.subjectIds
                      .filter(
                        id =>
                          id !==
                          subjectId
                      )
                }

              : item
        )

        .filter(
          item =>
            item.subjectIds.length
        )


    this.saveState(state)
  }


  // ===================================================
  // ELIMINAR ASIGNACIONES DE ALUMNO
  // ===================================================

  removeAssignment(
    studentId
  ) {

    const state =
      this.getState()


    state.assignments =
      state.assignments
        .filter(
          item =>
            Number(
              item.studentId
            ) !==
            Number(
              studentId
            )
        )


    this.saveState(state)
  }


  // ===================================================
  // RESTABLECER DATOS DEMO
  // ===================================================

  resetDemoData() {

    const initial =
      normalizeState({
        users:
          USERS,

        subjects:
          SUBJECTS,

        assignments:
          DEFAULT_ASSIGNMENTS
      })


    this.saveState(
      initial
    )


    return initial
  }
}


export const academicService =
  new AcademicService()