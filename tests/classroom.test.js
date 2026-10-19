import test from 'node:test'
import assert from 'node:assert/strict'
import { TokenVault } from '../server/classroom/tokenVault.js'
import { classroomConfig } from '../server/classroom/config.js'
import { GoogleGateway, CLASSROOM_SCOPES } from '../server/classroom/googleGateway.js'
import { HttpError } from '../server/errors.js'
import { importCourse } from '../server/classroom/importCourse.js'

// Las respuestas simuladas comprueban el contrato sin contactar Google ni pedir credenciales.
test('no declara configurado el Client ID de ejemplo ni una clave inválida', () => {
  assert.equal(classroomConfig({ VITE_GOOGLE_CLIENT_ID: 'TU_CLIENT_ID.apps.googleusercontent.com' }).configured, false)
  assert.equal(classroomConfig({ GOOGLE_CLIENT_ID: 'real.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_TOKEN_ENCRYPTION_KEY: 'bad' }).configured, false)
  assert.equal(classroomConfig({ GOOGLE_CLIENT_ID: 'real.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_TOKEN_ENCRYPTION_KEY: 'ab'.repeat(32) }).configured, true)
})

test('cifra tokens sin exponerlos y rechaza claves o datos modificados', () => {
  const vault = new TokenVault('ab'.repeat(32))
  const tokens = { access_token: 'private-access', refresh_token: 'private-refresh' }
  const encrypted = vault.seal(tokens)
  assert.ok(!encrypted.includes('private'))
  assert.deepEqual(vault.open(encrypted), tokens)
  assert.throws(() => new TokenVault('cd'.repeat(32)).open(encrypted))
  const parts = encrypted.split('.')
  parts[1] = Buffer.alloc(16).toString('base64url')
  assert.throws(() => vault.open(parts.join('.')))
})

test('OAuth solicita lectura, state y PKCE; no solicita tareas ni escritura', () => {
  const gateway = new GoogleGateway({ clientId: 'real.apps.googleusercontent.com', clientSecret: 'secret', redirectUri: 'http://localhost:8788/api/classroom/callback' })
  const url = new URL(gateway.authorizationUrl('state-test', 'challenge-test'))
  assert.equal(url.searchParams.get('state'), 'state-test')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-test')
  assert.equal(url.searchParams.get('access_type'), 'offline')
  assert.ok(CLASSROOM_SCOPES.includes('https://www.googleapis.com/auth/classroom.rosters.readonly'))
  assert.ok(!CLASSROOM_SCOPES.some(scope => scope.includes('coursework')))
})

test('lee todas las páginas de alumnos, incluso si una página tiene menos de pageSize', async () => {
  const gateway = new GoogleGateway({})
  const calls = []
  const client = { request: async options => {
    calls.push(options)
    return { data: options.params.pageToken
      ? { students: [{ userId: 'last' }] }
      : { students: Array.from({ length: 100 }, (_, i) => ({ userId: String(i) })), nextPageToken: 'next' } }
  } }
  const students = await gateway.allPages(client, 'courses/one/students', 'students')
  assert.equal(students.length, 101)
  assert.equal(calls[1].params.pageToken, 'next')
  assert.equal(students.at(-1).userId, 'last')
})

test('una página fallida no se convierte en matrícula vacía o parcial', async () => {
  const gateway = new GoogleGateway({})
  const client = { request: async options => {
    if (options.params.pageToken) throw new Error('Google no disponible')
    return { data: { students: [{ userId: 'one' }], nextPageToken: 'next' } }
  } }
  await assert.rejects(gateway.allPages(client, 'courses/one/students', 'students'), /Google no disponible/)
})

test('rechaza paginación repetida en lugar de entrar en un ciclo infinito', async () => {
  const gateway = new GoogleGateway({})
  await assert.rejects(gateway.allPages({ request: async () => ({ data: { nextPageToken: 'same' } }) }, 'courses', 'courses'), /paginación repetida/)
})

test('distingue cursos de estudiante y docente y elimina cursos repetidos', async () => {
  const gateway = new GoogleGateway({})
  const client = { request: async options => ({ data: { courses: options.params.teacherId
    ? [{ id: 'teach', name: 'Programación' }] : [{ id: 'study' }, { id: 'teach' }] } }) }
  const courses = await gateway.listCourses(client)
  assert.equal(courses.length, 2)
  assert.equal(courses.find(course => course.id === 'teach').googleRole, 'teacher')
  assert.equal(courses.find(course => course.id === 'study').googleRole, 'student')
})

test('una cuenta que no es docente nunca consulta la lista de alumnos', async () => {
  const gateway = new GoogleGateway({})
  const urls = []
  const client = { request: async options => {
    urls.push(options.url)
    return { data: options.url.endsWith('/teachers') ? { teachers: [{ userId: 'actual-teacher' }] } : { id: 'one', courseState: 'ACTIVE' } }
  } }
  await assert.rejects(gateway.roster(client, 'one', 'student'), error => error instanceof HttpError && error.status === 403)
  assert.ok(urls.every(url => !url.endsWith('/students')))
})


test('no inventa correos ni guarda una lista incompleta de alumnos', async () => {
  let touchedDatabase = false
  await assert.rejects(importCourse({
    transaction: async () => { touchedDatabase = true },
    user: { id: 2, role: 'teacher' },
    course: { id: 'course', name: 'Curso', students: [{ userId: 'missing-email', profile: {} }] }
  }), /correo de todos los alumnos/)
  assert.equal(touchedDatabase, false)
})
