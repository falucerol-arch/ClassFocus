// Llena la base con historial realista (3 días de atención e incidencias) para que los paneles
// del maestro y del admin se vean completos durante la demostración.
//   npm run seed:demo                agrega datos
//   npm run seed:demo -- --reset     borra TODAS las incidencias y muestras antes de agregar
import 'dotenv/config'
import { initializeDatabase, pool } from '../server/database.js'

// Generador pseudoaleatorio con semilla fija: la demo se ve igual cada vez.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const random = mulberry32(2027)
const pick = list => list[Math.floor(random() * list.length)]
const gazes = ['Al frente', 'Al frente', 'Al frente', 'Hacia la izquierda', 'Hacia la derecha']
const expressions = ['Neutral', 'Neutral', 'Neutral', 'Positivo aparente', 'Cansancio aparente']
const incidentTemplates = [
  ['tab', 'Cambio de pestaña detectado', 'high'],
  ['tab', 'Cambio de pestaña detectado', 'high'],
  ['gaze', 'Mirada desviada: Hacia la izquierda', 'medium'],
  ['gaze', 'Mirada desviada: Hacia la derecha', 'medium'],
  ['no-face', 'No se detecta el rostro', 'high'],
  ['fullscreen', 'Salida de pantalla completa', 'medium'],
  ['multi-face', 'Se detectan varias personas frente a la cámara', 'high'],
  ['clipboard', 'Intento de copiar o pegar durante la evaluación', 'medium']
]
// Nivel base de atención por alumno: da variedad visual (verde, ámbar, rojo) en la vista de clase.
const baseAttention = { 1: 86, 4: 68, 6: 52 }
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

await initializeDatabase()
if (process.argv.includes('--reset')) {
  await pool.query('DELETE FROM incidents')
  await pool.query('DELETE FROM attention_samples')
  console.log('Se borraron las incidencias y muestras anteriores.')
}

const enrollments = (await pool.query('SELECT student_id,subject_id FROM enrollments')).rows
const exams = (await pool.query("SELECT id,subject_id FROM exams WHERE status='published'")).rows
const examBySubject = new Map(exams.map(row => [row.subject_id, row.id]))
const now = Date.now()
let samples = 0
let incidents = 0

for (const { student_id: studentId, subject_id: subjectId } of enrollments) {
  const base = baseAttention[studentId] ?? 70
  const sampleCount = 36
  for (let i = 0; i < sampleCount; i += 1) {
    // Tres días atrás hasta hoy, con jornada entre las 8:00 y las 20:00.
    const dayOffset = Math.floor((i / sampleCount) * 3)
    const when = new Date(now - (2 - dayOffset) * 86400000 - (sampleCount - i) * 240000)
    const attention = clamp(Math.round(base + (random() - 0.5) * 36 + Math.sin(i / 3) * 6), 8, 100)
    const label = when.toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit', hour12: false })
    await pool.query(
      `INSERT INTO attention_samples (student_id,subject_id,attention,expression,gaze,label,captured_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [studentId, subjectId, attention, pick(expressions), attention < 60 ? pick(['Hacia la izquierda', 'Hacia la derecha']) : pick(gazes), label, when]
    )
    samples += 1
  }
  // Los alumnos con menos atención acumulan más incidencias.
  const incidentCount = Math.round((100 - base) / 8) + Math.floor(random() * 3)
  for (let i = 0; i < incidentCount; i += 1) {
    const [type, message, severity] = pick(incidentTemplates)
    const when = new Date(now - Math.floor(random() * 3 * 86400000))
    await pool.query(
      `INSERT INTO incidents (student_id,subject_id,exam_id,type,message,severity,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [studentId, subjectId, examBySubject.get(subjectId) || null, type, message, severity, when]
    )
    incidents += 1
  }
}
console.log(`Datos de demostración listos: ${samples} muestras de atención y ${incidents} incidencias.`)
await pool.end()
