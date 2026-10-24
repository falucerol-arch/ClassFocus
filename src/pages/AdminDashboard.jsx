import { useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  Crown,
  GraduationCap,
  Pencil,
  Plus,
  Save,
  Trash2,
  UserRound,
  UsersRound
} from 'lucide-react'

import Layout from '../components/Layout'
import ClassroomPanel from '../components/ClassroomPanel'
import MetricCard from '../components/MetricCard'
import { academicService } from '../services/academicService'


// =====================================================
// DATOS VACÍOS
// =====================================================

const EMPTY_USER = {
  name: '',
  email: '',
  role: 'student',
  roles: ['student'],
  source: 'classfocus'
}

const EMPTY_SUBJECT = {
  name: '',
  code: '',
  section: '',
  schedule: '',
  defaultTeacherId: ''
}


// =====================================================
// HELPERS DE ROLES
// =====================================================

const getUserRoles = user => {
  if (
    Array.isArray(user?.roles) &&
    user.roles.length
  ) {
    return [...new Set(user.roles)]
  }

  return user?.role
    ? [user.role]
    : []
}

const userHasRole = (user, role) =>
  getUserRoles(user).includes(role)


// =====================================================
// ESTILOS DE SELECTOR DE ROLES
// =====================================================

const roleGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: '10px',
  marginTop: '10px'
}

const roleOptionStyle = active => ({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: '11px',
  padding: '13px',
  borderRadius: '13px',
  border: active
    ? '1px solid rgba(220, 38, 38, 0.85)'
    : '1px solid rgba(255,255,255,0.10)',
  background: active
    ? 'rgba(220, 38, 38, 0.12)'
    : 'rgba(255,255,255,0.025)',
  cursor: 'pointer',
  transition: '0.2s ease',
  minWidth: 0
})

const roleIconStyle = active => ({
  width: '38px',
  height: '38px',
  borderRadius: '10px',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: active
    ? 'rgba(220, 38, 38, 0.20)'
    : 'rgba(255,255,255,0.06)',
  color: active
    ? '#ef4444'
    : 'inherit'
})

const roleTextStyle = {
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '2px'
}

const roleDescriptionStyle = {
  fontSize: '11px',
  opacity: 0.6,
  lineHeight: 1.25
}


// =====================================================
// COMPONENTE PRINCIPAL
// =====================================================

export default function AdminDashboard() {
  const [version, setVersion] = useState(0)

  // ===================================================
  // DATOS
  // ===================================================

  const users = useMemo(
    () => academicService.getUsers(),
    [version]
  )

  const students = useMemo(
    () =>
      users.filter(user =>
        userHasRole(user, 'student')
      ),
    [users]
  )

  const teachers = useMemo(
    () =>
      users.filter(user =>
        userHasRole(user, 'teacher')
      ),
    [users]
  )

  const subjects = useMemo(
    () => academicService.getSubjects(),
    [version]
  )

  // ===================================================
  // FORMULARIO DE USUARIO
  // ===================================================

  const [userForm, setUserForm] =
    useState(EMPTY_USER)

  const [editingUserId, setEditingUserId] =
    useState(null)

  const [userMessage, setUserMessage] =
    useState('')

  const [userError, setUserError] =
    useState('')

  // ===================================================
  // FORMULARIO DE MATERIA
  // ===================================================

  const [subjectForm, setSubjectForm] =
    useState(EMPTY_SUBJECT)

  const [editingSubjectId, setEditingSubjectId] =
    useState(null)

  const [subjectMessage, setSubjectMessage] =
    useState('')

  const [subjectError, setSubjectError] =
    useState('')

  // ===================================================
  // MATRÍCULA
  // ===================================================

  const [studentId, setStudentId] =
    useState('')

  const [teacherId, setTeacherId] =
    useState('')

  const [subjectId, setSubjectId] =
    useState('')

  const [assignmentMessage, setAssignmentMessage] =
    useState('')

  const [assignmentError, setAssignmentError] =
    useState('')

  // ===================================================
  // REFRESCAR DATOS
  // ===================================================

  const refresh = () =>
    setVersion(value => value + 1)

  // Mantener selects con valores válidos
  useEffect(() => {
    if (
      !studentId ||
      !students.some(
        student =>
          Number(student.id) === Number(studentId)
      )
    ) {
      setStudentId(
        students[0]?.id || ''
      )
    }
  }, [students, studentId])

  useEffect(() => {
    if (
      !teacherId ||
      !teachers.some(
        teacher =>
          Number(teacher.id) === Number(teacherId)
      )
    ) {
      setTeacherId(
        teachers[0]?.id || ''
      )
    }
  }, [teachers, teacherId])

  useEffect(() => {
    const available =
      subjects.filter(
        subject =>
          subject.source !== 'google-classroom'
      )

    if (
      !subjectId ||
      !available.some(
        subject =>
          subject.id === subjectId
      )
    ) {
      setSubjectId(
        available[0]?.id || ''
      )
    }
  }, [subjects, subjectId])


  // ===================================================
  // CAMBIAR ROL
  // ===================================================

  const toggleUserRole = role => {
    setUserForm(current => {
      const roles =
        Array.isArray(current.roles)
          ? current.roles
          : []

      const exists =
        roles.includes(role)

      const newRoles =
        exists
          ? roles.filter(
              currentRole =>
                currentRole !== role
            )
          : [
              ...roles,
              role
            ]

      return {
        ...current,
        roles: newRoles
      }
    })
  }


  // ===================================================
  // GUARDAR USUARIO
  // ===================================================

  const saveUser = async event => {
    event.preventDefault()

    setUserMessage('')
    setUserError('')

    try {
      const name =
        String(
          userForm.name || ''
        ).trim()

      const email =
        String(
          userForm.email || ''
        )
          .trim()
          .toLowerCase()

      const roles =
        [
          ...new Set(
            userForm.roles || []
          )
        ]

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

      if (!roles.length) {
        throw new Error(
          'Selecciona al menos un rol.'
        )
      }

      // Mantener role como rol principal
      // para compatibilidad con partes antiguas.
      let primaryRole =
        userForm.role

      if (
        !roles.includes(primaryRole)
      ) {
        if (
          roles.includes('admin')
        ) {
          primaryRole = 'admin'
        } else if (
          roles.includes('teacher')
        ) {
          primaryRole = 'teacher'
        } else {
          primaryRole = roles[0]
        }
      }

      const payload = {
        ...userForm,
        name,
        email,
        role: primaryRole,
        roles,
        source:
          userForm.source ||
          'classfocus'
      }

      if (editingUserId) {
        await academicService.updateUser(
          editingUserId,
          payload
        )

        setUserMessage(
          'Usuario actualizado correctamente.'
        )
      } else {
        await academicService.createUser(
          payload
        )

        setUserMessage(
          'Usuario creado correctamente.'
        )
      }

      setUserForm({
        ...EMPTY_USER
      })

      setEditingUserId(null)

      refresh()

    } catch (error) {
      setUserMessage('')

      setUserError(
        error?.message ||
        'No se pudo guardar el usuario.'
      )
    }
  }


  // ===================================================
  // EDITAR USUARIO
  // ===================================================

  const editUser = user => {
    const roles =
      getUserRoles(user)

    setEditingUserId(
      user.id
    )

    setUserForm({
      name:
        user.name || '',

      email:
        user.email || '',

      role:
        user.role ||
        roles[0] ||
        'student',

      roles:
        roles.length
          ? roles
          : ['student'],

      source:
        user.source ||
        'classfocus'
    })

    setUserMessage('')
    setUserError('')

    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    })
  }


  const cancelUserEdit = () => {
    setEditingUserId(null)

    setUserForm({
      ...EMPTY_USER
    })

    setUserMessage('')
    setUserError('')
  }


  // ===================================================
  // GUARDAR MATERIA
  // ===================================================

  const saveSubject = event => {
    event.preventDefault()

    try {
      if (editingSubjectId) {
        academicService.updateSubject(
          editingSubjectId,
          subjectForm
        )
      } else {
        academicService.createSubject(
          subjectForm
        )
      }

      setSubjectMessage(
        editingSubjectId
          ? 'Materia actualizada correctamente.'
          : 'Materia creada correctamente.'
      )

      setSubjectError('')

      setSubjectForm({
        ...EMPTY_SUBJECT
      })

      setEditingSubjectId(null)

      refresh()

    } catch (error) {
      setSubjectMessage('')

      setSubjectError(
        error?.message ||
        'No se pudo guardar la materia.'
      )
    }
  }


  // ===================================================
  // EDITAR MATERIA
  // ===================================================

  const editSubject = subject => {
    setEditingSubjectId(
      subject.id
    )

    setSubjectForm({
      name:
        subject.name || '',

      code:
        subject.code || '',

      section:
        subject.section || '',

      schedule:
        subject.schedule || '',

      defaultTeacherId:
        subject.defaultTeacherId || ''
    })

    setSubjectMessage('')
    setSubjectError('')

    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    })
  }


  // ===================================================
  // ELIMINAR MATERIA
  // ===================================================

  const deleteSubject = subject => {
    if (
      !window.confirm(
        `¿Eliminar la materia ${subject.name}?`
      )
    ) {
      return
    }

    academicService.removeSubject(
      subject.id
    )

    setSubjectMessage(
      'Materia eliminada.'
    )

    if (
      subjectId === subject.id
    ) {
      setSubjectId('')
    }

    refresh()
  }


  // ===================================================
  // GUARDAR ASIGNACIÓN
  // ===================================================

  const saveAssignment = event => {
    event.preventDefault()

    try {
      if (
        !studentId ||
        !teacherId ||
        !subjectId
      ) {
        throw new Error(
          'Selecciona alumno, materia y maestro.'
        )
      }

      academicService.assignSubject(
        studentId,
        teacherId,
        subjectId
      )

      setAssignmentMessage(
        'Materia asignada correctamente al alumno.'
      )

      setAssignmentError('')

      refresh()

    } catch (error) {
      setAssignmentMessage('')

      setAssignmentError(
        error?.message ||
        'No se pudo realizar la asignación.'
      )
    }
  }


  // ===================================================
  // QUITAR MATERIA DEL ALUMNO
  // ===================================================

  const removeStudentSubject = (
    student,
    subject
  ) => {
    academicService.removeStudentSubject(
      student.id,
      subject.id
    )

    setAssignmentMessage(
      `${subject.name} fue retirada de ${student.name}.`
    )

    refresh()
  }


  // ===================================================
  // RENDER
  // ===================================================

  return (
    <Layout
      title="Panel Super Admin"
      subtitle="Administra usuarios, roles, materias, docentes, alumnos e integraciones académicas desde un solo lugar."
    >

      {/* ================================================= */}
      {/* MÉTRICAS */}
      {/* ================================================= */}

      <div className="metrics-grid admin-metrics">

        <MetricCard
          icon={UserRound}
          label="Usuarios"
          value={users.length}
          hint="Personas registradas"
        />

        <MetricCard
          icon={GraduationCap}
          label="Alumnos"
          value={students.length}
          hint="Perfiles de alumno"
        />

        <MetricCard
          icon={UsersRound}
          label="Maestros"
          value={teachers.length}
          hint="Perfiles de maestro"
        />

        <MetricCard
          icon={BookOpen}
          label="Materias"
          value={subjects.length}
          hint="Cursos creados"
        />

      </div>


      {/* ================================================= */}
      {/* USUARIOS */}
      {/* ================================================= */}

      <section className="admin-section-block">

        <div className="section-heading-wide">

          <div>
            <span className="eyebrow">
              USUARIOS Y ROLES
            </span>

            <h2>
              Administrar usuarios
            </h2>

            <p>
              Un mismo correo puede funcionar como alumno,
              maestro o ambos sin crear cuentas duplicadas.
            </p>
          </div>

          <UsersRound size={28} />

        </div>


        <div className="admin-grid">

          {/* FORMULARIO DE USUARIO */}

          <form
            className="form-card admin-form"
            onSubmit={saveUser}
          >

            <div className="section-title">

              <div>
                <h3>
                  {
                    editingUserId
                      ? 'Editar usuario'
                      : 'Nuevo usuario'
                  }
                </h3>

                <span>
                  {
                    editingUserId
                      ? 'Modifica sus datos y perfiles'
                      : 'Registra una persona en ClassFocus'
                  }
                </span>
              </div>

              {
                editingUserId
                  ? <Pencil size={21} />
                  : <Plus size={21} />
              }

            </div>


            <label className="field-label">
              Nombre completo

              <input
                value={userForm.name}
                onChange={
                  event =>
                    setUserForm({
                      ...userForm,
                      name:
                        event.target.value
                    })
                }
                placeholder="Ej. Pepita Pérez"
              />
            </label>


            <label className="field-label">
              Correo

              <input
                type="email"
                value={userForm.email}
                onChange={
                  event =>
                    setUserForm({
                      ...userForm,
                      email:
                        event.target.value
                    })
                }
                placeholder="pepita@gmail.com"
              />
            </label>


            {/* SELECTOR DE ROLES */}

            <div className="field-label">
              Roles del usuario

              <div style={roleGridStyle}>

                {/* ALUMNO */}

                <label
                  style={
                    roleOptionStyle(
                      userForm.roles.includes(
                        'student'
                      )
                    )
                  }
                >
                  <input
                    type="checkbox"
                    checked={
                      userForm.roles.includes(
                        'student'
                      )
                    }
                    onChange={
                      () =>
                        toggleUserRole(
                          'student'
                        )
                    }
                    style={{
                      position: 'absolute',
                      opacity: 0,
                      pointerEvents: 'none'
                    }}
                  />

                  <div
                    style={
                      roleIconStyle(
                        userForm.roles.includes(
                          'student'
                        )
                      )
                    }
                  >
                    <GraduationCap size={19} />
                  </div>

                  <div style={roleTextStyle}>
                    <strong>
                      Alumno
                    </strong>

                    <span style={roleDescriptionStyle}>
                      Clases y evaluaciones
                    </span>
                  </div>

                </label>


                {/* MAESTRO */}

                <label
                  style={
                    roleOptionStyle(
                      userForm.roles.includes(
                        'teacher'
                      )
                    )
                  }
                >
                  <input
                    type="checkbox"
                    checked={
                      userForm.roles.includes(
                        'teacher'
                      )
                    }
                    onChange={
                      () =>
                        toggleUserRole(
                          'teacher'
                        )
                    }
                    style={{
                      position: 'absolute',
                      opacity: 0,
                      pointerEvents: 'none'
                    }}
                  />

                  <div
                    style={
                      roleIconStyle(
                        userForm.roles.includes(
                          'teacher'
                        )
                      )
                    }
                  >
                    <UsersRound size={19} />
                  </div>

                  <div style={roleTextStyle}>
                    <strong>
                      Maestro
                    </strong>

                    <span style={roleDescriptionStyle}>
                      Gestiona clases
                    </span>
                  </div>

                </label>


                {/* ADMINISTRADOR */}

                <label
                  style={
                    roleOptionStyle(
                      userForm.roles.includes(
                        'admin'
                      )
                    )
                  }
                >
                  <input
                    type="checkbox"
                    checked={
                      userForm.roles.includes(
                        'admin'
                      )
                    }
                    onChange={
                      () =>
                        toggleUserRole(
                          'admin'
                        )
                    }
                    style={{
                      position: 'absolute',
                      opacity: 0,
                      pointerEvents: 'none'
                    }}
                  />

                  <div
                    style={
                      roleIconStyle(
                        userForm.roles.includes(
                          'admin'
                        )
                      )
                    }
                  >
                    <Crown size={19} />
                  </div>

                  <div style={roleTextStyle}>
                    <strong>
                      Administrador
                    </strong>

                    <span style={roleDescriptionStyle}>
                      Control total
                    </span>
                  </div>

                </label>

              </div>
            </div>


            {
              userMessage &&
              (
                <div className="alert success">
                  {userMessage}
                </div>
              )
            }


            {
              userError &&
              (
                <div className="alert error">
                  {userError}
                </div>
              )
            }


            <div className="form-actions-row">

              <button
                className="primary-button"
                type="submit"
              >
                <Save size={18} />

                {
                  editingUserId
                    ? 'Guardar usuario'
                    : 'Crear usuario'
                }
              </button>


              {
                editingUserId &&
                (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={cancelUserEdit}
                  >
                    Cancelar
                  </button>
                )
              }

            </div>

          </form>


          {/* LISTA DE USUARIOS */}

          <section className="table-card">

            <div className="section-title">

              <h3>
                Usuarios registrados
              </h3>

              <span>
                {users.length} usuarios
              </span>

            </div>


            <div className="assignment-list">

              {
                users.map(user => {
                  const roles =
                    getUserRoles(user)

                  return (
                    <article
                      key={user.id}
                      className="assignment-row expanded-assignment"
                    >

                      <div className="avatar small">

                        {
                          roles.includes('admin')
                            ? (
                                <Crown size={20} />
                              )
                            : roles.includes('teacher')
                              ? (
                                  <UsersRound size={20} />
                                )
                              : (
                                  <GraduationCap size={20} />
                                )
                        }

                      </div>


                      <div className="assignment-info">

                        <strong>
                          {user.name}
                        </strong>

                        <small>
                          {user.email}
                        </small>


                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '6px',
                            marginTop: '8px'
                          }}
                        >

                          {
                            roles.includes(
                              'student'
                            ) &&
                            (
                              <span className="subject-code-badge">
                                Alumno
                              </span>
                            )
                          }


                          {
                            roles.includes(
                              'teacher'
                            ) &&
                            (
                              <span className="subject-code-badge">
                                Maestro
                              </span>
                            )
                          }


                          {
                            roles.includes(
                              'admin'
                            ) &&
                            (
                              <span className="subject-code-badge">
                                Administrador
                              </span>
                            )
                          }

                        </div>


                        {
                          user.source ===
                            'google-classroom' &&
                          (
                            <small
                              style={{
                                marginTop: '5px'
                              }}
                            >
                              Google Classroom
                            </small>
                          )
                        }

                      </div>


                      <div className="row-actions">

                        <button
                          className="icon-button"
                          type="button"
                          title="Editar usuario"
                          onClick={
                            () =>
                              editUser(user)
                          }
                        >
                          <Pencil size={17} />
                        </button>

                      </div>

                    </article>
                  )
                })
              }


              {
                !users.length &&
                (
                  <div className="empty-state">
                    Todavía no hay usuarios registrados.
                  </div>
                )
              }

            </div>

          </section>

        </div>

      </section>


      {/* ================================================= */}
      {/* MATERIAS */}
      {/* ================================================= */}

      <section className="admin-section-block">

        <div className="section-heading-wide">

          <div>
            <span className="eyebrow">
              GESTIÓN ACADÉMICA
            </span>

            <h2>
              Crear y administrar materias
            </h2>

            <p>
              Define el curso, código, sección,
              horario y docente base.
            </p>
          </div>

          <BookOpen size={28} />

        </div>


        <div className="admin-grid subjects-admin-grid">

          {/* FORMULARIO MATERIA */}

          <form
            className="form-card admin-form"
            onSubmit={saveSubject}
          >

            <div className="section-title">

              <div>
                <h3>
                  {
                    editingSubjectId
                      ? 'Editar materia'
                      : 'Nueva materia'
                  }
                </h3>

                <span>
                  {
                    editingSubjectId
                      ? 'Modifica los datos del curso'
                      : 'Crea una clase para poder asignarla'
                  }
                </span>
              </div>

              {
                editingSubjectId
                  ? <Pencil size={21} />
                  : <Plus size={21} />
              }

            </div>


            <div className="form-two-cols">

              <label className="field-label">
                Nombre de la materia

                <input
                  value={
                    subjectForm.name
                  }
                  onChange={
                    event =>
                      setSubjectForm({
                        ...subjectForm,
                        name:
                          event.target.value
                      })
                  }
                  placeholder="Ej. Programación III"
                />
              </label>


              <label className="field-label">
                Código

                <input
                  value={
                    subjectForm.code
                  }
                  onChange={
                    event =>
                      setSubjectForm({
                        ...subjectForm,
                        code:
                          event.target.value
                      })
                  }
                  placeholder="Ej. SIS-305"
                />
              </label>


              <label className="field-label">
                Sección

                <input
                  value={
                    subjectForm.section
                  }
                  onChange={
                    event =>
                      setSubjectForm({
                        ...subjectForm,
                        section:
                          event.target.value
                      })
                  }
                  placeholder="Ej. A"
                />
              </label>


              <label className="field-label">
                Horario

                <input
                  value={
                    subjectForm.schedule
                  }
                  onChange={
                    event =>
                      setSubjectForm({
                        ...subjectForm,
                        schedule:
                          event.target.value
                      })
                  }
                  placeholder="Ej. Lun 18:00–20:00"
                />
              </label>

            </div>


            <label className="field-label">
              Docente base

              <select
                value={
                  subjectForm.defaultTeacherId
                }
                onChange={
                  event =>
                    setSubjectForm({
                      ...subjectForm,
                      defaultTeacherId:
                        event.target.value
                    })
                }
              >
                <option value="">
                  Sin docente por defecto
                </option>

                {
                  teachers.map(
                    teacher => (
                      <option
                        key={teacher.id}
                        value={teacher.id}
                      >
                        {teacher.name}
                      </option>
                    )
                  )
                }

              </select>
            </label>


            {
              subjectMessage &&
              (
                <div className="alert success">
                  {subjectMessage}
                </div>
              )
            }


            {
              subjectError &&
              (
                <div className="alert error">
                  {subjectError}
                </div>
              )
            }


            <div className="form-actions-row">

              <button
                className="primary-button"
                type="submit"
              >
                <Save size={18} />

                {
                  editingSubjectId
                    ? 'Guardar cambios'
                    : 'Crear materia'
                }
              </button>


              {
                editingSubjectId &&
                (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={
                      () => {
                        setEditingSubjectId(
                          null
                        )

                        setSubjectForm({
                          ...EMPTY_SUBJECT
                        })

                        setSubjectMessage('')
                        setSubjectError('')
                      }
                    }
                  >
                    Cancelar
                  </button>
                )
              }

            </div>

          </form>


          {/* LISTA DE MATERIAS */}

          <section className="table-card">

            <div className="section-title">

              <h3>
                Materias disponibles
              </h3>

              <span>
                {subjects.length} creadas
              </span>

            </div>


            <div className="subject-admin-list">

              {
                subjects.map(
                  subject => {
                    const teacher =
                      academicService
                        .getUserById(
                          subject.defaultTeacherId
                        )

                    const imported =
                      subject.source ===
                      'google-classroom'

                    return (
                      <article
                        key={subject.id}
                        className="subject-admin-row"
                      >

                        <div className="subject-code-badge">
                          {subject.code}
                        </div>


                        <div>
                          <strong>
                            {subject.name}
                          </strong>

                          <small>
                            {
                              subject.section
                                ? `Sección ${subject.section}`
                                : 'Sin sección'
                            }

                            {' · '}

                            {
                              subject.schedule ||
                              'Horario pendiente'
                            }
                          </small>

                          <span>
                            {
                              teacher?.name ||
                              'Sin docente base'
                            }

                            {
                              imported
                                ? ' · Google Classroom'
                                : ''
                            }
                          </span>
                        </div>


                        <div className="row-actions">

                          <button
                            className="icon-button"
                            type="button"
                            disabled={imported}
                            title={
                              imported
                                ? 'Se administra desde Classroom'
                                : 'Editar'
                            }
                            onClick={
                              () =>
                                editSubject(
                                  subject
                                )
                            }
                          >
                            <Pencil size={17} />
                          </button>


                          <button
                            className="icon-button danger-icon"
                            type="button"
                            disabled={imported}
                            title={
                              imported
                                ? 'Se conserva el curso sincronizado'
                                : 'Eliminar'
                            }
                            onClick={
                              () =>
                                deleteSubject(
                                  subject
                                )
                            }
                          >
                            <Trash2 size={17} />
                          </button>

                        </div>

                      </article>
                    )
                  }
                )
              }


              {
                !subjects.length &&
                (
                  <div className="empty-state">
                    Todavía no hay materias creadas.
                  </div>
                )
              }

            </div>

          </section>

        </div>

      </section>


      {/* ================================================= */}
      {/* GOOGLE CLASSROOM */}
      {/* ================================================= */}

      <ClassroomPanel
        onImported={refresh}
      />


      {/* ================================================= */}
      {/* MATRÍCULA */}
      {/* ================================================= */}

      <section className="admin-section-block">

        <div className="section-heading-wide">

          <div>
            <span className="eyebrow">
              MATRÍCULA
            </span>

            <h2>
              Asignar alumnos a materias y maestros
            </h2>

            <p>
              Cada materia puede tener un docente
              distinto para el mismo alumno.
            </p>
          </div>

          <Crown size={28} />

        </div>


        <div className="admin-grid">

          {/* NUEVA ASIGNACIÓN */}

          <form
            className="form-card admin-form"
            onSubmit={saveAssignment}
          >

            <div className="section-title">

              <div>
                <h3>
                  Nueva asignación
                </h3>

                <span>
                  Alumno → materia → maestro
                </span>
              </div>

              <GraduationCap size={22} />

            </div>


            <label className="field-label">
              Alumno

              <select
                value={studentId}
                onChange={
                  event =>
                    setStudentId(
                      event.target.value
                    )
                }
              >
                <option value="">
                  Selecciona un alumno
                </option>

                {
                  students.map(
                    student => (
                      <option
                        key={student.id}
                        value={student.id}
                      >
                        {student.name}
                        {' · '}
                        {student.email}
                      </option>
                    )
                  )
                }

              </select>
            </label>


            <label className="field-label">
              Materia

              <select
                value={subjectId}
                onChange={
                  event =>
                    setSubjectId(
                      event.target.value
                    )
                }
              >
                <option value="">
                  Selecciona una materia
                </option>

                {
                  subjects
                    .filter(
                      subject =>
                        subject.source !==
                        'google-classroom'
                    )
                    .map(
                      subject => (
                        <option
                          key={subject.id}
                          value={subject.id}
                        >
                          {subject.code}
                          {' · '}
                          {subject.name}
                        </option>
                      )
                    )
                }

              </select>
            </label>


            <label className="field-label">
              Maestro

              <select
                value={teacherId}
                onChange={
                  event =>
                    setTeacherId(
                      event.target.value
                    )
                }
              >
                <option value="">
                  Selecciona un maestro
                </option>

                {
                  teachers.map(
                    teacher => (
                      <option
                        key={teacher.id}
                        value={teacher.id}
                      >
                        {teacher.name}
                      </option>
                    )
                  )
                }

              </select>
            </label>


            {
              assignmentMessage &&
              (
                <div className="alert success">
                  {assignmentMessage}
                </div>
              )
            }


            {
              assignmentError &&
              (
                <div className="alert error">
                  {assignmentError}
                </div>
              )
            }


            <button
              className="primary-button"
              type="submit"
            >
              <Save size={18} />
              Asignar materia
            </button>

          </form>


          {/* ALUMNOS Y MATERIAS */}

          <section className="table-card assignments-card">

            <div className="section-title">

              <h3>
                Alumnos y materias
              </h3>

              <span>
                {students.length} alumnos
              </span>

            </div>


            <div className="assignment-list">

              {
                students.map(
                  student => {
                    const assignment =
                      academicService
                        .getStudentAssignment(
                          student.id
                        )

                    return (
                      <article
                        key={student.id}
                        className="assignment-row expanded-assignment"
                      >

                        <div className="avatar small">
                          <GraduationCap size={20} />
                        </div>


                        <div className="assignment-info">

                          <strong>
                            {student.name}
                          </strong>

                          <small>
                            {student.email}
                          </small>


                          {
                            assignment
                              ? (
                                  <div className="student-subject-assignment-list">

                                    {
                                      assignment
                                        .subjects
                                        .map(
                                          subject => (
                                            <div
                                              key={subject.id}
                                              className="student-subject-assignment"
                                            >

                                              <span>
                                                <b>
                                                  {subject.name}
                                                </b>

                                                <small>
                                                  {
                                                    assignment
                                                      .subjectTeachers
                                                      ?.[subject.id]
                                                      ?.name ||
                                                    'Sin maestro'
                                                  }
                                                </small>
                                              </span>


                                              <button
                                                type="button"
                                                className="icon-button danger-icon tiny"
                                                disabled={
                                                  subject.source ===
                                                  'google-classroom'
                                                }
                                                title={
                                                  subject.source ===
                                                  'google-classroom'
                                                    ? 'La matrícula se sincroniza desde Classroom'
                                                    : 'Quitar materia'
                                                }
                                                onClick={
                                                  () =>
                                                    removeStudentSubject(
                                                      student,
                                                      subject
                                                    )
                                                }
                                              >
                                                <Trash2 size={14} />
                                              </button>

                                            </div>
                                          )
                                        )
                                    }

                                  </div>
                                )
                              : (
                                  <span className="unassigned">
                                    Sin materias asignadas
                                  </span>
                                )
                          }

                        </div>

                      </article>
                    )
                  }
                )
              }


              {
                !students.length &&
                (
                  <div className="empty-state">
                    Todavía no hay alumnos registrados.
                  </div>
                )
              }

            </div>

          </section>

        </div>

      </section>

    </Layout>
  )
}