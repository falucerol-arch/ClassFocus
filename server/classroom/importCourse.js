import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { HttpError } from '../errors.js'

// La transacción conserva el curso anterior completo si falla cualquier alumno o matrícula.
export async function importCourse({ transaction, course, user }) {
  if (user.role !== 'teacher') throw new HttpError(403, 'La importación está disponible en el panel del maestro.')
  if (!course.id || !course.name || !Array.isArray(course.students)) throw new HttpError(422, 'Google devolvió un curso incompleto.')
  for (const student of course.students) {
    if (!student.userId || !student.profile?.emailAddress) {
      throw new HttpError(422, 'Google no permite leer el correo de todos los alumnos. No se importó una lista parcial; revisa los permisos de correos.')
    }
  }

  return transaction(async client => {
    // Serializa las importaciones para evitar duplicados de personas entre cursos concurrentes.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('classfocus-classroom-import'))")
    const found = await client.query('SELECT * FROM subjects WHERE classroom_id=$1 FOR UPDATE', [course.id])
    if (found.rows.length > 1) throw new HttpError(409, 'Existen materias antiguas duplicadas para este curso. Deben revisarse antes de sincronizar.')
    const previous = found.rows[0]
    if (previous?.classroom_owner_user_id && Number(previous.classroom_owner_user_id) !== Number(user.id)) {
      throw new HttpError(409, 'Otro maestro ya administra este curso en ClassFocus. En esta versión cada curso tiene un responsable de sincronización.')
    }
    const subjectId = previous?.id || `gc-${course.id}`
    const code = previous?.code || `GC-${course.id}`
    // Una sección como «C» puede repetirse en universidades distintas; no sirve como identificador.
    await client.query(`INSERT INTO subjects
      (id,name,code,section,default_teacher_id,source,classroom_id,classroom_url,classroom_owner_user_id,classroom_teachers,classroom_synced_at)
      VALUES ($1,$2,$3,$4,$5,'google-classroom',$6,$7,$5,$8::jsonb,NOW())
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,section=EXCLUDED.section,
      default_teacher_id=EXCLUDED.default_teacher_id,source='google-classroom',classroom_id=EXCLUDED.classroom_id,
      classroom_url=EXCLUDED.classroom_url,classroom_owner_user_id=EXCLUDED.classroom_owner_user_id,
      classroom_teachers=EXCLUDED.classroom_teachers,classroom_synced_at=NOW(),updated_at=NOW()`,
    [subjectId, course.name, code, course.section || '', user.id, course.id, course.alternateLink || '', JSON.stringify(course.teachers || [])])

    const studentIds = []
    let created = 0
    // Los usuarios nuevos quedan sin contraseña compartida; importar no equivale a habilitar acceso.
    const disabledPassword = await bcrypt.hash(randomBytes(32).toString('hex'), 10)
    for (const student of course.students) {
      const sub = String(student.userId)
      const email = student.profile.emailAddress.trim().toLowerCase()
      const name = student.profile.name?.fullName || email
      const identity = await client.query(`SELECT u.* FROM classroom_people p
        JOIN users u ON u.id=p.user_id WHERE p.google_sub=$1`, [sub])
      const matching = identity.rows[0] ? identity : await client.query('SELECT * FROM users WHERE LOWER(email)=$1', [email])
      if (matching.rows.length > 1) throw new HttpError(409, 'Hay correos duplicados en ClassFocus. Corrígelos antes de importar.')
      let local = matching.rows[0]
      if (local && local.role !== 'student') throw new HttpError(409, `El correo ${email} tiene otro rol en ClassFocus. Esta versión admite un rol por usuario; no se modificó su cuenta.`)
      if (!local) {
        const result = await client.query(`INSERT INTO users (name,email,password_hash,role,source)
          VALUES ($1,$2,$3,'student','google-classroom') RETURNING *`, [name, email, disabledPassword])
        local = result.rows[0]
        created += 1
      } else if (local.source === 'google-classroom') {
        // Mantiene perfiles importados al día sin sobrescribir perfiles locales ni sus contraseñas.
        await client.query('UPDATE users SET name=$1,email=$2,updated_at=NOW() WHERE id=$3', [name, email, local.id])
      }
      const byUser = await client.query('SELECT google_sub FROM classroom_people WHERE user_id=$1', [local.id])
      if (byUser.rows[0] && byUser.rows[0].google_sub !== sub) throw new HttpError(409, 'Dos identidades de Google coinciden con el mismo usuario local. Revisa sus correos.')
      await client.query(`INSERT INTO classroom_people (google_sub,user_id) VALUES ($1,$2)
        ON CONFLICT (google_sub) DO NOTHING`, [sub, local.id])
      studentIds.push(Number(local.id))
    }

    // Se reemplaza únicamente la matrícula de este curso; los usuarios e incidencias se conservan.
    const removed = await client.query('DELETE FROM enrollments WHERE subject_id=$1 AND NOT (student_id=ANY($2::int[])) RETURNING student_id', [subjectId, studentIds])
    for (const studentId of new Set(studentIds)) {
      await client.query(`INSERT INTO enrollments (student_id,teacher_id,subject_id) VALUES ($1,$2,$3)
        ON CONFLICT (student_id,subject_id) DO UPDATE SET teacher_id=EXCLUDED.teacher_id`, [studentId, user.id, subjectId])
    }
    return { subjectId, subjectName: course.name, studentsImported: new Set(studentIds).size, studentsCreated: created, enrollmentsRemoved: removed.rowCount }
  })
}
