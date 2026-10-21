// Los errores de los dispositivos se traducen por su nombre, no por el texto del navegador.
export function classroomError(error, action = 'general') {
  const name = error?.name
  const device = action === 'microphone' ? 'micrófono' : action === 'camera' ? 'cámara' : action === 'speaker' ? 'altavoz' : 'dispositivo'
  if (['NotFoundError', 'DevicesNotFoundError'].includes(name)) {
    return `No se encontró ${device === 'cámara' ? 'ninguna cámara disponible' : `ningún ${device} disponible`}. Conecta o habilita ${device === 'cámara' ? 'una' : 'uno'} e intenta de nuevo.`
  }
  if (['NotAllowedError', 'PermissionDeniedError'].includes(name)) return action === 'screen'
    ? 'No se compartió ninguna pantalla. Puedes volver a intentarlo.'
    : `No se concedió permiso para usar ${device === 'cámara' ? 'la cámara' : `el ${device}`}. Revisa los permisos del navegador e intenta de nuevo.`
  if (['NotReadableError', 'TrackStartError'].includes(name)) return `No se pudo acceder ${device === 'cámara' ? 'a la cámara' : `al ${device}`}. Puede estar en uso por otra aplicación o deshabilitado en el sistema.`
  if (['OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(name)) return 'El dispositivo no admite la configuración solicitada. Prueba con otro dispositivo.'
  if (name === 'AbortError') return 'La solicitud se interrumpió. Puedes intentarlo de nuevo.'
  if (name === 'SecurityError') return 'El navegador bloqueó el acceso. Abre la aplicación en localhost o HTTPS y revisa sus permisos.'
  // Los mensajes propios de sesión y permisos ya vienen en español del servidor.
  const message = typeof error === 'string' ? error : error?.message || ''
  if (/^(No (se|tienes)|La (sesión|conexión|sala)|El maestro|Tu (sesión|perfil)|Inicia|Ya |Entra|Pide|Solo |Abre |Un alumno|Ese alumno|Sal |Los avisos|Demasiados|La clase)/.test(message)) return message
  if (action === 'speaker') return 'No se pudo reproducir el sonido de prueba. Revisa tus altavoces y el volumen.'
  if (action === 'fullscreen') return 'No se pudo abrir la pantalla completa. Puedes continuar con la vista actual.'
  if (action === 'screen') return 'No se pudo compartir la pantalla. Elige una ventana e intenta de nuevo.'
  if (action === 'microphone' || action === 'camera') return `No se pudo activar ${device === 'cámara' ? 'la cámara' : `el ${device}`}. Revisa que esté conectado y habilitado.`
  return 'No se pudo completar la acción. Intenta de nuevo.'
}

// El alumno solo construye mosaicos del maestro y de sí mismo, nunca de sus compañeros.
export function meetingParticipants(role, user, view) {
  const self = { id: 'self', name: `${user.name} (tú)`, stream: view?.local || null, self: true,
    detail: role === 'teacher' ? 'Maestro' : 'Solo el maestro ve tu cámara' }
  if (role === 'teacher') return [self, ...(view?.room?.students || []).map(student => ({
    id: student.peerId, name: student.name, stream: view.remotes.get(student.peerId)?.stream || null,
    hand: student.hand, floor: view.room.floorId === student.peerId, detail: student.hand ? 'Pide la palabra' : view.room.floorId === student.peerId ? 'Tiene la palabra' : 'Alumno'
  }))]
  const teacher = view?.room?.teacher
  return [{ id: teacher?.peerId || 'teacher', name: teacher?.name || 'Tu maestro',
    stream: teacher && view.room.teacherVideo?.source !== 'off' ? view.remotes.get(teacher.peerId)?.stream || null : null,
    videoRevision: view?.room?.teacherVideo?.revision || 0, detail: 'Maestro / presentación' }, self]
}

export function focusedParticipant(participants, pinnedId, floorId) {
  return participants.find(item => item.id === pinnedId) || participants.find(item => item.id === floorId) ||
    participants.find(item => !item.self) || participants[0]
}
