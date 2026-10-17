import 'dotenv/config'
import 'express-async-errors'
import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import { initializeDatabase, pool, withTransaction } from './database.js'

const app = express()
const port = Number(process.env.API_PORT || 8788)

app.use(cors({ origin: true, credentials: false }))
app.use(express.json({ limit: '3mb' }))

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
  courseWork: row.course_work || []
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
    const result = await pool.query('SELECT NOW() AS now, current_database() AS database')
    res.json({ ok: true, database: result.rows[0].database, time: result.rows[0].now })
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message })
  }
})

app.post('/api/auth/login', async (req, res) => {
  const { email, password, role } = req.body || {}
  const result = await pool.query('SELECT * FROM users WHERE LOWER(email)=LOWER($1) AND role=$2 LIMIT 1', [email || '', role || ''])
  const user = result.rows[0]
  if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
    return res.status(401).json({ message: 'Credenciales incorrectas o rol inválido.' })
  }
  res.json({ user: mapUser(user) })
})

app.get('/api/bootstrap', async (_req, res) => {
  const [usersResult, subjectsResult, enrollmentsResult, examsResult, incidentsResult, samplesResult] = await Promise.all([
    pool.query('SELECT id,name,email,role,source FROM users ORDER BY id'),
    pool.query('SELECT * FROM subjects ORDER BY name'),
    pool.query('SELECT student_id,teacher_id,subject_id FROM enrollments ORDER BY student_id,teacher_id'),
    pool.query('SELECT * FROM exams ORDER BY created_at DESC'),
    pool.query('SELECT * FROM incidents ORDER BY occurred_at DESC LIMIT 1000'),
    pool.query('SELECT * FROM attention_samples ORDER BY captured_at DESC LIMIT 2500')
  ])

  const grouped = new Map()
  for (const row of enrollmentsResult.rows) {
    const key = `${row.student_id}:${row.teacher_id}`
    const item = grouped.get(key) || { studentId: row.student_id, teacherId: row.teacher_id, subjectIds: [] }
    item.subjectIds.push(row.subject_id)
    grouped.set(key, item)
  }

  res.json({
    academic: {
      users: usersResult.rows.map(mapUser),
      subjects: subjectsResult.rows.map(mapSubject),
      assignments: [...grouped.values()]
    },
    exams: examsResult.rows.map(mapExam),
    incidents: incidentsResult.rows.map(row => ({
      id: String(row.id), studentId: row.student_id, subjectId: row.subject_id, examId: row.exam_id,
      type: row.type, message: row.message, severity: row.severity,
      timestamp: row.occurred_at?.toISOString?.() || row.occurred_at
    })),
    samples: samplesResult.rows.map(row => ({
      id: String(row.id), studentId: row.student_id, subjectId: row.subject_id,
      attention: Number(row.attention), expression: row.expression, gaze: row.gaze,
      label: row.label, timestamp: row.captured_at?.toISOString?.() || row.captured_at
    }))
  })
})

app.put('/api/academic', async (req, res) => {
  const { users = [], subjects = [], assignments = [] } = req.body || {}
  await withTransaction(async client => {
    const existing = await client.query('SELECT id,email,password_hash FROM users')
    const passwordById = new Map(existing.rows.map(row => [Number(row.id), row.password_hash]))
    const defaultHash = await bcrypt.hash('123456', 10)

    for (const user of users) {
      await client.query(
        `INSERT INTO users (id,name,email,password_hash,role,source)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,role=EXCLUDED.role,source=EXCLUDED.source,updated_at=NOW()`,
        [Number(user.id), user.name, user.email, passwordById.get(Number(user.id)) || defaultHash, user.role, user.source || 'classfocus']
      )
    }
    await client.query(`SELECT setval(pg_get_serial_sequence('users','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM users), 1), true)`)

    const incomingSubjectIds = subjects.map(subject => subject.id)
    if (incomingSubjectIds.length) await client.query('DELETE FROM subjects WHERE NOT (id = ANY($1::text[]))', [incomingSubjectIds])
    else await client.query('DELETE FROM subjects')

    for (const subject of subjects) {
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

    await client.query('DELETE FROM enrollments')
    for (const assignment of assignments) {
      for (const subjectId of assignment.subjectIds || []) {
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

app.put('/api/exams', async (req, res) => {
  const exams = Array.isArray(req.body?.exams) ? req.body.exams : []
  await withTransaction(async client => {
    const ids = exams.map(exam => exam.id)
    if (ids.length) await client.query('DELETE FROM exams WHERE NOT (id = ANY($1::text[]))', [ids])
    else await client.query('DELETE FROM exams')
    for (const exam of exams) {
      await client.query(
        `INSERT INTO exams (id,teacher_id,subject_id,title,instructions,duration_minutes,form_url,status,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET teacher_id=EXCLUDED.teacher_id,subject_id=EXCLUDED.subject_id,title=EXCLUDED.title,
         instructions=EXCLUDED.instructions,duration_minutes=EXCLUDED.duration_minutes,form_url=EXCLUDED.form_url,status=EXCLUDED.status,updated_at=EXCLUDED.updated_at`,
        [exam.id, Number(exam.teacherId), exam.subjectId, exam.title, exam.instructions || '', Number(exam.durationMinutes), exam.formUrl || '', exam.status,
          exam.createdAt || new Date().toISOString(), exam.updatedAt || new Date().toISOString()]
      )
    }
  })
  res.json({ ok: true })
})

app.post('/api/incidents', async (req, res) => {
  const { studentId, incident = {} } = req.body || {}
  const result = await pool.query(
    `INSERT INTO incidents (student_id,subject_id,exam_id,type,message,severity,occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [Number(studentId), incident.subjectId || null, incident.examId || null, incident.type || 'unknown', incident.message || '', incident.severity || 'warning', incident.timestamp || new Date().toISOString()]
  )
  res.status(201).json({ ok: true, id: String(result.rows[0].id) })
})

app.post('/api/samples', async (req, res) => {
  const { studentId, sample = {} } = req.body || {}
  const result = await pool.query(
    `INSERT INTO attention_samples (student_id,subject_id,attention,expression,gaze,label,captured_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [Number(studentId), sample.subjectId || null, Number(sample.attention || 0), sample.expression || 'Neutral', sample.gaze || '', sample.label || '', sample.timestamp || new Date().toISOString()]
  )
  res.status(201).json({ ok: true, id: String(result.rows[0].id) })
})

app.use((error, _req, res, _next) => {
  console.error('[ClassFocus API]', error)
  res.status(500).json({ message: 'Error interno de ClassFocus API.', detail: error.message })
})

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function start() {
  let lastError
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    try {
      await initializeDatabase()
      app.listen(port, '0.0.0.0', () => console.log(`ClassFocus API + PostgreSQL activa en http://0.0.0.0:${port}/api`))
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

start()
