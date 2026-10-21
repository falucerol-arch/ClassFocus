import { useEffect, useRef, useState } from 'react'
import { LiveClass } from '../services/liveClassService'
import { FaceAnalyzer } from '../core/FaceAnalyzer'
import { ArrowLeft, Hand, LayoutGrid, Maximize2, Mic, MicOff, Minimize2, MonitorUp, MoreHorizontal, PanelLeft, PhoneOff, Pin, PinOff, Presentation, UsersRound, Video as VideoIcon, VideoOff, X } from 'lucide-react'
import ThemeToggle from './ThemeToggle'
import DevicePreview from './DevicePreview'
import { classroomError, focusedParticipant, meetingParticipants } from '../services/classroomUi'
import './LiveClassroom.css'

function Video({ stream, label, placeholder = 'Cámara apagada' }) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const video = ref.current
    video.pause()
    video.srcObject = stream || null
    if (!stream) video.load?.()
    const tracks = stream?.getVideoTracks() || []
    const update = () => setVisible(tracks.some(t => !t.muted && t.readyState === 'live'))
    for (const track of tracks) for (const event of ['mute', 'unmute', 'ended']) track.addEventListener(event, update)
    update()
    if (stream) video.play().catch(() => {})
    return () => {
      for (const track of tracks) for (const event of ['mute', 'unmute', 'ended']) track.removeEventListener(event, update)
      video.pause()
      video.srcObject = null
      video.load?.()
    }
  }, [stream])
  return <div className="class-video"><video ref={ref} autoPlay muted playsInline />
    <span>{label}</span>{!visible && <div className="meeting-video-placeholder"><div>{label.split(' ').slice(0, 2).map(word => word[0]).join('')}</div><p>{stream ? 'Conectando video…' : placeholder}</p></div>}</div>
}

// El navegador puede bloquear audio automático. El botón permite habilitarlo con un clic.
function Audio({ stream, label, outputId = '' }) {
  const ref = useRef(null)
  const [blocked, setBlocked] = useState(false)
  const [outputFailed, setOutputFailed] = useState(false)
  useEffect(() => {
    const audio = ref.current
    let disposed = false
    audio.srcObject = stream || null
    setBlocked(false); setOutputFailed(false)
    if (stream) (async () => {
      if (outputId && audio.setSinkId) {
        try { await audio.setSinkId(outputId) }
        catch { if (!disposed) { setOutputFailed(true); setBlocked(true) }; return }
      }
      if (!disposed) await audio.play()
    })().catch(() => { if (!disposed) setBlocked(true) })
    return () => { disposed = true; audio.pause(); audio.srcObject = null }
  }, [stream, outputId])
  return <><audio ref={ref} />{blocked && <><span>{outputFailed ? 'No se pudo utilizar la salida de audio elegida. ' : ''}</span><button type="button" onClick={async () => {
    try { if (outputFailed && ref.current.setSinkId) await ref.current.setSinkId(''); await ref.current.play(); setBlocked(false); setOutputFailed(false) }
    catch { setBlocked(true) }
  }}>{outputFailed ? 'Escuchar en la salida predeterminada' : `Escuchar ${label}`}</button></>}</>
}

function Attention({ stream, onMetric }) {
  const videoRef = useRef(null)
  const callback = useRef(onMetric)
  callback.current = onMetric
  const [text, setText] = useState('Activa tu cámara para analizar la atención.')
  useEffect(() => {
    if (!stream) { setText('Activa tu cámara para analizar la atención.'); return }
    let disposed = false
    let timer
    const analyzer = new FaceAnalyzer()
    const video = videoRef.current
    video.srcObject = stream
    setText('Preparando análisis de atención…')
    ;(async () => {
      await video.play()
      await analyzer.initialize()
      if (disposed) { analyzer.close(); return }
      timer = setInterval(() => {
        try {
          const metric = analyzer.analyze(video)
          if (!metric) return
          setText(metric.hasFace ? `Atención estimada: ${metric.attention}% · ${metric.gaze}` : 'No se detecta un rostro.')
          callback.current?.(metric)
        } catch {
          clearInterval(timer)
          setText('El análisis no está disponible. Puedes continuar en la clase.')
        }
      }, 500)
    })().catch(() => { if (!disposed) setText('El análisis no está disponible. Puedes continuar en la clase.') })
    return () => { disposed = true; clearInterval(timer); analyzer.close(); video.srcObject = null }
  }, [stream])
  return <div className="class-attention"><video ref={videoRef} muted playsInline className="class-analysis-video" /><small>{text}</small></div>
}

function Control({ icon: Icon, label, onClick, disabled, pressed, danger = false }) {
  return <button type="button" className={`meeting-control ${pressed ? 'is-on' : ''} ${danger ? 'is-danger' : ''}`}
    aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
    <Icon size={21} aria-hidden="true" /><span>{label}</span></button>
}

function Tile({ participant, pinned, fullscreen, onPin, onExpand, onManage, compact = false }) {
  return <article className={`meeting-tile ${participant.floor ? 'has-floor' : ''} ${compact ? 'is-compact' : ''}`} aria-label={participant.name}>
    <Video key={participant.videoRevision || 0} stream={participant.stream} label={participant.name} />
    <div className="meeting-tile-badges">{participant.hand && <span><Hand size={14} /> Pide la palabra</span>}
      {participant.floor && <span>Tiene la palabra</span>}{pinned && <span><Pin size={13} /> Fijado</span>}</div>
    <div className="meeting-tile-tools"><button type="button" title={pinned ? 'Quitar fijación' : 'Fijar video'}
      aria-label={`${pinned ? 'Dejar de fijar' : 'Fijar a'} ${participant.name}`} aria-pressed={pinned} onClick={() => onPin(participant.id)}>
      {pinned ? <PinOff size={16} /> : <Pin size={16} />}</button>
      {!compact && <button type="button" title={fullscreen ? 'Salir de pantalla completa' : 'Ampliar video'} aria-label={`${fullscreen ? 'Reducir a' : 'Ampliar a'} ${participant.name}`} onClick={() => onExpand(participant.id)}>
        {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>}
      {onManage && !participant.self && <button type="button" aria-label={`Gestionar a ${participant.name}`} title="Acciones del alumno" onClick={() => onManage(participant.id)}><MoreHorizontal size={17} /></button>}
    </div>
  </article>
}

function LeaveDialog({ teacher, onCancel, onConfirm }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog.showModal) dialog.showModal()
    else dialog.setAttribute('open', '')
    return () => { if (dialog.open) dialog.close?.() }
  }, [])
  return <dialog ref={ref} className="meeting-dialog" aria-labelledby="leave-title" aria-describedby="leave-description"
    onCancel={event => { event.preventDefault(); onCancel() }}>
    <h2 id="leave-title">{teacher ? '¿Finalizar la clase para todos?' : '¿Salir de la clase?'}</h2>
    <p id="leave-description">{teacher ? 'Los alumnos se desconectarán y se detendrán tu cámara, micrófono y presentación.' : 'Se detendrán tu cámara y micrófono. Puedes volver a entrar mientras la clase siga activa.'}</p>
    <div><button type="button" autoFocus onClick={onCancel}>Continuar en clase</button>
      <button type="button" className="is-danger" onClick={onConfirm}>{teacher ? 'Finalizar para todos' : 'Salir de clase'}</button></div>
  </dialog>
}

export default function LiveClassroom({ role, user, subject, onMetric, onExit }) {
  const teacher = role === 'teacher'
  const [view, setView] = useState(null)
  const [active, setActive] = useState(false)
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')
  const [layout, setLayout] = useState(teacher ? 'grid' : 'focus')
  const [pinnedId, setPinnedId] = useState(null)
  const [peopleOpen, setPeopleOpen] = useState(teacher)
  const [fullscreen, setFullscreen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [selectedPeer, setSelectedPeer] = useState(null)
  const previewRef = useRef(null)
  const selectionRef = useRef(null)
  const controller = useRef(null)
  const mounted = useRef(true)
  const root = useRef(null)
  const previousLayout = useRef(layout)
  const wasSharing = useRef(false)
  useEffect(() => {
    mounted.current = true
    const update = () => setFullscreen(document.fullscreenElement === root.current)
    document.addEventListener('fullscreenchange', update)
    return () => {
      mounted.current = false
      document.removeEventListener('fullscreenchange', update)
      controller.current?.stop()
    }
  }, [])
  useEffect(() => {
    if (!active) return
    // El navegador ofrece su confirmación nativa al cerrar o recargar una llamada activa.
    const warn = event => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [active])
  useEffect(() => {
    const sharing = teacher ? !!view?.sharing : view?.room?.teacherVideo?.source === 'screen'
    if (sharing && !wasSharing.current) { previousLayout.current = layout; setLayout('presentation') }
    if (!sharing && wasSharing.current) setLayout(previousLayout.current)
    wasSharing.current = sharing
  }, [view?.sharing, view?.room?.teacherVideo?.source, teacher])

  async function perform(action, kind = 'general') {
    setPending(kind); setError('')
    try { await action() }
    catch (failure) { if (mounted.current) setError(classroomError(failure, kind)) }
    finally { if (mounted.current) setPending('') }
  }
  async function join() {
    const call = new LiveClass({ subjectId: subject.id, role,
      token: sessionStorage.getItem('classfocus_api_token'),
      onChange: state => { if (mounted.current && controller.current === call) setView(state) },
      onError: failure => { if (mounted.current) setError(classroomError(failure)) },
      onClose: () => { if (mounted.current) { setActive(false); setView(null); setLeaving(false) } } })
    controller.current = call
    call.adoptMedia(previewRef.current?.takeForCall(role))
    setPreviewBusy(false)
    setActive(true)
    try { await call.connect() } catch (failure) { call.stop(); throw failure }
  }
  async function toggleFullscreen() {
    if (document.fullscreenElement === root.current) await document.exitFullscreen()
    else {
      if (!root.current?.requestFullscreen) throw new Error('Pantalla completa no disponible')
      await root.current.requestFullscreen()
    }
  }
  function finishExit() {
    controller.current?.stop()
    controller.current = null
    if (document.fullscreenElement === root.current) document.exitFullscreen().catch(() => {})
    onExit()
  }
  function requestExit() { if (active) setLeaving(true); else finishExit() }
  function manage(id) { setSelectedPeer(id); setPeopleOpen(true) }
  function pin(id) { setPinnedId(current => current === id ? null : id); setLayout('focus') }
  function expand(id) {
    // Consulta el estado real: Escape y el botón superior también pueden cerrar la pantalla completa.
    if (document.fullscreenElement !== root.current) { setPinnedId(id); setLayout('focus') }
    perform(toggleFullscreen, 'fullscreen')
  }

  const room = view?.room
  const me = room?.students.find(student => student.peerId === view.peerId)
  const myFloor = !!view?.peerId && room?.floorId === view.peerId
  const speaker = room?.students.find(student => student.peerId === room.floorId)
  const instructor = room && view.remotes.get(room.teacher.peerId)
  const participants = meetingParticipants(role, user, view)
  const instructorVideo = participants.find(item => !item.self)
  const focused = focusedParticipant(participants, pinnedId, room?.floorId)
  const raised = room?.students.filter(student => student.hand).length || 0
  const busy = !!pending
  const count = room ? room.students.length + 1 : 1
  const selectedStudent = room?.students.find(student => student.peerId === selectedPeer)
  useEffect(() => {
    if (selectedStudent && peopleOpen) selectionRef.current?.focus()
  }, [selectedPeer, peopleOpen])
  const sortedStudents = [...(room?.students || [])].sort((a, b) => Number(b.hand) - Number(a.hand) || a.name.localeCompare(b.name, 'es'))

  return <main ref={root} className={`meeting-room ${active ? 'is-active' : 'is-lobby'}`} aria-label={`Aula de ${subject.name}`}>
    <header className="meeting-header">
      <div className="meeting-heading"><button type="button" className="meeting-back" aria-label="Volver al panel" title="Volver al panel" onClick={requestExit}><ArrowLeft size={20} /></button>
        <div><span className="meeting-eyebrow">CLASSFOCUS / AULA</span><h1>{subject.name}</h1><small>{subject.code}{subject.section ? ` · ${subject.section}` : ''}</small></div></div>
      <div className="meeting-header-actions"><span className={`meeting-status ${view?.joined ? 'is-connected' : ''}`} role="status"><i />{active ? view?.joined ? 'En clase' : 'Conectando…' : 'Antes de entrar'}</span>
        <ThemeToggle compact /><button type="button" className="meeting-icon-button" aria-label={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'} title={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'} onClick={() => perform(toggleFullscreen, 'fullscreen')}>
          {fullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}</button></div>
    </header>
    {error && <div role="alert" className="meeting-message is-error"><span>{error}</span><button type="button" aria-label="Cerrar error" onClick={() => setError('')}><X size={18} /></button></div>}
    {!active ? <section className="meeting-lobby">
      <DevicePreview ref={previewRef} name={user.name} teacher={teacher} onError={setError} onBusy={setPreviewBusy} />
      <div className="meeting-lobby-copy"><span className="meeting-eyebrow">{teacher ? 'TU AULA, LISTA' : 'ESTÁS POR ENTRAR'}</span><h2>{teacher ? 'Todo listo para tu clase' : 'Únete a tu clase'}</h2>
        <p>{teacher ? 'Presenta tu pantalla, organiza las intervenciones y elige cómo ver a tus alumnos.' : 'Verás al maestro y su presentación. Puedes levantar la mano cuando quieras participar.'}</p>
        <div className="meeting-lobby-note"><VideoOff size={20} /><span>{teacher ? 'Las cámaras de los alumnos solo las ves tú.' : 'Tu cámara solo se comparte con el maestro.'} Puedes probar tus dispositivos antes de entrar.</span></div>
        <button type="button" className="meeting-primary" disabled={busy || previewBusy} onClick={() => perform(join)}>{teacher ? 'Iniciar clase' : 'Entrar a clase'}</button>
      </div>
    </section> : <>
      <div className="meeting-viewbar"><div className="meeting-view-switch" aria-label="Distribución de videos">
        {[[ 'grid', LayoutGrid, 'Mosaico' ], [ 'focus', PanelLeft, 'Enfoque' ], [ 'presentation', Presentation, 'Presentación' ]].map(([id, Icon, label]) =>
          <button type="button" key={id} aria-pressed={layout === id} onClick={() => setLayout(id)}><Icon size={16} /><span>{label}</span></button>)}
      </div><span className="meeting-view-hint">{pinnedId && participants.some(item => item.id === pinnedId) ? 'Video fijado para ti' : teacher ? `${room?.students.length || 0} ${(room?.students.length || 0) === 1 ? 'alumno conectado' : 'alumnos conectados'}` : 'Las cámaras de tus compañeros solo las ve el maestro'}</span></div>
      {!teacher && myFloor && <div role="status" className="meeting-message is-floor"><Hand size={18} /><span>Tienes la palabra. Activa tu micrófono cuando quieras hablar.</span></div>}
      {!teacher && speaker && !myFloor && <div className="meeting-speaker">Tiene la palabra: {speaker.name}</div>}
      <div className="meeting-audio-permissions">
        {!teacher && <><Audio outputId={view?.outputId} stream={instructor?.stream} label="al maestro" /><Audio outputId={view?.outputId} stream={instructor?.floor} label="el turno de palabra" /></>}
        {teacher && speaker && <Audio outputId={view?.outputId} key={speaker.peerId} stream={view.remotes.get(speaker.peerId)?.stream} label={`a ${speaker.name}`} />}
      </div>
      <div className={`meeting-content ${peopleOpen ? 'with-people' : ''}`}>
        <section className={`meeting-stage view-${layout}`} aria-label="Videos de la clase" data-layout={layout}>
          {layout === 'grid' ? <div className="meeting-gallery">{participants.map(participant => <Tile key={participant.id} participant={participant} pinned={pinnedId === participant.id} fullscreen={fullscreen} onPin={pin} onExpand={expand} onManage={teacher ? manage : undefined} />)}</div> : <>
            <div className="meeting-focus">
              {layout === 'presentation' ? <div className="meeting-presentation"><Video key={teacher ? 'own-screen' : instructorVideo?.videoRevision || 0} stream={teacher ? view?.presentation : instructorVideo?.stream}
                label={teacher ? 'Tu presentación' : 'Maestro / presentación'} placeholder={teacher ? 'Comparte una ventana para presentar' : room?.teacherVideo?.source === 'off' ? 'Cámara del maestro apagada' : 'Esperando el video del maestro'} /></div> :
                <Tile participant={focused} pinned={pinnedId === focused.id} fullscreen={fullscreen} onPin={pin} onExpand={expand} onManage={teacher ? manage : undefined} />}
            </div>
            <div className="meeting-filmstrip" aria-label="Otros videos">{participants.filter(participant => layout === 'presentation' || participant.id !== focused.id).map(participant =>
              <Tile key={participant.id} participant={participant} pinned={pinnedId === participant.id} fullscreen={fullscreen} onPin={pin} onExpand={expand} onManage={teacher ? manage : undefined} compact />)}</div>
          </>}
        </section>
        {peopleOpen && <aside className="meeting-people" aria-label="Participantes">
          <div className="meeting-people-heading"><h2>Participantes <span>{count}</span></h2><button type="button" className="meeting-icon-button" aria-label="Cerrar participantes" onClick={() => setPeopleOpen(false)}><X size={19} /></button></div>
          {teacher && <p className="meeting-people-note">{raised ? `${raised} ${raised === 1 ? 'alumno pide' : 'alumnos piden'} la palabra` : 'Las solicitudes de palabra aparecen aquí.'}</p>}
          <div className="class-participant-list" aria-label="Lista de participantes">
            <div className="class-participant-row"><span className="class-participant-avatar">{user.name[0]}</span><div className="class-participant-info"><strong title={user.name}>{user.name} (tú)</strong><small>{teacher ? 'Maestro' : 'Alumno'}</small></div></div>
            {teacher ? sortedStudents.map(student => <button type="button" className="class-participant-row class-participant-choice" key={student.peerId}
              aria-label={`Seleccionar a ${student.name}`} aria-pressed={selectedPeer === student.peerId} onClick={() => manage(student.peerId)}>
              <span className={`class-participant-avatar ${student.hand ? 'has-hand' : ''}`}>{student.hand ? <Hand size={18} /> : student.name[0]}</span>
              <span className="class-participant-info"><strong title={student.name}>{student.name}</strong><small>{student.hand ? 'Pide la palabra' : room.floorId === student.peerId ? 'Tiene la palabra' : 'Alumno'}</small></span><MoreHorizontal size={18} />
            </button>) : <><div className="class-participant-row"><span className="class-participant-avatar">{room?.teacher.name?.[0] || 'M'}</span><div className="class-participant-info"><strong title={room?.teacher.name}>{room?.teacher.name || 'Maestro'}</strong><small>Maestro</small></div></div>
              <p className="meeting-people-note">{room?.students.length || 0} alumnos en esta clase. Ves tu cámara y la del maestro.</p></>}
          </div>
          {teacher && selectedStudent && <section ref={selectionRef} tabIndex={-1} className="class-participant-detail" aria-label={`Acciones para ${selectedStudent.name}`}>
            <div><strong>{selectedStudent.name}</strong><button type="button" className="meeting-icon-button" aria-label="Cerrar acciones del alumno" onClick={() => setSelectedPeer(null)}><X size={16} /></button></div>
            <small>{room.floorId === selectedStudent.peerId ? 'Tiene la palabra' : selectedStudent.hand ? 'Está pidiendo la palabra' : 'Alumno seleccionado'}</small>
            <button type="button" className="class-participant-floor" onClick={() => controller.current.floor(room.floorId === selectedStudent.peerId ? null : selectedStudent.peerId)}><Mic size={16} />{room.floorId === selectedStudent.peerId ? 'Quitar la palabra' : 'Dar la palabra'}</button>
            <button type="button" className="class-participant-focus" onClick={() => pin(selectedStudent.peerId)}><Pin size={15} />Ver enfocado</button>
          </section>}
          {teacher && !room?.students.length && <div className="meeting-waiting"><UsersRound size={30} /><p>Tu aula está abierta.</p><small>Los alumnos verán el aviso y podrán unirse desde su panel.</small></div>}
        </aside>}
      </div>
      <footer className="meeting-bottom"><div className="meeting-bottom-info"><strong>{subject.code || 'Clase en vivo'}</strong>
        {!teacher ? <Attention stream={view?.local} onMetric={onMetric} /> : <small>{view?.sharing ? 'Estás compartiendo pantalla' : 'Las cámaras de los alumnos son privadas'}</small>}</div>
        <div className="meeting-controls" aria-label="Controles de llamada">
          <Control icon={view?.microphone ? Mic : MicOff} label={view?.microphone ? 'Silenciar micrófono' : 'Activar micrófono'} pressed={!!view?.microphone}
            disabled={!view?.joined || busy || (!teacher && !myFloor)} onClick={() => perform(() => controller.current.microphone(!view.microphone), 'microphone')} />
          <Control icon={view?.local ? VideoIcon : VideoOff} label={view?.local ? 'Apagar cámara' : 'Activar cámara'} pressed={!!view?.local}
            disabled={!view?.joined || busy} onClick={() => perform(() => controller.current.cameraEnabled(!view.local), 'camera')} />
          {teacher ? <Control icon={MonitorUp} label={view?.sharing ? 'Dejar de compartir' : 'Compartir pantalla'} pressed={!!view?.sharing}
            disabled={!view?.joined || busy} onClick={() => perform(() => controller.current.shareScreen(!view.sharing), 'screen')} /> :
            <Control icon={Hand} label={myFloor ? 'Devolver la palabra' : me?.hand ? 'Bajar la mano' : 'Levantar la mano'} pressed={!!me?.hand || myFloor}
              disabled={!view?.joined} onClick={() => controller.current.hand(!me?.hand && !myFloor)} />}
          <Control icon={PhoneOff} label={teacher ? 'Finalizar clase' : 'Salir de clase'} danger onClick={requestExit} />
        </div>
        <button type="button" className={`meeting-people-toggle ${peopleOpen ? 'is-open' : ''}`} aria-label={`Participantes (${count})`} aria-expanded={peopleOpen} onClick={() => setPeopleOpen(!peopleOpen)}>
          <UsersRound size={22} /><span>{count}</span>{raised > 0 && <b aria-label={`${raised} manos levantadas`}><Hand size={13} />{raised}</b>}</button>
      </footer>
    </>}
    {leaving && <LeaveDialog teacher={teacher} onCancel={() => setLeaving(false)} onConfirm={finishExit} />}
  </main>
}
