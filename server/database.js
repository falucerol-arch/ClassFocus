import pg from 'pg'
import bcrypt from 'bcryptjs'

const { Pool } = pg

// =====================================================
// CONEXIÓN POSTGRESQL
// =====================================================

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://classfocus:classfocus123@localhost:5432/classfocus'

export const pool = new Pool({
  connectionString
})


// =====================================================
// ESQUEMA DE BASE DE DATOS
// =====================================================

export const schema = `

-- =====================================================
-- USUARIOS
-- =====================================================

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,

  name VARCHAR(160) NOT NULL,

  email VARCHAR(190)
    UNIQUE
    NOT NULL,

  password_hash TEXT NOT NULL,

  -- Se conserva temporalmente como rol principal
  -- para compatibilidad con código existente.
  role VARCHAR(30)
    NOT NULL
    CHECK (
      role IN (
        'student',
        'teacher',
        'admin'
      )
    ),

  source VARCHAR(60)
    DEFAULT 'classfocus',

  created_at TIMESTAMPTZ
    DEFAULT NOW(),

  updated_at TIMESTAMPTZ
    DEFAULT NOW()
);


-- =====================================================
-- MÚLTIPLES ROLES POR USUARIO
-- =====================================================

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER
    NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

  role VARCHAR(30)
    NOT NULL
    CHECK (
      role IN (
        'student',
        'teacher',
        'admin'
      )
    ),

  created_at TIMESTAMPTZ
    NOT NULL
    DEFAULT NOW(),

  PRIMARY KEY (
    user_id,
    role
  )
);


-- Migrar automáticamente los roles antiguos.
INSERT INTO user_roles (
  user_id,
  role
)

SELECT
  id,
  role

FROM users

ON CONFLICT (
  user_id,
  role
)

DO NOTHING;


-- =====================================================
-- MATERIAS
-- =====================================================

CREATE TABLE IF NOT EXISTS subjects (
  id VARCHAR(120)
    PRIMARY KEY,

  name VARCHAR(180)
    NOT NULL,

  code VARCHAR(80)
    UNIQUE
    NOT NULL,

  section VARCHAR(80)
    DEFAULT '',

  schedule VARCHAR(180)
    DEFAULT '',

  default_teacher_id INTEGER
    REFERENCES users(id)
    ON DELETE SET NULL,

  source VARCHAR(60)
    DEFAULT 'classfocus',

  classroom_id VARCHAR(180),

  classroom_url TEXT,

  course_work JSONB
    DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ
    DEFAULT NOW(),

  updated_at TIMESTAMPTZ
    DEFAULT NOW()
);


-- =====================================================
-- MATRÍCULAS
-- =====================================================

CREATE TABLE IF NOT EXISTS enrollments (
  student_id INTEGER
    NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

  teacher_id INTEGER
    NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

  subject_id VARCHAR(120)
    NOT NULL
    REFERENCES subjects(id)
    ON DELETE CASCADE,

  created_at TIMESTAMPTZ
    DEFAULT NOW(),

  PRIMARY KEY (
    student_id,
    subject_id
  )
);


-- =====================================================
-- EXÁMENES
-- =====================================================

CREATE TABLE IF NOT EXISTS exams (
  id VARCHAR(160)
    PRIMARY KEY,

  teacher_id INTEGER
    NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

  subject_id VARCHAR(120)
    NOT NULL
    REFERENCES subjects(id)
    ON DELETE CASCADE,

  title VARCHAR(220)
    NOT NULL,

  instructions TEXT
    DEFAULT '',

  duration_minutes INTEGER
    NOT NULL
    CHECK (
      duration_minutes
      BETWEEN 1 AND 480
    ),

  form_url TEXT
    DEFAULT '',

  status VARCHAR(30)
    NOT NULL
    DEFAULT 'draft'
    CHECK (
      status IN (
        'draft',
        'published'
      )
    ),

  created_at TIMESTAMPTZ
    DEFAULT NOW(),

  updated_at TIMESTAMPTZ
    DEFAULT NOW()
);


-- =====================================================
-- INCIDENTES
-- =====================================================

CREATE TABLE IF NOT EXISTS incidents (
  id BIGSERIAL
    PRIMARY KEY,

  student_id INTEGER
    NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

  subject_id VARCHAR(120)
    REFERENCES subjects(id)
    ON DELETE SET NULL,

  exam_id VARCHAR(160)
    REFERENCES exams(id)
    ON DELETE SET NULL,

  type VARCHAR(60)
    NOT NULL,

  message TEXT
    DEFAULT '',

  severity VARCHAR(30)
    DEFAULT 'warning',

  occurred_at TIMESTAMPTZ
    NOT NULL
    DEFAULT NOW()
);


-- =====================================================
-- MUESTRAS DE ATENCIÓN
-- =====================================================

CREATE TABLE IF NOT EXISTS attention_samples (
  id BIGSERIAL
    PRIMARY KEY,

  student_id INTEGER
    NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

  subject_id VARCHAR(120)
    REFERENCES subjects(id)
    ON DELETE SET NULL,

  attention NUMERIC(5,2)
    NOT NULL
    DEFAULT 0,

  expression VARCHAR(80)
    DEFAULT 'Neutral',

  gaze VARCHAR(80)
    DEFAULT '',

  label VARCHAR(80)
    DEFAULT '',

  captured_at TIMESTAMPTZ
    NOT NULL
    DEFAULT NOW()
);


-- =====================================================
-- GOOGLE CLASSROOM - CAMPOS EXTRA
-- =====================================================

-- Cambios aditivos:
-- instalaciones existentes conservan sus datos.

ALTER TABLE subjects
ADD COLUMN IF NOT EXISTS classroom_owner_user_id
INTEGER
REFERENCES users(id)
ON DELETE SET NULL;


ALTER TABLE subjects
ADD COLUMN IF NOT EXISTS classroom_teachers
JSONB
NOT NULL
DEFAULT '[]'::jsonb;


ALTER TABLE subjects
ADD COLUMN IF NOT EXISTS classroom_synced_at
TIMESTAMPTZ;


-- =====================================================
-- SESIONES
-- =====================================================

CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash TEXT
    PRIMARY KEY,

  user_id INTEGER
    NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

  active_role VARCHAR(30)
    CHECK (
      active_role IN (
        'student',
        'teacher',
        'admin'
      )
    ),

  expires_at TIMESTAMPTZ
    NOT NULL
);


-- Para instalaciones que ya tenían app_sessions.
ALTER TABLE app_sessions
ADD COLUMN IF NOT EXISTS active_role
VARCHAR(30);


-- Crear constraint solamente mediante lógica compatible
-- con bases existentes.
DO $$
BEGIN

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'app_sessions_active_role_check'
  ) THEN

    ALTER TABLE app_sessions
    ADD CONSTRAINT app_sessions_active_role_check
    CHECK (
      active_role IS NULL
      OR active_role IN (
        'student',
        'teacher',
        'admin'
      )
    );

  END IF;

END $$;


-- Las sesiones anteriores reciben el rol principal.
UPDATE app_sessions s

SET active_role = u.role

FROM users u

WHERE
  s.user_id = u.id

AND
  s.active_role IS NULL;


-- =====================================================
-- CONEXIONES GOOGLE CLASSROOM
-- =====================================================

CREATE TABLE IF NOT EXISTS classroom_connections (
  id SERIAL
    PRIMARY KEY,

  -- Una conexión pertenece a la PERSONA,
  -- no al rol activo.
  user_id INTEGER
    NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

  -- Una cuenta Google no puede estar vinculada
  -- a dos usuarios ClassFocus diferentes.
  google_sub TEXT
    UNIQUE
    NOT NULL,

  email TEXT
    NOT NULL,

  display_name TEXT
    NOT NULL,

  encrypted_tokens TEXT
    NOT NULL,

  updated_at TIMESTAMPTZ
    NOT NULL
    DEFAULT NOW()
);


-- Evitar más de una conexión Google por usuario.
CREATE UNIQUE INDEX IF NOT EXISTS
idx_classroom_connections_user
ON classroom_connections(user_id);


-- =====================================================
-- ESTADOS OAUTH
-- =====================================================

CREATE TABLE IF NOT EXISTS classroom_oauth_states (
  state_hash TEXT
    PRIMARY KEY,

  nonce_hash TEXT
    NOT NULL,

  user_id INTEGER
    NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE,

  session_hash TEXT
    NOT NULL
    REFERENCES app_sessions(token_hash)
    ON DELETE CASCADE,

  verifier TEXT
    NOT NULL,

  expires_at TIMESTAMPTZ
    NOT NULL
);


-- =====================================================
-- PERSONAS GOOGLE CLASSROOM
-- =====================================================

CREATE TABLE IF NOT EXISTS classroom_people (
  google_sub TEXT
    PRIMARY KEY,

  user_id INTEGER
    UNIQUE
    NOT NULL
    REFERENCES users(id)
    ON DELETE CASCADE
);


-- =====================================================
-- ÍNDICES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_user_roles_role
ON user_roles(role);


CREATE INDEX IF NOT EXISTS idx_user_roles_user
ON user_roles(user_id);


CREATE INDEX IF NOT EXISTS idx_enrollments_teacher
ON enrollments(teacher_id);


CREATE INDEX IF NOT EXISTS idx_incidents_student
ON incidents(
  student_id,
  occurred_at DESC
);


CREATE INDEX IF NOT EXISTS idx_samples_student
ON attention_samples(
  student_id,
  captured_at DESC
);


CREATE INDEX IF NOT EXISTS idx_exams_subject
ON exams(
  subject_id,
  status
);


CREATE INDEX IF NOT EXISTS idx_sessions_user
ON app_sessions(user_id);


CREATE INDEX IF NOT EXISTS idx_sessions_expiration
ON app_sessions(expires_at);

`


// =====================================================
// INICIALIZAR BASE
// =====================================================

export async function initializeDatabase() {

  await pool.query(schema)

  await seedDatabase()
}


// =====================================================
// DATOS DEMO
// =====================================================

async function seedDatabase() {

  const users = [

    [
      1,
      'Alumno Demo',
      'student@classfocus.com',
      'student'
    ],

    [
      2,
      'Ing. Carlos Méndez',
      'teacher@classfocus.com',
      'teacher'
    ],

    [
      3,
      'Super Administrador',
      'admin@classfocus.com',
      'admin'
    ],

    [
      4,
      'María López',
      'maria@classfocus.com',
      'student'
    ],

    [
      5,
      'Lic. Ana García',
      'ana@classfocus.com',
      'teacher'
    ],

    [
      6,
      'José Pérez',
      'jose@classfocus.com',
      'student'
    ]

  ]


  // Contraseña demo:
  // 123456

  const passwordHash =
    await bcrypt.hash(
      '123456',
      10
    )


  // ===================================================
  // USUARIOS DEMO
  // ===================================================

  for (
    const [
      id,
      name,
      email,
      role
    ]
    of users
  ) {

    await pool.query(
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
        'classfocus'
      )

      ON CONFLICT (id)

      DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,

        -- Este sigue siendo únicamente
        -- el perfil principal por compatibilidad.
        role = EXCLUDED.role,

        updated_at = NOW()
      `,
      [
        id,
        name,
        email,
        passwordHash,
        role
      ]
    )


    // Registrar también el rol
    // en el nuevo sistema multirrol.
    await pool.query(
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
        id,
        role
      ]
    )

  }


  // Ajustar secuencia del ID.
  await pool.query(
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


  // ===================================================
  // MATERIAS DEMO
  // ===================================================

  const subjects = [

    [
      'prog1',
      'Programación I',
      'SIS-101'
    ],

    [
      'db1',
      'Base de Datos I',
      'SIS-202'
    ],

    [
      'math1',
      'Matemática I',
      'MAT-101'
    ],

    [
      'net1',
      'Redes I',
      'RED-201'
    ],

    [
      'web1',
      'Desarrollo Web',
      'SIS-220'
    ]

  ]


  for (
    const [
      id,
      name,
      code
    ]
    of subjects
  ) {

    await pool.query(
      `
      INSERT INTO subjects (
        id,
        name,
        code
      )

      VALUES (
        $1,
        $2,
        $3
      )

      ON CONFLICT (id)
      DO NOTHING
      `,
      [
        id,
        name,
        code
      ]
    )

  }


  // ===================================================
  // MATRÍCULAS DEMO
  // ===================================================

  const enrollments = [

    [
      1,
      2,
      'prog1'
    ],

    [
      1,
      2,
      'db1'
    ],

    [
      4,
      2,
      'prog1'
    ],

    [
      4,
      2,
      'web1'
    ],

    [
      6,
      5,
      'math1'
    ],

    [
      6,
      5,
      'net1'
    ]

  ]


  for (
    const [
      studentId,
      teacherId,
      subjectId
    ]
    of enrollments
  ) {

    await pool.query(
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

      DO NOTHING
      `,
      [
        studentId,
        teacherId,
        subjectId
      ]
    )

  }


  // ===================================================
  // EXAMEN DEMO
  // ===================================================

  await pool.query(
    `
    INSERT INTO exams (
      id,
      teacher_id,
      subject_id,
      title,
      instructions,
      duration_minutes,
      form_url,
      status
    )

    VALUES (
      'exam-demo-prog1',
      2,
      'prog1',
      'Parcial 1 · Programación I',

      'Responde todas las preguntas. Mantén la cámara activa durante toda la evaluación.',

      35,
      '',
      'published'
    )

    ON CONFLICT (id)
    DO NOTHING
    `
  )

}


// =====================================================
// TRANSACCIONES
// =====================================================

export async function withTransaction(
  callback
) {

  const client =
    await pool.connect()

  try {

    await client.query(
      'BEGIN'
    )

    const result =
      await callback(
        client
      )

    await client.query(
      'COMMIT'
    )

    return result

  } catch (error) {

    await client.query(
      'ROLLBACK'
    )

    throw error

  } finally {

    client.release()

  }

}