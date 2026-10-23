import 'dotenv/config'
import 'express-async-errors'
import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import { initializeDatabase, pool, withTransaction } from './database.js'
import { pathToFileURL } from 'node:url'
import { createSessionAuth, requireRole } from './auth.js'
import { HttpError } from './errors.js'
import { createClassroomRouter } from './classroom/router.js'

export function createApp({ db = pool, transaction = withTransaction, classroomOptions = {} } = {}) {
  const app = express()
  const auth = createSessionAuth(db)
  const frontendOrigin = new URL(process.env.FRONTEND_URL || 'http://localhost:5173').origin
  // La cookie del callback OAuth solo se acepta desde el frontend configurado.
  app.use(cors({ origin: frontendOrigin, credentials: true }))
  app.use(express.json({ limit: '3mb' }))
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })

  const mapUser = row => ({ id: row.id, name: row.name, email: row.email, role: row.role, source: row.source })
  const mapSubject = row => ({
    id: row.id,
    name: row.name,
    code: row.code,
    section: row.section || '',
    schedule: row.schedule || '',
    defaultTeacherId: row.default_teacher_id,
    source: row.source || 'classfocus',
    classroomId: row.classroom_id || undefined,
    classroomUrl: row.classroom_url || '',
    courseWork: row.course_work || [],
    classroomSyncedAt: row.classroom_synced_at,
    classroomTeachers: row.classroom_teachers || []
  })
  const mapExam = row => ({
    id: row.id,
    teacherId: row.teacher_id,
    subjectId: row.subject_id,
    title: row.title,
    instructions: row.instructions || '',
    durationMinutes: row.duration_minutes,
    formUrl: row.form_url || '',
    status: row.status,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at
  })

  app.get('/api/health', async (_req, res) => {
    try {
      const result = await db.query('SELECT NOW() AS now, current_database() AS database')
      res.json({ ok: true, database: result.rows[0].database, time: result.rows[0].now })
    } catch {
      res.status(503).json({ ok: false, error: 'PostgreSQL no está disponible.' })
    }
  })

  app.post('/api/auth/login', async (req, res) => {
    const { email, password, role } = req.body || {}
    const result = await db.query('SELECT * FROM users WHERE LOWER(email)=LOWER($1) AND role=$2 LIMIT 1', [email || '', role || ''])
    const user = result.rows[0]
    if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
      return res.status(401).json({ message: 'Credenciales incorrectas o rol inválido.' })
    }
    const token = await auth.issue(user.id)
    res.json({ user: mapUser(user), token })
  })

  // Classroom tiene callback público validado y el resto de sus rutas exige sesión.
  app.use('/api/classroom', createClassroomRouter({ db, transaction, auth, ...classroomOptions }))
  app.use('/api', auth.requireUser)
  app.get('/api/auth/me', (req, res) => res.json({ user: mapUser(req.user) }))
  app.post('/api/auth/logout', async (req, res) => {
    await db.query('DELETE FROM app_sessions WHERE token_hash=$1', [req.user.token_hash])
    res.json({ ok: true })
  })

  const canTeach = async (user, subjectId) => {
    if (user.role === 'admin') return true
    if (user.role !== 'teacher') return false
    const result = await db.query(`SELECT id FROM subjects WHERE id=$1 AND
      (default_teacher_id=$2 OR EXISTS (SELECT 1 FROM enrollments WHERE subject_id=$1 AND teacher_id=$2))`, [subjectId, user.id])
    return Boolean(result.rowCount)
  }

  app.get('/api/bootstrap', async (req, res) => {
    const metricScope = req.user.role === 'admin' ? 'TRUE' : req.user.role === 'student' ? 'student_id=$1' : `subject_id IN (SELECT id FROM subjects WHERE default_teacher_id=$1 UNION SELECT subject_id FROM enrollments WHERE teacher_id=$1)`
    const metricParams = req.user.role === 'admin' ? [] : [req.user.id]
    const [usersResult, subjectsResult, enrollmentsResult, examsResult, incidentsResult, samplesResult] = await Promise.all([
      db.query('SELECT id,name,email,role,source FROM users ORDER BY id'),
      db.query('SELECT * FROM subjects ORDER BY name'),
      db.query('SELECT student_id,teacher_id,subject_id FROM enrollments ORDER BY student_id,teacher_id'),
      db.query('SELECT * FROM exams ORDER BY created_at DESC'),
      db.query(`SELECT * FROM incidents WHERE ${metricScope} ORDER BY occurred_at DESC LIMIT 1000`, metricParams),
      db.query(`SELECT * FROM attention_samples WHERE ${metricScope} ORDER BY captured_at DESC LIMIT 2500`, metricParams)
    ])

    // Los paneles reciben solo sus materias y participantes. El rol se toma de la sesión.
    const user = req.user
    const allowedSubjects = new Set(subjectsResult.rows.filter(subject => user.role === 'admin'
      || (user.role === 'teacher' && Number(subject.default_teacher_id) === user.id)
      || enrollmentsResult.rows.some(row => row.subject_id === subject.id
        && (user.role === 'teacher' ? row.teacher_id === user.id : row.student_id === user.id)))
      .map(subject => subject.id))
    const enrollments = enrollmentsResult.rows.filter(row => allowedSubjects.has(row.subject_id)
      && (user.role !== 'student' || row.student_id === user.id))
    const visibleUsers = new Set([user.id])
    enrollments.forEach(row => { visibleUsers.add(row.student_id); visibleUsers.add(row.teacher_id) })
    subjectsResult.rows.filter(row => allowedSubjects.has(row.id)).forEach(row => visibleUsers.add(row.default_teacher_id))
    const ownMetric = row => user.role === 'admin' || (allowedSubjects.has(row.subject_id)
      && (user.role !== 'student' || row.student_id === user.id))

    const grouped = new Map()
    for (const row of enrollments) {
      const key = `${row.student_id}:${row.teacher_id}`
      const item = grouped.get(key) || { studentId: row.student_id, teacherId: row.teacher_id, subjectIds: [] }
      item.subjectIds.push(row.subject_id)
      grouped.set(key, item)
    }

    res.json({
      academic: {
        users: usersResult.rows.filter(row => user.role === 'admin' || visibleUsers.has(row.id)).map(mapUser),
        subjects: subjectsResult.rows.filter(row => allowedSubjects.has(row.id)).map(mapSubject),
        assignments: [...grouped.values()]
      },
      exams: examsResult.rows.filter(row => user.role === 'admin' || (allowedSubjects.has(row.subject_id) && (user.role === 'teacher' ? row.teacher_id === user.id : row.status === 'published'))).map(mapExam),
      incidents: incidentsResult.rows.filter(ownMetric).map(row => ({
        id: String(row.id), studentId: row.student_id, subjectId: row.subject_id, examId: row.exam_id,
        type: row.type, message: row.message, severity: row.severity,
        timestamp: row.occurred_at?.toISOString?.() || row.occurred_at
      })),
      samples: samplesResult.rows.filter(ownMetric).map(row => ({
        id: String(row.id), studentId: row.student_id, subjectId: row.subject_id,
        attention: Number(row.attention), expression: row.expression, gaze: row.gaze,
        label: row.label, timestamp: row.captured_at?.toISOString?.() || row.captured_at
      }))
    })
  })

  app.put('/api/academic', requireRole('admin'), async (req, res) => {
    const { users = [], subjects = [], assignments = [] } = req.body || {}
    if (![users, subjects, assignments].every(Array.isArray)) throw new HttpError(400, 'Datos académicos no válidos.')
    await transaction(async client => {
      // Comparte el bloqueo con el importador para proteger también guardados concurrentes.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('classfocus-classroom-import'))")
      // Una pestaña antigua del admin no debe sobrescribir las matrículas importadas.
      const imported = await client.query("SELECT id FROM subjects WHERE source='google-classroom'")
      const importedIds = new Set(imported.rows.map(row => row.id))
      const existing = await client.query('SELECT id,email,password_hash,source FROM users')
      const importedUsers = new Set(existing.rows.filter(row => row.source === 'google-classroom').map(row => Number(row.id)))
      const passwordById = new Map(existing.rows.map(row => [Number(row.id), row.password_hash]))
      const defaultHash = await bcrypt.hash('123456', 10)

      for (const user of users) {
        if (importedUsers.has(Number(user.id))) continue
        await client.query(
          `INSERT INTO users (id,name,email,password_hash,role,source)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,role=EXCLUDED.role,source=EXCLUDED.source,updated_at=NOW()`,
          [Number(user.id), user.name, user.email, passwordById.get(Number(user.id)) || defaultHash, user.role, user.source || 'classfocus']
        )
      }
      await client.query(`SELECT setval(pg_get_serial_sequence('users','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM users), 1), true)`)

      const incomingSubjectIds = subjects.filter(subject => !importedIds.has(subject.id) && subject.source !== 'google-classroom').map(subject => subject.id)
      if (incomingSubjectIds.length) await client.query("DELETE FROM subjects WHERE source<>'google-classroom' AND NOT (id = ANY($1::text[]))", [incomingSubjectIds])
      else await client.query("DELETE FROM subjects WHERE source<>'google-classroom'")

      for (const subject of subjects) {
        if (importedIds.has(subject.id) || subject.source === 'google-classroom') continue
        await client.query(
          `INSERT INTO subjects (id,name,code,section,schedule,default_teacher_id,source,classroom_id,classroom_url,course_work,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW())
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,code=EXCLUDED.code,section=EXCLUDED.section,schedule=EXCLUDED.schedule,
           default_teacher_id=EXCLUDED.default_teacher_id,source=EXCLUDED.source,classroom_id=EXCLUDED.classroom_id,
           classroom_url=EXCLUDED.classroom_url,course_work=EXCLUDED.course_work,updated_at=NOW()`,
          [subject.id, subject.name, subject.code, subject.section || '', subject.schedule || '', subject.defaultTeacherId || null,
            subject.source || 'classfocus', subject.classroomId || null, subject.classroomUrl || '', JSON.stringify(subject.courseWork || [])]
        )
      }

      await client.query("DELETE FROM enrollments WHERE subject_id IN (SELECT id FROM subjects WHERE source<>'google-classroom')")
      for (const assignment of assignments) {
        for (const subjectId of assignment.subjectIds || []) {
          if (importedIds.has(subjectId)) continue
          await client.query(
            `INSERT INTO enrollments (student_id,teacher_id,subject_id) VALUES ($1,$2,$3)
             ON CONFLICT (student_id,subject_id) DO UPDATE SET teacher_id=EXCLUDED.teacher_id`,
            [Number(assignment.studentId), Number(assignment.teacherId), subjectId]
          )
        }
      }
    })
    res.json({ ok: true })
  })

  app.put('/api/exams', requireRole('teacher', 'admin'), async (req, res) => {
    if (!Array.isArray(req.body?.exams)) throw new HttpError(400, 'La lista de evaluaciones es obligatoria.')
    const exams = req.body.exams
    for (const exam of exams) {
      if (req.user.role !== 'admin' && Number(exam.teacherId) !== req.user.id) throw new HttpError(403, 'Solo puedes modificar tus evaluaciones.')
      if (!(await canTeach(req.user, exam.subjectId))) throw new HttpError(403, 'La materia no está asignada a tu usuario.')
      const existing = await db.query('SELECT teacher_id FROM exams WHERE id=$1', [exam.id])
      if (existing.rows[0] && req.user.role !== 'admin' && existing.rows[0].teacher_id !== req.user.id) throw new HttpError(403, 'La evaluación pertenece a otro docente.')
    }
    await transaction(async client => {
      const ids = exams.map(exam => exam.id)
      // El guardado de un maestro nunca elimina evaluaciones de otro.
      if (req.user.role === 'admin') await client.query('DELETE FROM exams WHERE NOT (id=ANY($1::text[]))', [ids])
      else await client.query('DELETE FROM exams WHERE teacher_id=$1 AND NOT (id=ANY($2::text[]))', [req.user.id, ids])
      for (const exam of exams) {
        const saved = await client.query(
          `INSERT INTO exams (id,teacher_id,subject_id,title,instructions,duration_minutes,form_url,status,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (id) DO UPDATE SET teacher_id=EXCLUDED.teacher_id,subject_id=EXCLUDED.subject_id,title=EXCLUDED.title,
           instructions=EXCLUDED.instructions,duration_minutes=EXCLUDED.duration_minutes,form_url=EXCLUDED.form_url,status=EXCLUDED.status,updated_at=EXCLUDED.updated_at
           WHERE exams.teacher_id=$11 OR $12`,
          [exam.id, Number(exam.teacherId), exam.subjectId, exam.title, exam.instructions || '', Number(exam.durationMinutes), exam.formUrl || '', exam.status,
            exam.createdAt || new Date().toISOString(), exam.updatedAt || new Date().toISOString(), req.user.id, req.user.role === 'admin']
        )
        if (!saved.rowCount) throw new HttpError(403, 'La evaluación pertenece a otro docente.')
      }
    })
    res.json({ ok: true })
  })

  const validateStudentEvent = async (user, studentId, event) => {
    if (Number(studentId) !== user.id) throw new HttpError(403, 'Solo puedes registrar tus propios eventos.')
    const enrolled = await db.query('SELECT 1 FROM enrollments WHERE student_id=$1 AND subject_id=$2', [user.id, event.subjectId])
    if (!enrolled.rowCount) throw new HttpError(403, 'La materia no está asignada a tu usuario.')
    if (event.examId) {
      const exam = await db.query("SELECT 1 FROM exams WHERE id=$1 AND subject_id=$2 AND status='published'", [event.examId, event.subjectId])
      if (!exam.rowCount) throw new HttpError(403, 'La evaluación no está disponible para esta materia.')
    }
  }

  const SEVERITIES = new Set(['info', 'low', 'warning', 'medium', 'high'])
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min))
  const shortText = (value, max) => String(value ?? '').slice(0, max)

  app.post('/api/incidents', requireRole('student'), async (req, res) => {
    const { studentId, incident = {} } = req.body || {}
    await validateStudentEvent(req.user, studentId, incident)
    // El tipo y la severidad se limitan y la hora la fija el servidor: el cliente no puede falsificarla.
    const type = /^[a-z0-9-]{1,60}$/i.test(incident.type || '') ? incident.type : 'unknown'
    const severity = SEVERITIES.has(incident.severity) ? incident.severity : 'warning'
    const result = await db.query(
      `INSERT INTO incidents (student_id,subject_id,exam_id,type,message,severity,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING id`,
      [Number(studentId), incident.subjectId || null, incident.examId || null, type, shortText(incident.message, 300), severity]
    )
    res.status(201).json({ ok: true, id: String(result.rows[0].id) })
  })

  app.post('/api/samples', requireRole('student'), async (req, res) => {
    const { studentId, sample = {} } = req.body || {}
    await validateStudentEvent(req.user, studentId, sample)
    const result = await db.query(
      `INSERT INTO attention_samples (student_id,subject_id,attention,expression,gaze,label,captured_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING id`,
      [Number(studentId), sample.subjectId || null, clamp(sample.attention, 0, 100), shortText(sample.expression || 'Neutral', 80),
        shortText(sample.gaze, 80), shortText(sample.label, 80)]
    )
    res.status(201).json({ ok: true, id: String(result.rows[0].id) })
  })

  // Alertas casi en vivo para el maestro. Sin afterId solo devuelve el último id (no vuelca el historial).
  // El maestro ve únicamente sus materias; el admin ve todo.
  app.get('/api/incidents/live', requireRole('teacher', 'admin'), async (req, res) => {
    const isAdmin = req.user.role === 'admin'
    const afterRaw = req.query.afterId
    const hasCursor = typeof afterRaw === 'string' && /^\d{1,15}$/.test(afterRaw)
    const scope = isAdmin ? 'TRUE' : `i.subject_id IN (SELECT id FROM subjects WHERE default_teacher_id=$1
      UNION SELECT subject_id FROM enrollments WHERE teacher_id=$1)`
    const scopeParams = isAdmin ? [] : [req.user.id]
    if (!hasCursor) {
      const last = await db.query(`SELECT COALESCE(MAX(i.id),0) AS last FROM incidents i WHERE ${scope}`, scopeParams)
      return res.json({ lastId: String(last.rows[0].last), incidents: [] })
    }
    const result = await db.query(
      `SELECT i.id,i.type,i.message,i.severity,i.occurred_at,i.student_id,u.name AS student_name,
              i.subject_id,s.name AS subject_name
         FROM incidents i JOIN users u ON u.id=i.student_id LEFT JOIN subjects s ON s.id=i.subject_id
        WHERE ${scope} AND i.id > $${scopeParams.length + 1} ORDER BY i.id ASC LIMIT 50`,
      [...scopeParams, afterRaw])
    const incidents = result.rows.map(row => ({
      id: String(row.id), type: row.type, message: row.message, severity: row.severity,
      timestamp: row.occurred_at?.toISOString?.() || row.occurred_at,
      studentId: row.student_id, studentName: row.student_name,
      subjectId: row.subject_id, subjectName: row.subject_name || 'General'
    }))
    res.json({ lastId: incidents.length ? incidents.at(-1).id : afterRaw, incidents })
  })

  app.use((error, _req, res, _next) => {
    const status = error instanceof HttpError ? error.status : 500
    if (status === 500) console.error('[ClassFocus API] Falló una operación interna; código:', error.code || error.name)
    res.status(status).json({ message: status === 500 ? 'Error interno de ClassFocus API.' : error.message })
  })
  return app
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function start() {
  let lastError
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    try {
      await initializeDatabase()
      const port = Number(process.env.API_PORT || 8788)
      createApp().listen(port, process.env.API_HOST || '127.0.0.1', () => console.log(`ClassFocus API + PostgreSQL activa en http://${process.env.API_HOST || '127.0.0.1'}:${port}/api`))
      return
    } catch (error) {
      lastError = error
      console.log(`PostgreSQL aún no responde (${attempt}/15): ${error.message}`)
      await wait(2000)
    }
  }
  console.error('No se pudo iniciar PostgreSQL/API:', lastError?.message)
  console.error('Ejecuta: docker compose up -d postgres  (o configura DATABASE_URL en .env)')
  process.exit(1)
}

// Permite importar la aplicación en pruebas sin abrir puertos ni modificar la base.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start()
