import pg from 'pg'
import bcrypt from 'bcryptjs'

const { Pool } = pg

const ssl = String(process.env.DATABASE_SSL || 'false').toLowerCase() === 'true'

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://classfocus:classfocus123@localhost:5432/classfocus',
  ssl: ssl ? { rejectUnauthorized: false } : false
})

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(190) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(30) NOT NULL CHECK (role IN ('student','teacher','admin')),
  source VARCHAR(60) DEFAULT 'classfocus',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subjects (
  id VARCHAR(120) PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  code VARCHAR(80) UNIQUE NOT NULL,
  section VARCHAR(80) DEFAULT '',
  schedule VARCHAR(180) DEFAULT '',
  default_teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source VARCHAR(60) DEFAULT 'classfocus',
  classroom_id VARCHAR(180),
  classroom_url TEXT,
  course_work JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS enrollments (
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id VARCHAR(120) NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (student_id, subject_id)
);

CREATE TABLE IF NOT EXISTS exams (
  id VARCHAR(160) PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id VARCHAR(120) NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  title VARCHAR(220) NOT NULL,
  instructions TEXT DEFAULT '',
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 480),
  form_url TEXT DEFAULT '',
  status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS incidents (
  id BIGSERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id VARCHAR(120) REFERENCES subjects(id) ON DELETE SET NULL,
  exam_id VARCHAR(160) REFERENCES exams(id) ON DELETE SET NULL,
  type VARCHAR(60) NOT NULL,
  message TEXT DEFAULT '',
  severity VARCHAR(30) DEFAULT 'warning',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attention_samples (
  id BIGSERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id VARCHAR(120) REFERENCES subjects(id) ON DELETE SET NULL,
  attention NUMERIC(5,2) NOT NULL DEFAULT 0,
  expression VARCHAR(80) DEFAULT 'Neutral',
  gaze VARCHAR(80) DEFAULT '',
  label VARCHAR(80) DEFAULT '',
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enrollments_teacher ON enrollments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_incidents_student ON incidents(student_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_samples_student ON attention_samples(student_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_exams_subject ON exams(subject_id, status);
`

export async function initializeDatabase() {
  await pool.query(schema)
  await seedDatabase()
}

async function seedDatabase() {
  const users = [
    [1, 'Alumno Demo', 'student@classfocus.com', 'student'],
    [2, 'Ing. Carlos Méndez', 'teacher@classfocus.com', 'teacher'],
    [3, 'Super Administrador', 'admin@classfocus.com', 'admin'],
    [4, 'María López', 'maria@classfocus.com', 'student'],
    [5, 'Lic. Ana García', 'ana@classfocus.com', 'teacher'],
    [6, 'José Pérez', 'jose@classfocus.com', 'student']
  ]

  const passwordHash = await bcrypt.hash('123456', 10)
  for (const [id, name, email, role] of users) {
    await pool.query(
      `INSERT INTO users (id,name,email,password_hash,role,source)
       VALUES ($1,$2,$3,$4,$5,'classfocus')
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,role=EXCLUDED.role,updated_at=NOW()`,
      [id, name, email, passwordHash, role]
    )
  }
  await pool.query(`SELECT setval(pg_get_serial_sequence('users','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM users), 1), true)`)

  const subjects = [
    ['prog1','Programación I','SIS-101'],
    ['db1','Base de Datos I','SIS-202'],
    ['math1','Matemática I','MAT-101'],
    ['net1','Redes I','RED-201'],
    ['web1','Desarrollo Web','SIS-220']
  ]
  for (const [id,name,code] of subjects) {
    await pool.query(
      `INSERT INTO subjects (id,name,code) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO NOTHING`, [id,name,code]
    )
  }

  const enrollments = [
    [1,2,'prog1'],[1,2,'db1'],[4,2,'prog1'],[4,2,'web1'],[6,5,'math1'],[6,5,'net1']
  ]
  for (const [studentId, teacherId, subjectId] of enrollments) {
    await pool.query(
      `INSERT INTO enrollments (student_id,teacher_id,subject_id) VALUES ($1,$2,$3)
       ON CONFLICT (student_id,subject_id) DO NOTHING`, [studentId, teacherId, subjectId]
    )
  }

  await pool.query(
    `INSERT INTO exams (id,teacher_id,subject_id,title,instructions,duration_minutes,form_url,status)
     VALUES ('exam-demo-prog1',2,'prog1','Parcial 1 · Programación I','Responde todas las preguntas. Mantén la cámara activa durante toda la evaluación.',35,'','published')
     ON CONFLICT (id) DO NOTHING`
  )
}

export async function withTransaction(callback) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
