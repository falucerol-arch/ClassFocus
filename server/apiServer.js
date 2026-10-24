\import 'dotenv/config'
import 'express-async-errors'
import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import { initializeDatabase, pool, withTransaction } from './database.js'
import { pathToFileURL } from 'node:url'
import { createSessionAuth, requireRole } from './auth.js'
import { HttpError } from './errors.js'
import { createClassroomRouter } from './classroom/router.js'

const VALID_ROLES = new Set([
  'student',
  'teacher',
  'admin'
])

export function createApp({
  db = pool,
  transaction = withTransaction,
  classroomOptions = {}
} = {}) {
  const app = express()

  const auth = createSessionAuth(db)

  const frontendOrigin = new URL(
    process.env.FRONTEND_URL ||
    'http://localhost:5173'
  ).origin

  app.use(
    cors({
      origin: frontendOrigin,
      credentials: true
    })
  )

  app.use(
    express.json({
      limit: '3mb'
    })
  )

  app.use(
    '/api',
    (_req, res, next) => {
      res.set(
        'Cache-Control',
        'no-store'
      )

      next()
    }
  )

  // =========================================================
  // HELPERS
  // =========================================================

  const normalizeRoles = user => {
    const values =
      Array.isArray(user?.roles)
        ? user.roles
        : [user?.role]

    const roles = [
      ...new Set(
        values
          .map(role =>
            String(role || '')
              .trim()
          )
          .filter(role =>
            VALID_ROLES.has(role)
          )
      )
    ]

    if (!roles.length) {
      throw new HttpError(
        400,
        'El usuario debe tener al menos un rol válido.'
      )
    }

    return roles
  }

  const mapUser = row => {
    const roles =
      Array.isArray(row.roles)
        ? row.roles
        : row.role
          ? [row.role]
          : []

    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      roles,

      source:
        row.source ||
        'classfocus'
    }
  }

  const mapSubject = row => ({
    id: row.id,
    name: row.name,
    code: row.code,
    section: row.section || '',
    schedule: row.schedule || '',

    defaultTeacherId:
      row.default_teacher_id,

    source:
      row.source ||
      'classfocus',

    classroomId:
      row.classroom_id ||
      undefined,

    classroomUrl:
      row.classroom_url ||
      '',

    courseWork:
      row.course_work ||
      [],

    classroomSyncedAt:
      row.classroom_synced_at,

    classroomTeachers:
      row.classroom_teachers ||
      []
  })

  const mapExam = row => ({
    id: row.id,

    teacherId:
      row.teacher_id,

    subjectId:
      row.subject_id,

    title:
      row.title,

    instructions:
      row.instructions ||
      '',

    durationMinutes:
      row.duration_minutes,

    formUrl:
      row.form_url ||
      '',

    status:
      row.status,

    createdAt:
      row.created_at
        ?.toISOString?.() ||
      row.created_at,

    updatedAt:
      row.updated_at
        ?.toISOString?.() ||
      row.updated_at
  })

  // =========================================================
  // HEALTH
  // =========================================================

  app.get(
    '/api/health',
    async (_req, res) => {
      try {
        const result =
          await db.query(
            `
            SELECT
              NOW() AS now,
              current_database() AS database
            `
          )

        res.json({
          ok: true,

          database:
            result.rows[0].database,

          time:
            result.rows[0].now
        })
      } catch {
        res
          .status(503)
          .json({
            ok: false,

            error:
              'PostgreSQL no está disponible.'
          })
      }
    }
  )

  // =========================================================
  // LOGIN MULTIRROL
  // =========================================================

  app.post(
    '/api/auth/login',
    async (req, res) => {
      const {
        email,
        password,
        role
      } = req.body || {}

      const result =
        await db.query(
          `
          SELECT
            u.id,
            u.name,
            u.email,
            u.password_hash,
            u.role,
            u.source,

            COALESCE(
              (
                SELECT ARRAY_AGG(
                  ur.role
                  ORDER BY ur.role
                )

                FROM user_roles ur

                WHERE
                  ur.user_id = u.id
              ),

              ARRAY[u.role]::varchar[]
            ) AS roles

          FROM users u

          WHERE
            LOWER(u.email) =
            LOWER($1)

          LIMIT 1
          `,
          [
            String(
              email ||
              ''
            ).trim()
          ]
        )

      const user =
        result.rows[0]

      if (
        !user ||
        !(
          await bcrypt.compare(
            password || '',
            user.password_hash
          )
        )
      ) {
        return res
          .status(401)
          .json({
            message:
              'Correo o contraseña incorrectos.'
          })
      }

      const userRoles =
        Array.isArray(user.roles)
          ? user.roles
          : [user.role]

      let selectedRole =
        role
          ? String(role)
          : null

      if (selectedRole) {
        if (
          !userRoles.includes(
            selectedRole
          )
        ) {
          return res
            .status(401)
            .json({
              message:
                'Este usuario no tiene asignado ese perfil.',

              roles:
                userRoles
            })
        }
      } else {
        if (
          userRoles.length === 1
        ) {
          selectedRole =
            userRoles[0]
        } else {
          return res
            .status(409)
            .json({
              message:
                'Selecciona el perfil con el que deseas entrar.',

              requiresRoleSelection:
                true,

              roles:
                userRoles,

              user: {
                id:
                  user.id,

                name:
                  user.name,

                email:
                  user.email,

                roles:
                  userRoles,

                source:
                  user.source
              }
            })
        }
      }

      const token =
        await auth.issue(
          user.id,
          selectedRole
        )

      res.json({
        user: {
          ...mapUser(user),

          role:
            selectedRole,

          roles:
            userRoles
        },

        token
      })
    }
  )

  // =========================================================
  // GOOGLE CLASSROOM
  // =========================================================

  app.use(
    '/api/classroom',
    createClassroomRouter({
      db,
      transaction,
      auth,
      ...classroomOptions
    })
  )

  app.use(
    '/api',
    auth.requireUser
  )

  // =========================================================
  // SESIÓN
  // =========================================================

  app.get(
    '/api/auth/me',
    (req, res) => {
      res.json({
        user:
          mapUser(req.user)
      })
    }
  )

  // =========================================================
  // CAMBIAR PERFIL ACTIVO
  // =========================================================

  app.post(
    '/api/auth/switch-role',
    async (req, res) => {
      const role =
        String(
          req.body?.role ||
          ''
        )

      if (
        !VALID_ROLES.has(role)
      ) {
        throw new HttpError(
          400,
          'Perfil inválido.'
        )
      }

      if (
        !req.user.roles.includes(
          role
        )
      ) {
        throw new HttpError(
          403,
          'No tienes asignado ese perfil.'
        )
      }

      const match =
        /^Bearer ([A-Za-z0-9_-]{43})$/
          .exec(
            req.headers
              .authorization ||
            ''
          )

      if (!match) {
        throw new HttpError(
          401,
          'Inicia sesión nuevamente.'
        )
      }

      await auth.switchRole(
        match[1],
        role
      )

      res.json({
        ok: true,

        user: {
          ...mapUser(req.user),
          role
        }
      })
    }
  )

  // =========================================================
  // LOGOUT
  // =========================================================

  app.post(
    '/api/auth/logout',
    async (req, res) => {
      await db.query(
        `
        DELETE FROM app_sessions
        WHERE token_hash=$1
        `,
        [
          req.user.token_hash
        ]
      )

      res.json({
        ok: true
      })
    }
  )

  // =========================================================
  // VALIDACIÓN DE MAESTRO
  // =========================================================

  const canTeach =
    async (
      user,
      subjectId
    ) => {
      if (
        user.role ===
        'admin'
      ) {
        return true
      }

      if (
        user.role !==
        'teacher'
      ) {
        return false
      }

      const result =
        await db.query(
          `
          SELECT id

          FROM subjects

          WHERE id=$1

          AND (
            default_teacher_id=$2

            OR EXISTS (
              SELECT 1

              FROM enrollments

              WHERE
                subject_id=$1

              AND
                teacher_id=$2
            )
          )
          `,
          [
            subjectId,
            user.id
          ]
        )

      return Boolean(
        result.rowCount
      )
    }

  // =========================================================
  // BOOTSTRAP
  // =========================================================

  app.get(
    '/api/bootstrap',
    async (req, res) => {
      const metricScope =
        req.user.role ===
        'admin'

          ? 'TRUE'

          : req.user.role ===
            'student'

            ? 'student_id=$1'

            : `
              subject_id IN (
                SELECT id
                FROM subjects
                WHERE default_teacher_id=$1

                UNION

                SELECT subject_id
                FROM enrollments
                WHERE teacher_id=$1
              )
            `

      const metricParams =
        req.user.role ===
        'admin'

          ? []

          : [
              req.user.id
            ]

      const [
        usersResult,
        subjectsResult,
        enrollmentsResult,
        examsResult,
        incidentsResult,
        samplesResult
      ] =
        await Promise.all([
          db.query(
            `
            SELECT
              u.id,
              u.name,
              u.email,
              u.role,
              u.source,

              COALESCE(
                (
                  SELECT ARRAY_AGG(
                    ur.role
                    ORDER BY ur.role
                  )

                  FROM user_roles ur

                  WHERE
                    ur.user_id = u.id
                ),

                ARRAY[u.role]::varchar[]
              ) AS roles

            FROM users u

            ORDER BY
              u.id
            `
          ),

          db.query(
            `
            SELECT *
            FROM subjects
            ORDER BY name
            `
          ),

          db.query(
            `
            SELECT
              student_id,
              teacher_id,
              subject_id

            FROM enrollments

            ORDER BY
              student_id,
              teacher_id
            `
          ),

          db.query(
            `
            SELECT *
            FROM exams
            ORDER BY created_at DESC
            `
          ),

          db.query(
            `
            SELECT *
            FROM incidents

            WHERE
              ${metricScope}

            ORDER BY
              occurred_at DESC

            LIMIT 1000
            `,
            metricParams
          ),

          db.query(
            `
            SELECT *
            FROM attention_samples

            WHERE
              ${metricScope}

            ORDER BY
              captured_at DESC

            LIMIT 2500
            `,
            metricParams
          )
        ])

      const user =
        req.user

      const allowedSubjects =
        new Set(
          subjectsResult.rows
            .filter(
              subject =>
                user.role ===
                  'admin' ||

                (
                  user.role ===
                    'teacher' &&

                  Number(
                    subject.default_teacher_id
                  ) ===
                    user.id
                ) ||

                enrollmentsResult.rows.some(
                  row =>
                    row.subject_id ===
                      subject.id &&

                    (
                      user.role ===
                      'teacher'

                        ? row.teacher_id ===
                          user.id

                        : row.student_id ===
                          user.id
                    )
                )
            )
            .map(
              subject =>
                subject.id
            )
        )

      const enrollments =
        enrollmentsResult.rows
          .filter(
            row =>
              allowedSubjects.has(
                row.subject_id
              ) &&

              (
                user.role !==
                  'student' ||

                row.student_id ===
                  user.id
              )
          )

      const visibleUsers =
        new Set([
          user.id
        ])

      enrollments.forEach(
        row => {
          visibleUsers.add(
            row.student_id
          )

          visibleUsers.add(
            row.teacher_id
          )
        }
      )

      subjectsResult.rows
        .filter(
          row =>
            allowedSubjects.has(
              row.id
            )
        )
        .forEach(
          row => {
            if (
              row.default_teacher_id
            ) {
              visibleUsers.add(
                row.default_teacher_id
              )
            }
          }
        )

      const ownMetric =
        row =>
          user.role ===
            'admin' ||

          (
            allowedSubjects.has(
              row.subject_id
            ) &&

            (
              user.role !==
                'student' ||

              row.student_id ===
                user.id
            )
          )

      const grouped =
        new Map()

      for (
        const row
        of enrollments
      ) {
        const key =
          `${row.student_id}:${row.teacher_id}`

        const item =
          grouped.get(key) ||
          {
            studentId:
              row.student_id,

            teacherId:
              row.teacher_id,

            subjectIds: []
          }

        item.subjectIds.push(
          row.subject_id
        )

        grouped.set(
          key,
          item
        )
      }

      res.json({
        academic: {
          users:
            usersResult.rows
              .filter(
                row =>
                  user.role ===
                    'admin' ||

                  visibleUsers.has(
                    row.id
                  )
              )
              .map(
                mapUser
              ),

          subjects:
            subjectsResult.rows
              .filter(
                row =>
                  allowedSubjects.has(
                    row.id
                  )
              )
              .map(
                mapSubject
              ),

          assignments:
            [
              ...grouped.values()
            ]
        },

        exams:
          examsResult.rows
            .filter(
              row =>
                user.role ===
                  'admin' ||

                (
                  allowedSubjects.has(
                    row.subject_id
                  ) &&

                  (
                    user.role ===
                    'teacher'

                      ? row.teacher_id ===
                        user.id

                      : row.status ===
                        'published'
                  )
                )
            )
            .map(
              mapExam
            ),

        incidents:
          incidentsResult.rows
            .filter(
              ownMetric
            )
            .map(
              row => ({
                id:
                  String(row.id),

                studentId:
                  row.student_id,

                subjectId:
                  row.subject_id,

                examId:
                  row.exam_id,

                type:
                  row.type,

                message:
                  row.message,

                severity:
                  row.severity,

                timestamp:
                  row.occurred_at
                    ?.toISOString?.() ||
                  row.occurred_at
              })
            ),

        samples:
          samplesResult.rows
            .filter(
              ownMetric
            )
            .map(
              row => ({
                id:
                  String(row.id),

                studentId:
                  row.student_id,

                subjectId:
                  row.subject_id,

                attention:
                  Number(
                    row.attention
                  ),

                expression:
                  row.expression,

                gaze:
                  row.gaze,

                label:
                  row.label,

                timestamp:
                  row.captured_at
                    ?.toISOString?.() ||
                  row.captured_at
              })
            )
      })
    }
  )

  // =========================================================
  // DATOS ACADÉMICOS / SUPER ADMIN
  // =========================================================

  app.put(
    '/api/academic',
    requireRole('admin'),
    async (req, res) => {
      const {
        users = [],
        subjects = [],
        assignments = []
      } =
        req.body || {}

      if (
        ![
          users,
          subjects,
          assignments
        ].every(
          Array.isArray
        )
      ) {
        throw new HttpError(
          400,
          'Datos académicos no válidos.'
        )
      }

      await transaction(
        async client => {
          await client.query(
            `
            SELECT
              pg_advisory_xact_lock(
                hashtext(
                  'classfocus-classroom-import'
                )
              )
            `
          )

          const imported =
            await client.query(
              `
              SELECT id
              FROM subjects
              WHERE source='google-classroom'
              `
            )

          const importedIds =
            new Set(
              imported.rows.map(
                row =>
                  row.id
              )
            )

          const existing =
            await client.query(
              `
              SELECT
                id,
                email,
                password_hash,
                source,
                role

              FROM users
              `
            )

          const existingById =
            new Map()

          const existingByEmail =
            new Map()

          const passwordById =
            new Map()

          for (
            const row
            of existing.rows
          ) {
            existingById.set(
              Number(row.id),
              row
            )

            existingByEmail.set(
              String(row.email)
                .trim()
                .toLowerCase(),
              row
            )

            passwordById.set(
              Number(row.id),
              row.password_hash
            )
          }

          const defaultHash =
            await bcrypt.hash(
              '123456',
              10
            )

          const resolvedUserIds =
            new Map()

          for (
            const incomingUser
            of users
          ) {
            const name =
              String(
                incomingUser.name ||
                ''
              ).trim()

            const email =
              String(
                incomingUser.email ||
                ''
              ).trim()

            if (
              !name ||
              !email
            ) {
              throw new HttpError(
                400,
                'Nombre y correo son obligatorios.'
              )
            }

            const emailKey =
              email.toLowerCase()

            const incomingId =
              Number(
                incomingUser.id
              )

            const hasIncomingId =
              Number.isInteger(
                incomingId
              ) &&
              incomingId > 0

            const sameEmailUser =
              existingByEmail.get(
                emailKey
              )

            if (
              sameEmailUser?.source ===
              'google-classroom'
            ) {
              if (
                hasIncomingId
              ) {
                resolvedUserIds.set(
                  incomingId,
                  Number(
                    sameEmailUser.id
                  )
                )
              }

              continue
            }

            const roles =
              normalizeRoles(
                incomingUser
              )

            let primaryRole =
              String(
                incomingUser.role ||
                ''
              )

            if (
              !roles.includes(
                primaryRole
              )
            ) {
              if (
                roles.includes(
                  'admin'
                )
              ) {
                primaryRole =
                  'admin'
              } else if (
                roles.includes(
                  'teacher'
                )
              ) {
                primaryRole =
                  'teacher'
              } else {
                primaryRole =
                  roles[0]
              }
            }

            let actualId =
              sameEmailUser
                ? Number(
                    sameEmailUser.id
                  )
                : (
                    hasIncomingId
                      ? incomingId
                      : null
                  )

            const existingAtId =
              actualId
                ? existingById.get(
                    actualId
                  )
                : null

            if (actualId) {
              const passwordHash =
                passwordById.get(
                  actualId
                ) ||
                defaultHash

              await client.query(
                `
                INSERT INTO users (
                  id,
                  name,
                  email,
                  password_hash,
                  role,
                  source
                )

                VALUES (
                  $1,
                  $2,
                  $3,
                  $4,
                  $5,
                  $6
                )

                ON CONFLICT (id)

                DO UPDATE SET
                  name =
                    EXCLUDED.name,

                  email =
                    EXCLUDED.email,

                  role =
                    EXCLUDED.role,

                  source =
                    EXCLUDED.source,

                  updated_at =
                    NOW()
                `,
                [
                  actualId,
                  name,
                  email,
                  passwordHash,
                  primaryRole,

                  incomingUser.source ||
                  existingAtId?.source ||
                  sameEmailUser?.source ||
                  'classfocus'
                ]
              )
            } else {
              const created =
                await client.query(
                  `
                  INSERT INTO users (
                    name,
                    email,
                    password_hash,
                    role,
                    source
                  )

                  VALUES (
                    $1,
                    $2,
                    $3,
                    $4,
                    $5
                  )

                  RETURNING id
                  `,
                  [
                    name,
                    email,
                    defaultHash,
                    primaryRole,

                    incomingUser.source ||
                    'classfocus'
                  ]
                )

              actualId =
                Number(
                  created.rows[0].id
                )
            }

            if (
              hasIncomingId
            ) {
              resolvedUserIds.set(
                incomingId,
                actualId
              )
            }

            await client.query(
              `
              DELETE FROM user_roles
              WHERE user_id=$1
              `,
              [
                actualId
              ]
            )

            for (
              const role
              of roles
            ) {
              await client.query(
                `
                INSERT INTO user_roles (
                  user_id,
                  role
                )

                VALUES (
                  $1,
                  $2
                )

                ON CONFLICT (
                  user_id,
                  role
                )

                DO NOTHING
                `,
                [
                  actualId,
                  role
                ]
              )
            }

            const updatedRow = {
              id:
                actualId,

              email,

              password_hash:
                passwordById.get(
                  actualId
                ) ||
                defaultHash,

              source:
                incomingUser.source ||
                'classfocus',

              role:
                primaryRole
            }

            existingById.set(
              actualId,
              updatedRow
            )

            existingByEmail.set(
              emailKey,
              updatedRow
            )

            passwordById.set(
              actualId,
              updatedRow.password_hash
            )
          }

          await client.query(
            `
            SELECT setval(
              pg_get_serial_sequence(
                'users',
                'id'
              ),

              GREATEST(
                (
                  SELECT
                    COALESCE(
                      MAX(id),
                      1
                    )

                  FROM users
                ),

                1
              ),

              true
            )
            `
          )

          const incomingSubjectIds =
            subjects
              .filter(
                subject =>
                  !importedIds.has(
                    subject.id
                  ) &&

                  subject.source !==
                  'google-classroom'
              )
              .map(
                subject =>
                  subject.id
              )

          if (
            incomingSubjectIds.length
          ) {
            await client.query(
              `
              DELETE FROM subjects

              WHERE
                source <>
                'google-classroom'

              AND NOT (
                id =
                ANY($1::text[])
              )
              `,
              [
                incomingSubjectIds
              ]
            )
          } else {
            await client.query(
              `
              DELETE FROM subjects

              WHERE
                source <>
                'google-classroom'
              `
            )
          }

          for (
            const subject
            of subjects
          ) {
            if (
              importedIds.has(
                subject.id
              ) ||

              subject.source ===
              'google-classroom'
            ) {
              continue
            }

            // =================================================
            // CORRECCIÓN:
            // sin maestro = NULL, nunca ID 0
            // =================================================

            const rawTeacherId =
              subject.defaultTeacherId

            const incomingTeacherId =
              rawTeacherId === null ||
              rawTeacherId === undefined ||
              rawTeacherId === ''
                ? null
                : Number(
                    rawTeacherId
                  )

            const resolvedTeacherId =
              incomingTeacherId &&
              Number.isInteger(
                incomingTeacherId
              ) &&
              incomingTeacherId > 0
                ? (
                    resolvedUserIds.get(
                      incomingTeacherId
                    ) ||
                    incomingTeacherId
                  )
                : null

            await client.query(
              `
              INSERT INTO subjects (
                id,
                name,
                code,
                section,
                schedule,
                default_teacher_id,
                source,
                classroom_id,
                classroom_url,
                course_work,
                updated_at
              )

              VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10::jsonb,
                NOW()
              )

              ON CONFLICT (id)

              DO UPDATE SET
                name =
                  EXCLUDED.name,

                code =
                  EXCLUDED.code,

                section =
                  EXCLUDED.section,

                schedule =
                  EXCLUDED.schedule,

                default_teacher_id =
                  EXCLUDED.default_teacher_id,

                source =
                  EXCLUDED.source,

                classroom_id =
                  EXCLUDED.classroom_id,

                classroom_url =
                  EXCLUDED.classroom_url,

                course_work =
                  EXCLUDED.course_work,

                updated_at =
                  NOW()
              `,
              [
                subject.id,
                subject.name,
                subject.code,

                subject.section ||
                '',

                subject.schedule ||
                '',

                resolvedTeacherId,

                subject.source ||
                'classfocus',

                subject.classroomId ||
                null,

                subject.classroomUrl ||
                '',

                JSON.stringify(
                  subject.courseWork ||
                  []
                )
              ]
            )
          }

          await client.query(
            `
            DELETE FROM enrollments

            WHERE subject_id IN (
              SELECT id
              FROM subjects
              WHERE source <>
              'google-classroom'
            )
            `
          )

          for (
            const assignment
            of assignments
          ) {
            const incomingStudentId =
              Number(
                assignment.studentId
              )

            const incomingTeacherId =
              Number(
                assignment.teacherId
              )

            const studentId =
              resolvedUserIds.get(
                incomingStudentId
              ) ||
              incomingStudentId

            const teacherId =
              resolvedUserIds.get(
                incomingTeacherId
              ) ||
              incomingTeacherId

            for (
              const subjectId
              of assignment.subjectIds ||
              []
            ) {
              if (
                importedIds.has(
                  subjectId
                )
              ) {
                continue
              }

              await client.query(
                `
                INSERT INTO enrollments (
                  student_id,
                  teacher_id,
                  subject_id
                )

                VALUES (
                  $1,
                  $2,
                  $3
                )

                ON CONFLICT (
                  student_id,
                  subject_id
                )

                DO UPDATE SET
                  teacher_id =
                    EXCLUDED.teacher_id
                `,
                [
                  studentId,
                  teacherId,
                  subjectId
                ]
              )
            }
          }
        }
      )

      res.json({
        ok: true
      })
    }
  )

  // =========================================================
  // EXÁMENES
  // =========================================================

  app.put(
    '/api/exams',
    requireRole(
      'teacher',
      'admin'
    ),
    async (req, res) => {
      if (
        !Array.isArray(
          req.body?.exams
        )
      ) {
        throw new HttpError(
          400,
          'La lista de evaluaciones es obligatoria.'
        )
      }

      const exams =
        req.body.exams

      for (
        const exam
        of exams
      ) {
        if (
          req.user.role !==
            'admin' &&

          Number(
            exam.teacherId
          ) !==
            req.user.id
        ) {
          throw new HttpError(
            403,
            'Solo puedes modificar tus evaluaciones.'
          )
        }

        if (
          !(
            await canTeach(
              req.user,
              exam.subjectId
            )
          )
        ) {
          throw new HttpError(
            403,
            'La materia no está asignada a tu usuario.'
          )
        }

        const existing =
          await db.query(
            `
            SELECT teacher_id
            FROM exams
            WHERE id=$1
            `,
            [
              exam.id
            ]
          )

        if (
          existing.rows[0] &&

          req.user.role !==
            'admin' &&

          existing.rows[0]
            .teacher_id !==
            req.user.id
        ) {
          throw new HttpError(
            403,
            'La evaluación pertenece a otro docente.'
          )
        }
      }

      await transaction(
        async client => {
          const ids =
            exams.map(
              exam =>
                exam.id
            )

          if (
            req.user.role ===
            'admin'
          ) {
            await client.query(
              `
              DELETE FROM exams

              WHERE NOT (
                id =
                ANY($1::text[])
              )
              `,
              [
                ids
              ]
            )
          } else {
            await client.query(
              `
              DELETE FROM exams

              WHERE teacher_id=$1

              AND NOT (
                id =
                ANY($2::text[])
              )
              `,
              [
                req.user.id,
                ids
              ]
            )
          }

          for (
            const exam
            of exams
          ) {
            const saved =
              await client.query(
                `
                INSERT INTO exams (
                  id,
                  teacher_id,
                  subject_id,
                  title,
                  instructions,
                  duration_minutes,
                  form_url,
                  status,
                  created_at,
                  updated_at
                )

                VALUES (
                  $1,
                  $2,
                  $3,
                  $4,
                  $5,
                  $6,
                  $7,
                  $8,
                  $9,
                  $10
                )

                ON CONFLICT (id)

                DO UPDATE SET
                  teacher_id =
                    EXCLUDED.teacher_id,

                  subject_id =
                    EXCLUDED.subject_id,

                  title =
                    EXCLUDED.title,

                  instructions =
                    EXCLUDED.instructions,

                  duration_minutes =
                    EXCLUDED.duration_minutes,

                  form_url =
                    EXCLUDED.form_url,

                  status =
                    EXCLUDED.status,

                  updated_at =
                    EXCLUDED.updated_at

                WHERE
                  exams.teacher_id=$11

                OR $12
                `,
                [
                  exam.id,

                  Number(
                    exam.teacherId
                  ),

                  exam.subjectId,
                  exam.title,

                  exam.instructions ||
                  '',

                  Number(
                    exam.durationMinutes
                  ),

                  exam.formUrl ||
                  '',

                  exam.status,

                  exam.createdAt ||
                  new Date()
                    .toISOString(),

                  exam.updatedAt ||
                  new Date()
                    .toISOString(),

                  req.user.id,

                  req.user.role ===
                  'admin'
                ]
              )

            if (
              !saved.rowCount
            ) {
              throw new HttpError(
                403,
                'La evaluación pertenece a otro docente.'
              )
            }
          }
        }
      )

      res.json({
        ok: true
      })
    }
  )

  // =========================================================
  // VALIDACIÓN EVENTOS ALUMNO
  // =========================================================

  const validateStudentEvent =
    async (
      user,
      studentId,
      event
    ) => {
      if (
        Number(studentId) !==
        user.id
      ) {
        throw new HttpError(
          403,
          'Solo puedes registrar tus propios eventos.'
        )
      }

      const enrolled =
        await db.query(
          `
          SELECT 1

          FROM enrollments

          WHERE
            student_id=$1

          AND
            subject_id=$2
          `,
          [
            user.id,
            event.subjectId
          ]
        )

      if (
        !enrolled.rowCount
      ) {
        throw new HttpError(
          403,
          'La materia no está asignada a tu usuario.'
        )
      }

      if (
        event.examId
      ) {
        const exam =
          await db.query(
            `
            SELECT 1

            FROM exams

            WHERE
              id=$1

            AND
              subject_id=$2

            AND
              status='published'
            `,
            [
              event.examId,
              event.subjectId
            ]
          )

        if (
          !exam.rowCount
        ) {
          throw new HttpError(
            403,
            'La evaluación no está disponible para esta materia.'
          )
        }
      }
    }

  const SEVERITIES =
    new Set([
      'info',
      'low',
      'warning',
      'medium',
      'high'
    ])

  const clamp =
    (
      value,
      min,
      max
    ) =>
      Math.min(
        max,

        Math.max(
          min,

          Number.isFinite(
            Number(value)
          )
            ? Number(value)
            : min
        )
      )

  const shortText =
    (
      value,
      max
    ) =>
      String(
        value ??
        ''
      ).slice(
        0,
        max
      )

  // =========================================================
  // INCIDENTES
  // =========================================================

  app.post(
    '/api/incidents',
    requireRole(
      'student'
    ),
    async (req, res) => {
      const {
        studentId,
        incident = {}
      } =
        req.body || {}

      await validateStudentEvent(
        req.user,
        studentId,
        incident
      )

      const type =
        /^[a-z0-9-]{1,60}$/i
          .test(
            incident.type ||
            ''
          )
          ? incident.type
          : 'unknown'

      const severity =
        SEVERITIES.has(
          incident.severity
        )
          ? incident.severity
          : 'warning'

      const result =
        await db.query(
          `
          INSERT INTO incidents (
            student_id,
            subject_id,
            exam_id,
            type,
            message,
            severity,
            occurred_at
          )

          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            NOW()
          )

          RETURNING id
          `,
          [
            Number(
              studentId
            ),

            incident.subjectId ||
            null,

            incident.examId ||
            null,

            type,

            shortText(
              incident.message,
              300
            ),

            severity
          ]
        )

      res
        .status(201)
        .json({
          ok: true,

          id:
            String(
              result.rows[0].id
            )
        })
    }
  )

  // =========================================================
  // MUESTRAS DE ATENCIÓN
  // =========================================================

  app.post(
    '/api/samples',
    requireRole(
      'student'
    ),
    async (req, res) => {
      const {
        studentId,
        sample = {}
      } =
        req.body || {}

      await validateStudentEvent(
        req.user,
        studentId,
        sample
      )

      const result =
        await db.query(
          `
          INSERT INTO attention_samples (
            student_id,
            subject_id,
            attention,
            expression,
            gaze,
            label,
            captured_at
          )

          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            NOW()
          )

          RETURNING id
          `,
          [
            Number(
              studentId
            ),

            sample.subjectId ||
            null,

            clamp(
              sample.attention,
              0,
              100
            ),

            shortText(
              sample.expression ||
              'Neutral',
              80
            ),

            shortText(
              sample.gaze,
              80
            ),

            shortText(
              sample.label,
              80
            )
          ]
        )

      res
        .status(201)
        .json({
          ok: true,

          id:
            String(
              result.rows[0].id
            )
        })
    }
  )

  // =========================================================
  // ALERTAS EN VIVO
  // =========================================================

  app.get(
    '/api/incidents/live',
    requireRole(
      'teacher',
      'admin'
    ),
    async (req, res) => {
      const isAdmin =
        req.user.role ===
        'admin'

      const afterRaw =
        req.query.afterId

      const hasCursor =
        typeof afterRaw ===
          'string' &&

        /^\d{1,15}$/.test(
          afterRaw
        )

      const scope =
        isAdmin
          ? 'TRUE'
          : `
            i.subject_id IN (
              SELECT id
              FROM subjects
              WHERE default_teacher_id=$1

              UNION

              SELECT subject_id
              FROM enrollments
              WHERE teacher_id=$1
            )
          `

      const scopeParams =
        isAdmin
          ? []
          : [
              req.user.id
            ]

      if (
        !hasCursor
      ) {
        const last =
          await db.query(
            `
            SELECT
              COALESCE(
                MAX(i.id),
                0
              ) AS last

            FROM incidents i

            WHERE
              ${scope}
            `,
            scopeParams
          )

        return res.json({
          lastId:
            String(
              last.rows[0].last
            ),

          incidents: []
        })
      }

      const result =
        await db.query(
          `
          SELECT
            i.id,
            i.type,
            i.message,
            i.severity,
            i.occurred_at,
            i.student_id,

            u.name
              AS student_name,

            i.subject_id,

            s.name
              AS subject_name

          FROM incidents i

          JOIN users u
            ON u.id =
            i.student_id

          LEFT JOIN subjects s
            ON s.id =
            i.subject_id

          WHERE
            ${scope}

          AND
            i.id >
            $${scopeParams.length + 1}

          ORDER BY
            i.id ASC

          LIMIT 50
          `,
          [
            ...scopeParams,
            afterRaw
          ]
        )

      const incidents =
        result.rows.map(
          row => ({
            id:
              String(
                row.id
              ),

            type:
              row.type,

            message:
              row.message,

            severity:
              row.severity,

            timestamp:
              row.occurred_at
                ?.toISOString?.() ||
              row.occurred_at,

            studentId:
              row.student_id,

            studentName:
              row.student_name,

            subjectId:
              row.subject_id,

            subjectName:
              row.subject_name ||
              'General'
          })
        )

      res.json({
        lastId:
          incidents.length
            ? incidents.at(-1).id
            : afterRaw,

        incidents
      })
    }
  )

  // =========================================================
  // ERRORES
  // =========================================================

  app.use(
    (
      error,
      _req,
      res,
      _next
    ) => {
      const status =
        error instanceof HttpError
          ? error.status
          : 500

      if (
        status === 500
      ) {
        console.error(
          '[ClassFocus API] Error interno:',
          {
            code:
              error.code,

            message:
              error.message,

            detail:
              error.detail,

            constraint:
              error.constraint,

            table:
              error.table,

            schema:
              error.schema,

            column:
              error.column,

            routine:
              error.routine
          }
        )
      }

      res
        .status(status)
        .json({
          message:
            status === 500
              ? 'Error interno de ClassFocus API.'
              : error.message
        })
    }
  )

  return app
}

// =========================================================
// INICIO DEL SERVIDOR
// =========================================================

const wait =
  ms =>
    new Promise(
      resolve =>
        setTimeout(
          resolve,
          ms
        )
    )

async function start() {
  let lastError

  for (
    let attempt = 1;
    attempt <= 15;
    attempt += 1
  ) {
    try {
      await initializeDatabase()

      const port =
        Number(
          process.env.PORT ||
          process.env.API_PORT ||
          8788
        )

      const host =
        process.env.API_HOST ||
        '0.0.0.0'

      createApp().listen(
        port,
        host,
        () => {
          console.log(
            `ClassFocus API + PostgreSQL activa en puerto ${port}`
          )

          console.log(
            'Health check: /api/health'
          )
        }
      )

      return
    } catch (error) {
      lastError =
        error

      console.log(
        `PostgreSQL aún no responde (${attempt}/15): ${error.message}`
      )

      await wait(
        2000
      )
    }
  }

  console.error(
    'No se pudo iniciar PostgreSQL/API:',
    lastError?.message
  )

  console.error(
    'Revisa DATABASE_URL y las variables de entorno.'
  )

  process.exit(1)
}

// Permite importar la aplicación
// en pruebas sin abrir servidor.
if (
  process.argv[1] &&
  import.meta.url ===
    pathToFileURL(
      process.argv[1]
    ).href
) {
  start()
}