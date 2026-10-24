import test from 'node:test'
import assert from 'node:assert/strict'
import { classroomError, focusedParticipant, meetingParticipants, meetingPresentation } from '../src/services/classroomUi.js'

test('UI: un micrófono o cámara ausentes muestran instrucciones en español', () => {
  assert.match(classroomError({ name: 'NotFoundError', message: 'Requested device not found' }, 'microphone'), /ningún micrófono disponible/)
  assert.match(classroomError({ name: 'NotFoundError' }, 'camera'), /ninguna cámara disponible/)
  assert.doesNotMatch(classroomError(new Error('Requested device not found'), 'microphone'), /Requested/)
  assert.match(classroomError({ name: 'NotReadableError' }, 'microphone'), /otra aplicación/)
})
test('UI: cancelar presentación y rechazar permisos tienen mensajes específicos', () => {
  assert.match(classroomError({ name: 'NotAllowedError' }, 'screen'), /No se compartió ninguna pantalla/)
  assert.match(classroomError({ name: 'NotAllowedError' }, 'camera'), /permiso para usar la cámara/)
  assert.equal(classroomError('La sesión venció. Inicia sesión nuevamente.'), 'La sesión venció. Inicia sesión nuevamente.')
  assert.match(classroomError(new Error('Fullscreen unavailable'), 'fullscreen'), /pantalla completa/)
})
test('UI: mosaico del alumno incluye solo al maestro y a sí mismo', () => {
  const view = { local: 'own', room: { teacher: { peerId: 'teacher', name: 'Docente' }, students: [{ peerId: 'other', name: 'Otro' }], floorId: 'other' },
    remotes: new Map([['teacher', { stream: 'teacher-video' }], ['other', { stream: 'private-video' }]]) }
  const items = meetingParticipants('student', { name: 'Alumno' }, view)
  assert.deepEqual(items.map(item => item.stream), ['teacher-video', 'own'])
  assert.ok(!items.some(item => item.id === 'other'))
})
test('UI: al maestro le aparecen alumnos en el mismo mosaico, con turno y mano', () => {
  const view = { room: { students: [{ peerId: 's', name: 'Alumno', hand: true }], floorId: 's' }, remotes: new Map([['s', { stream: 'video' }]]) }
  const items = meetingParticipants('teacher', { name: 'Docente' }, view)
  assert.equal(items.length, 2)
  assert.equal(items[1].hand, true)
  assert.equal(items[1].floor, true)
  assert.equal(focusedParticipant(items, 'self', 's').id, 'self')
  assert.equal(focusedParticipant(items, 'disconnected', 's').id, 's')
  assert.equal(focusedParticipant([items[0]], 's', 's').id, 'self')
})

test('presentación: una fuente apagada no entrega al video la pista remota congelada', () => {
  const remote = { getVideoTracks: () => [] }
  const view = { room: { teacher: { peerId: 't', name: 'Docente' }, teacherVideo: { source: 'screen', revision: 1 } }, remotes: new Map([['t', { stream: remote }]]) }
  const visible = () => meetingParticipants('student', { name: 'Alumno' }, view)[0]
  assert.equal(visible().stream, remote)
  view.room.teacherVideo = { source: 'off', revision: 2 }
  assert.equal(visible().stream, null)
  assert.equal(visible().videoRevision, 2)
  assert.equal(view.remotes.get('t').stream, remote, 'La pista conserva el audio; solo se retira del reproductor de video.')
  view.room.teacherVideo = { source: 'camera', revision: 3 }
  assert.equal(visible().stream, remote)
  assert.equal(visible().videoRevision, 3)
})

test('cámara del alumno: el apagado retira el último fotograma en la vista del maestro', () => {
  const stream = { video: 'último fotograma' }
  const student = { peerId: 's', name: 'Alumno', video: { source: 'camera', revision: 1 } }
  const view = { room: { students: [student] }, remotes: new Map([['s', { stream }]]) }
  assert.equal(meetingParticipants('teacher', { name: 'Docente' }, view)[1].stream, stream)
  student.video = { source: 'off', revision: 2 }
  const tile = meetingParticipants('teacher', { name: 'Docente' }, view)[1]
  assert.equal(tile.stream, null)
  assert.equal(tile.videoRevision, 2)
  assert.equal(view.remotes.get('s').stream, stream)
})


test('presentación del alumno: llega al grupo sin exponer las cámaras privadas', () => {
  const stream = 'pantalla del alumno', camera = 'cámara privada'
  const room = { teacher: { peerId: 't', name: 'Docente' }, teacherVideo: { source: 'off' },
    students: [{ peerId: 's', name: 'Alumno', video: { source: 'screen', revision: 1 } }],
    floorId: 's', presentation: { peerId: 's', name: 'Alumno', revision: 1 } }
  const teacher = { room, remotes: new Map([['s', { stream: camera, presentation: stream }]]) }
  assert.equal(meetingPresentation('teacher', {}, teacher).stream, stream)
  const viewer = { room, peerId: 'other', local: camera, remotes: new Map([['t', { stream: 'cámara docente', presentation: stream }], ['s', { stream: camera }]]) }
  assert.equal(meetingPresentation('student', {}, viewer).stream, stream)
  const tiles = meetingParticipants('student', { name: 'Otro' }, viewer)
  assert.equal(tiles[0].stream, null)
  assert.ok(!tiles.some(tile => tile.id === 's'))
  const presenter = { ...viewer, peerId: 's', sharing: true, presentation: stream }
  assert.equal(meetingPresentation('student', {}, presenter).stream, stream)
  assert.equal(meetingParticipants('student', { name: 'Alumno' }, presenter)[0].stream, null)
  room.presentation = null
  assert.equal(meetingPresentation('student', {}, viewer).stream, null)
})
