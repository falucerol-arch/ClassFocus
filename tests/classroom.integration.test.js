import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { PGlite } from '@electric-sql/pglite'
import bcrypt from 'bcryptjs'
import { schema } from '../server/database.js'
import { createApp } from '../server/apiServer.js'
import { GoogleGateway } from '../server/classroom/googleGateway.js'
import { importCourse } from '../server/classroom/importCourse.js'

const databaseUrl = process.env.CLASSFOCUS_TEST_DATABASE_URL

// Por defecto usa el motor PostgreSQL de PGlite, aislado en memoria y sin servicios externos.
// Opcionalmente repite el mismo contrato contra una base PostgreSQL desechable explícita.
test('integración PostgreSQL: OAuth, permisos, importaciones completas, repetición y rollback', async t => {
  let db
  let server
  let dispose
  if (databaseUrl) {
    assert.match(new URL(databaseUrl).pathname, /test/i, 'Usa una base desechable con «test» en su nombre.')
    const adminPool = new pg.Pool({ connectionString: databaseUrl })
    const namespace = `classfocus_test_${randomBytes(6).toString('hex')}`
    await adminPool.query(`CREATE SCHEMA ${namespace}`)
    db = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${namespace}` })
    await db.query(schema)
    dispose = async () => {
      await db.end()
      await adminPool.query(`DROP SCHEMA ${namespace} CASCADE`)
      await adminPool.end()
    }
  } else {
    const engine = new PGlite()
    await engine.exec(schema)
    const query = async (sql, values) => {
      const result = await engine.query(sql, values)
      return { ...result, rowCount: result.rows.length || result.affectedRows || 0 }
    }
    db = { query, connect: async () => ({ query, release() {} }) }
    dispose = () => engine.close()
  }
  t.after(async () => {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
    await dispose()
  })
  const hash = await bcrypt.hash('123456', 4)
  for (const [id, role] of [[1, 'student'], [2, 'teacher'], [3, 'admin'], [4, 'teacher']]) {
    await db.query('INSERT INTO users (id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,$5)', [id, role, `${role}${id}@example.test`, hash, role])
  }
  await db.query("SELECT setval(pg_get_serial_sequence('users','id'),4,true)")
  const transaction = async action => {
    const client = await db.connect()
    try { await client.query('BEGIN'); const value = await action(client); await client.query('COMMIT'); return value }
    catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
  }
  const config = { configured: true, clientId: 'real.apps.googleusercontent.com', clientSecret: 'private', encryptionKey: 'ab'.repeat(32), frontendUrl: 'http://localhost:5173', redirectUri: 'http://localhost:8788/api/classroom/callback' }
  let sub = 'teacher-google'
  let students = Array.from({ length: 105 }, (_, i) => ({ userId: `student-${i}`, profile: { emailAddress: `student-${i}@example.test`, name: { fullName: `Alumno ${i}` } } }))
  const googleGateway = new GoogleGateway(config)
  const gateway = {
    authorizationUrl: (state, challenge) => `https://accounts.google.com/test?state=${state}&challenge=${challenge}`,
    exchange: async () => ({ tokens: { access_token: 'private-access', refresh_token: 'private-refresh' }, profile: { sub, email: `${sub}@example.test`, name: sub } }),
    authorized: async (tokens, onTokens, action) => { assert.equal(tokens.refresh_token, 'private-refresh'); return action({}) },
    listCourses: async () => [{ id: 'university-one', name: 'Programación', googleRole: 'teacher' }],
    roster: async (_client, courseId, googleSub) => googleGateway.roster({ request: async options => {
      if (options.url.endsWith('/teachers')) return { data: { teachers: [{ userId: 'teacher-google' }] } }
      if (options.url.endsWith('/students')) return { data: options.params.pageToken ? { students: students.slice(100) } : { students: students.slice(0, 100), ...(students.length > 100 ? { nextPageToken: 'page-2' } : {}) } }
      return { data: { id: courseId, name: 'Programación', section: 'C', courseState: 'ACTIVE', alternateLink: 'https://classroom.google.com/c/one' } }
    } }, courseId, googleSub)
  }
  server = createApp({ db, transaction, classroomOptions: { config, gateway } }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const root = `http://127.0.0.1:${server.address().port}/api`
  const request = async (path, token, body, method = 'GET', extra = {}) => {
    const response = await fetch(`${root}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), redirect: 'manual' })
    const data = await response.json().catch(() => ({}))
    return { response, data }
  }
  const login = async (id, role) => {
    const { response, data } = await request('/auth/login', null, { email: `${role}${id}@example.test`, password: '123456', role }, 'POST')
    assert.equal(response.status, 200)
    assert.ok(data.token)
    return data.token
  }
  const teacher = await login(2, 'teacher')
  const student = await login(1, 'student')
  const admin = await login(3, 'admin')
  const otherTeacher = await login(4, 'teacher')

  await t.test('rutas privadas exigen una sesión emitida por el servidor', async () => {
    assert.equal((await request('/bootstrap')).response.status, 401)
    assert.equal((await request('/classroom/status')).response.status, 401)
    assert.equal((await request('/classroom/status', 'forged')).response.status, 401)
    assert.equal((await request('/academic', teacher, {}, 'PUT')).response.status, 403)
    assert.equal((await request('/exams', student, { exams: [] }, 'PUT')).response.status, 403)
  })

  const connect = async (token, identity) => {
    sub = identity
    const { response, data } = await request('/classroom/authorize', token, {}, 'POST')
    assert.equal(response.status, 200)
    const state = new URL(data.url).searchParams.get('state')
    const cookie = response.headers.get('set-cookie').split(';')[0]
    const result = await request(`/classroom/callback?state=${state}&code=fake-code`, null, undefined, 'GET', { Cookie: cookie })
    assert.equal(result.response.status, 302)
    assert.match(result.response.headers.get('location'), /classroom=connected/)
    return { state, cookie }
  }
  let first
  await t.test('callback valida cookie, state, sesión y consumo único', async () => {
    const attempt = await request('/classroom/authorize', teacher, {}, 'POST')
    const state = new URL(attempt.data.url).searchParams.get('state')
    assert.equal((await request(`/classroom/callback?state=${state}&code=bad`)).response.status, 400)
    first = await connect(teacher, 'teacher-google')
    assert.equal((await request(`/classroom/callback?state=${first.state}&code=replay`, null, undefined, 'GET', { Cookie: first.cookie })).response.status, 400)
    const stored = (await db.query('SELECT encrypted_tokens FROM classroom_connections')).rows[0].encrypted_tokens
    assert.ok(!stored.includes('private-access'))
  })
  const status = await request('/classroom/status', teacher)
  const connectionId = status.data.connections[0].id

  await t.test('aísla conexiones y rechaza importar con rol local de alumno', async () => {
    assert.equal((await request(`/classroom/${connectionId}/courses`, student)).response.status, 404)
    assert.equal((await request(`/classroom/${connectionId}/courses/university-one/import`, student, {}, 'POST')).response.status, 403)
    assert.equal((await request('/classroom/status', student)).data.connections.length, 0)
  })

  await t.test('importa las 105 personas de varias páginas y reimporta sin duplicados', async () => {
    let result = await request(`/classroom/${connectionId}/courses/university-one/import`, teacher, {}, 'POST')
    assert.equal(result.response.status, 200, JSON.stringify(result.data))
    assert.equal(result.data.summary.studentsImported, 105)
    assert.equal(result.data.summary.studentsCreated, 105)
    result = await request(`/classroom/${connectionId}/courses/university-one/import`, teacher, {}, 'POST')
    assert.equal(result.data.summary.studentsCreated, 0)
    assert.equal(Number((await db.query("SELECT COUNT(*) FROM enrollments WHERE subject_id='gc-university-one'")).rows[0].count), 105)
    const imported = await db.query("SELECT password_hash FROM users WHERE source='google-classroom' LIMIT 1")
    assert.equal(await bcrypt.compare('123456', imported.rows[0].password_hash), false)
    const bootstrap = await request('/bootstrap', teacher)
    assert.equal(bootstrap.data.academic.assignments.length, 105)
    assert.equal(bootstrap.data.academic.subjects[0].classroomId, 'university-one')
    assert.equal((await request('/bootstrap', otherTeacher)).data.academic.subjects.length, 0)
    assert.equal((await request('/bootstrap', student)).data.academic.users.length, 1)
  })

  await t.test('identifica materias por ID de Google aunque el nombre y sección sean iguales', async () => {
    const result = await request(`/classroom/${connectionId}/courses/university-two/import`, teacher, {}, 'POST')
    assert.equal(result.response.status, 200)
    assert.equal(result.data.summary.studentsCreated, 0)
    assert.equal(Number((await db.query("SELECT COUNT(*) FROM subjects WHERE name='Programación'")).rows[0].count), 2)
  })

  await t.test('sincroniza bajas de una materia sin borrar alumnos ni matrículas de otra', async () => {
    students = students.slice(0, 104)
    const result = await request(`/classroom/${connectionId}/courses/university-one/import`, teacher, {}, 'POST')
    assert.equal(result.data.summary.enrollmentsRemoved, 1)
    assert.equal(Number((await db.query("SELECT COUNT(*) FROM enrollments WHERE subject_id='gc-university-two'")).rows[0].count), 105)
    assert.equal(Number((await db.query("SELECT COUNT(*) FROM users WHERE source='google-classroom'")).rows[0].count), 105)
  })

  await t.test('un guardado administrativo antiguo no elimina materias o matrículas importadas', async () => {
    const result = await request('/academic', admin, { users: [], subjects: [], assignments: [] }, 'PUT')
    assert.equal(result.response.status, 200)
    assert.equal(Number((await db.query('SELECT COUNT(*) FROM subjects')).rows[0].count), 2)
    assert.equal(Number((await db.query('SELECT COUNT(*) FROM enrollments')).rows[0].count), 209)
  })

  await t.test('rollback: un conflicto tardío revierte nuevos alumnos y cambios de nombre del curso', async () => {
    const course = { id: 'university-one', name: 'No debe persistir', students: [
      { userId: 'brand-new', profile: { emailAddress: 'new@example.test' } },
      { userId: 'conflict', profile: { emailAddress: 'teacher4@example.test' } }
    ] }
    await assert.rejects(importCourse({ transaction, course, user: { id: 2, role: 'teacher' } }), /otro rol/)
    assert.equal(Number((await db.query("SELECT COUNT(*) FROM users WHERE email='new@example.test'")).rows[0].count), 0)
    assert.equal((await db.query("SELECT name FROM subjects WHERE id='gc-university-one'")).rows[0].name, 'Programación')
    assert.equal(Number((await db.query("SELECT COUNT(*) FROM enrollments WHERE subject_id='gc-university-one'")).rows[0].count), 104)
  })

  await t.test('una cuenta Google de estudiante no se convierte en docente por el rol local', async () => {
    await connect(otherTeacher, 'student-google')
    const accounts = await request('/classroom/status', otherTeacher)
    const result = await request(`/classroom/${accounts.data.connections[0].id}/courses/university-one/import`, otherTeacher, {}, 'POST')
    assert.equal(result.response.status, 403)
  })

  await t.test('admite varias cuentas por usuario, sin duplicar una cuenta al reconectarla', async () => {
    await connect(teacher, 'second-teacher-google')
    await connect(teacher, 'second-teacher-google')
    const accounts = await request('/classroom/status', teacher)
    assert.equal(accounts.data.connections.length, 2)
    assert.ok(accounts.data.connections.every(account => !('encrypted_tokens' in account)))
  })

  await t.test('una autorización vencida o cuya sesión se cerró no guarda conexiones', async () => {
    const temporarySession = await login(4, 'teacher')
    let attempt = await request('/classroom/authorize', temporarySession, {}, 'POST')
    let state = new URL(attempt.data.url).searchParams.get('state')
    let cookie = attempt.response.headers.get('set-cookie').split(';')[0]
    await db.query("UPDATE classroom_oauth_states SET expires_at=NOW()-INTERVAL '1 minute'")
    assert.equal((await request(`/classroom/callback?state=${state}&code=fake`, null, undefined, 'GET', { Cookie: cookie })).response.status, 400)
    attempt = await request('/classroom/authorize', temporarySession, {}, 'POST')
    state = new URL(attempt.data.url).searchParams.get('state')
    cookie = attempt.response.headers.get('set-cookie').split(';')[0]
    await request('/auth/logout', temporarySession, {}, 'POST')
    assert.equal((await request(`/classroom/callback?state=${state}&code=fake`, null, undefined, 'GET', { Cookie: cookie })).response.status, 400)
  })

  await t.test('un maestro no elimina exámenes ajenos ni escribe eventos de un alumno', async () => {
    await db.query("INSERT INTO exams (id,teacher_id,subject_id,title,duration_minutes,status) VALUES ('other-exam',4,'gc-university-two','Otro examen',30,'published')")
    assert.equal((await request('/exams', teacher, { exams: [] }, 'PUT')).response.status, 200)
    assert.equal(Number((await db.query("SELECT COUNT(*) FROM exams WHERE id='other-exam'")).rows[0].count), 1)
    assert.equal((await request('/samples', teacher, { studentId: 1, sample: {} }, 'POST')).response.status, 403)
    assert.equal((await request('/samples', student, { studentId: 2, sample: {} }, 'POST')).response.status, 403)
    assert.equal((await request('/samples', student, { studentId: 1, sample: { subjectId: 'gc-university-one' } }, 'POST')).response.status, 403)
  })

  await t.test('conserva creación de exámenes y registro autorizado de métricas e incidencias', async () => {
    const exam = { id: 'own-exam', teacherId: 2, subjectId: 'gc-university-one', title: 'Parcial', durationMinutes: 30, status: 'published' }
    let result = await request('/exams', teacher, { exams: [exam] }, 'PUT')
    assert.equal(result.response.status, 200, JSON.stringify(result.data))
    result = await request('/exams', teacher, { exams: [{ ...exam, title: 'Parcial actualizado' }] }, 'PUT')
    assert.equal(result.response.status, 200, JSON.stringify(result.data))
    assert.equal((await db.query("SELECT title FROM exams WHERE id='own-exam'")).rows[0].title, 'Parcial actualizado')
    assert.equal(Number((await db.query("SELECT COUNT(*) FROM exams WHERE id='other-exam'")).rows[0].count), 1)
    await db.query("INSERT INTO enrollments(student_id,teacher_id,subject_id) VALUES(1,2,'gc-university-one')")
    result = await request('/samples', student, { studentId: 1, sample: { subjectId: 'gc-university-one', attention: 90 } }, 'POST')
    assert.equal(result.response.status, 201, JSON.stringify(result.data))
    result = await request('/incidents', student, { studentId: 1, incident: { subjectId: 'gc-university-one', examId: 'own-exam', type: 'tab-change' } }, 'POST')
    assert.equal(result.response.status, 201, JSON.stringify(result.data))
    const snapshot = await request('/bootstrap', student)
    assert.equal(snapshot.data.samples.length, 1)
    assert.equal(snapshot.data.incidents.length, 1)
    assert.equal(snapshot.data.exams.length, 1)
    assert.ok(snapshot.data.academic.users.every(user => user.id === 1 || user.id === 2))
    await db.query('DELETE FROM enrollments WHERE student_id=1')
  })

  await t.test('logout invalida la sesión y desconectar conserva datos académicos', async () => {
    assert.equal((await request(`/classroom/${connectionId}`, teacher, undefined, 'DELETE')).response.status, 200)
    assert.equal(Number((await db.query('SELECT COUNT(*) FROM enrollments')).rows[0].count), 209)
    await request('/auth/logout', teacher, {}, 'POST')
    assert.equal((await request('/classroom/status', teacher)).response.status, 401)
  })
})
