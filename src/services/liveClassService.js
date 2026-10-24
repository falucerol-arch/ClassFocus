import { signalingUrl } from './signalingUrl.js'

// Cinco canales fijos: video docente/cámara, micrófono, voz del turno, pantalla y audio compartido.
// La pantalla viaja separada de la cámara privada para no reenviar sus fotogramas al grupo.
// El maestro ofrece siempre; replaceTrack evita renegociar al cambiar de cámara a pantalla.
export class ClassPeer {
  constructor({ teacher, send, onStreams, onFailure, configuration, Peer = globalThis.RTCPeerConnection,
    Stream = globalThis.MediaStream }) {
    this.teacher = teacher
    this.send = send
    this.onStreams = onStreams
    this.Stream = Stream
    this.pc = new Peer(configuration)
    this.pendingIce = []
    this.pc.onicecandidate = ({ candidate }) => { if (candidate) send({ kind: 'ice', candidate: candidate.toJSON() }) }
    this.pc.ontrack = () => {
      // ontrack llega mientras setRemoteDescription todavía está resolviendo.
      queueMicrotask(() => this.publishStreams())
    }
    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === 'failed') onFailure('No se pudo conectar el audio/video. Sal y vuelve a entrar a la clase.')
    }
    if (teacher) {
      this.pc.addTransceiver('video', { direction: 'sendrecv' })
      this.pc.addTransceiver('audio', { direction: 'sendrecv' })
      this.pc.addTransceiver('audio', { direction: 'sendonly' })
      this.pc.addTransceiver('video', { direction: 'sendrecv' })
      this.pc.addTransceiver('audio', { direction: 'sendrecv' })
    }
  }
  publishStreams() {
    if (this.closed) return
    const slots = this.pc.getTransceivers()
    const tracks = slots.slice(0, 2).map(t => t.receiver.track).filter(Boolean)
    const floor = !this.teacher && slots[2]?.receiver.track
    const presentation = [slots[3]?.receiver.track, slots[4]?.receiver.track].filter(Boolean)
    this.onStreams(new this.Stream(tracks), floor ? new this.Stream([floor]) : null, presentation.length ? new this.Stream(presentation) : null)
  }
  async tracks(video, audio, floor = null, screen = null, screenAudio = null) {
    if (this.closed) return
    const slots = this.pc.getTransceivers()
    try { await Promise.all(slots.map((slot, index) => slot.sender.replaceTrack([video, audio, floor, screen, screenAudio][index] || null))) }
    catch (error) { if (!this.closed) throw error }
  }
  async offer(video, audio, floor, screen, screenAudio) {
    await this.tracks(video, audio, floor, screen, screenAudio)
    await this.pc.setLocalDescription(await this.pc.createOffer())
    this.send({ kind: 'offer', sdp: this.pc.localDescription.sdp })
  }
  async receive(data, video, audio, screen, screenAudio) {
    if (this.closed) return
    if (data.kind === 'ice') {
      if (!this.pc.remoteDescription) this.pendingIce.push(data.candidate)
      else await this.pc.addIceCandidate(data.candidate)
      return
    }
    await this.pc.setRemoteDescription({ type: data.kind, sdp: data.sdp })
    if (!this.teacher) {
      const slots = this.pc.getTransceivers()
      slots[0].direction = 'sendrecv'
      slots[1].direction = 'sendrecv'
      slots[2].direction = 'recvonly'
      slots[3].direction = 'sendrecv'
      slots[4].direction = 'sendrecv'
      await this.tracks(video, audio, null, screen, screenAudio)
      await this.pc.setLocalDescription(await this.pc.createAnswer())
      this.send({ kind: 'answer', sdp: this.pc.localDescription.sdp })
    }
    for (const candidate of this.pendingIce.splice(0)) await this.pc.addIceCandidate(candidate)
    this.publishStreams()
  }
  close() { this.closed = true; this.pc.close(); this.pendingIce = [] }
}

export class LiveClass {
  constructor({ subjectId, role, token, onChange, onError, onClose }) {
    Object.assign(this, { subjectId, role, token, onChange, onError, onClose })
    this.peers = new Map()
    this.remote = new Map()
    this.media = new Set()
    this.queue = Promise.resolve()
    this.state = null
    this.generation = 0
    this.floorGeneration = 0
    const configured = import.meta.env?.VITE_RTC_ICE_SERVERS
    this.configuration = { iceServers: configured ? JSON.parse(configured) : [{ urls: 'stun:stun.l.google.com:19302' }] }
  }
  adoptMedia({ camera = null, microphone = null, cameraId = '', microphoneId = '', outputId = '' } = {}) {
    if (this.closed || this.socket || this.joined) throw new Error('La clase ya fue iniciada.')
    this.cameraId = cameraId; this.microphoneId = microphoneId; this.outputId = outputId
    this.camera = camera
    if (camera) {
      this.media.add(camera)
      camera.getVideoTracks().forEach(track => { track.onended = () => { this.cameraEnabled(false).catch(e => this.fail(e.message)) } })
    }
    if (microphone && this.role === 'teacher') {
      this.media.add(microphone); this.micStream = microphone; this.mic = microphone.getAudioTracks()[0]
      if (this.mic) this.mic.onended = () => { this.microphone(false).catch(e => this.fail(e.message)) }
    } else if (microphone) microphone.getTracks().forEach(track => track.stop())
  }
  async connect() {
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.RTCPeerConnection) throw new Error('Abre la app en localhost o HTTPS con un navegador compatible.')
    const url = signalingUrl()
    this.socket = new WebSocket(url)
    this.socket.onopen = () => this.send({ type: 'authenticate', token: this.token })
    this.socket.onmessage = ({ data }) => {
      this.queue = this.queue.then(async () => {
        if (!this.closed) await this.receive(JSON.parse(data))
      }).catch(error => this.fail(error.message))
    }
    this.socket.onerror = () => this.fail('No se pudo conectar con las clases en vivo. Revisa que npm run signal esté activo.')
    this.socket.onclose = () => { if (!this.closed) this.fail('Se perdió la conexión con la clase. Vuelve a entrar.') }
  }
  send(message) { if (!this.closed && this.socket?.readyState === 1) this.socket.send(JSON.stringify(message)) }
  notify() {
    if (!this.closed) this.onChange({ room: this.state, remotes: new Map(this.remote), local: this.camera,
      microphone: !!this.mic, sharing: !!this.screen, screenAudio: !!this.screenAudioTrack(), presentation: this.screen, outputId: this.outputId || '', joined: this.joined, peerId: this.peerId })
  }
  async receive(message) {
    if (message.type === 'error' || message.type === 'ended') { this.fail(message.message); return }
    if (message.type === 'authenticated') {
      this.peerId = message.peerId
      this.send({ type: 'join', subjectId: this.subjectId })
    }
    if (message.type === 'joined') this.joined = true
    if (message.type === 'room') {
      const previousFloor = this.state?.floorId
      const previousVideo = this.state?.students.find(s => s.peerId === this.peerId)?.video
      // Limpiar videos apagados antes de esperar cambios de pistas o nuevas ofertas.
      this.state = message
      this.notify()
      if (previousFloor !== message.floorId) this.floorGeneration++
      const myVideo = message.students.find(s => s.peerId === this.peerId)?.video
      if (this.role === 'student' && this.screen && (message.floorId !== this.peerId ||
        message.teacherVideo?.source === 'screen' || (previousVideo?.source === 'screen' && myVideo?.source !== 'screen'))) {
        await this.shareScreen(false)
      }
      if (this.role === 'student' && message.floorId !== this.peerId && this.mic) await this.microphone(false)
      const expected = this.role === 'teacher' ? message.students.map(s => s.peerId) : [message.teacher.peerId]
      for (const [id, peer] of this.peers) if (!expected.includes(id)) { peer.close(); this.peers.delete(id); this.remote.delete(id) }
      if (this.role === 'teacher') for (const id of expected) if (!this.peers.has(id)) {
        const peer = this.makePeer(id)
        await peer.offer(this.videoTrack(), this.mic, this.floorTrack(id), this.outboundScreen(id), this.outboundScreenAudio(id))
      }
      // El reenvío cambia también cuando termina una pantalla, aunque no cambie el turno.
      await this.updateTracks()
      this.publishVideoState()
      this.notify()
    }
    if (message.type === 'signal') {
      let peer = this.peers.get(message.from)
      if (!peer) {
        if (this.role !== 'student' || message.from !== this.state?.teacher.peerId || !['offer', 'ice'].includes(message.data.kind)) throw new Error('Señal inesperada en la clase.')
        peer = this.makePeer(message.from)
      }
      await peer.receive(message.data, this.videoTrack(), this.mic, this.outboundScreen(message.from), this.outboundScreenAudio(message.from))
    }
  }
  makePeer(id) {
    const peer = new ClassPeer({ teacher: this.role === 'teacher', configuration: this.configuration,
      send: data => this.send({ type: 'signal', to: id, data }), onFailure: text => {
        if (this.closed) return
        // Una conexión fallida no debe expulsar a todo el grupo.
        if (this.role === 'teacher') this.onError('Un alumno no pudo conectar su audio/video. Pídele que salga y vuelva a entrar.')
        else this.fail(text)
      },
      onStreams: (stream, floor, presentation) => {
        if (this.closed) return
        this.remote.set(id, { stream, floor, presentation })
        // Se reenvían únicamente el audio y la pantalla del turno autorizado.
        this.updateTracks().catch(error => this.fail(error.message))
        this.notify()
      } })
    this.peers.set(id, peer)
    return peer
  }
  videoTrack() { return (this.role === 'teacher' ? this.screen || this.camera : this.camera)?.getVideoTracks()[0] || null }
  floorTrack(target) {
    const id = this.state?.floorId
    return this.role === 'teacher' && id && id !== target ? this.remote.get(id)?.stream.getAudioTracks()[0] || null : null
  }
  outboundScreen(target) {
    if (this.role === 'student') return this.screen?.getVideoTracks()[0] || null
    if (this.screen) return null
    const presenter = this.state?.students.find(student => student.peerId === this.state.floorId)
    // Nunca se reenvían cámaras privadas: únicamente la pantalla del alumno autorizado.
    if (presenter?.video?.source === 'screen' && presenter.peerId !== target) {
      return this.remote.get(presenter.peerId)?.presentation?.getVideoTracks()[0] || null
    }
    return null
  }
  // El audio de la fuente compartida no depende del botón del micrófono.
  screenAudioTrack() { return this.screen?.getAudioTracks().find(track => track.readyState !== 'ended') || null }
  outboundScreenAudio(target) {
    if (this.screen) return this.screenAudioTrack()
    if (this.role !== 'teacher') return null
    const presenter = this.state?.students.find(student => student.peerId === this.state.floorId)
    // Igual que el video: solo el turno que está presentando, sin devolvérselo a su autor.
    if (presenter?.video?.source === 'screen' && presenter.peerId !== target) {
      return this.remote.get(presenter.peerId)?.presentation?.getAudioTracks().find(track => track.readyState !== 'ended') || null
    }
    return null
  }
  publishVideoState() {
    if (!this.joined || this.closed) return
    const source = this.screen ? 'screen' : this.camera ? 'camera' : 'off'
    const key = `${source}:${(this.screen || this.camera)?.getVideoTracks()[0]?.id || ''}`
    if (key === this.lastVideoKey) return
    this.lastVideoKey = key
    // replaceTrack no informa por sí solo a la interfaz remota que la presentación terminó.
    this.send({ type: 'media', source })
  }
  async updateTracks() {
    await Promise.all([...this.peers].map(([id, peer]) => peer.tracks(this.videoTrack(), this.mic, this.floorTrack(id), this.outboundScreen(id), this.outboundScreenAudio(id))))
  }
  async capture(constraints, display = false) {
    if (this.closed || !this.joined) throw new Error('Entra a la clase antes de activar tus dispositivos.')
    const generation = this.generation
    const stream = await (display ? navigator.mediaDevices.getDisplayMedia(constraints) : navigator.mediaDevices.getUserMedia(constraints))
    // Si se cerró la sala mientras se aceptaba el permiso, se liberan los dispositivos.
    if (this.closed || generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return null }
    this.media.add(stream)
    return stream
  }
  release(stream) { stream?.getTracks().forEach(track => track.stop()); this.media.delete(stream) }
  async cameraEnabled(enabled) {
    if (enabled && !this.camera) {
      this.camera = await this.capture({ video: { width: { ideal: 640 }, height: { ideal: 360 }, ...(this.cameraId ? { deviceId: { exact: this.cameraId } } : {}) }, audio: false })
      if (this.camera) this.camera.getVideoTracks()[0].onended = () => { this.cameraEnabled(false).catch(e => this.fail(e.message)) }
    } else if (!enabled) { this.release(this.camera); this.camera = null }
    // El estado explícito limpia el último fotograma sin esperar a replaceTrack/ICE.
    this.publishVideoState(); this.notify(); await this.updateTracks()
  }
  async microphone(enabled) {
    if (enabled && this.role === 'student' && this.state?.floorId !== this.peerId) throw new Error('Pide la palabra y espera la autorización del maestro.')
    if (enabled && !this.mic) {
      const stream = await this.capture({ audio: { echoCancellation: true, noiseSuppression: true, ...(this.microphoneId ? { deviceId: { exact: this.microphoneId } } : {}) }, video: false })
      // El turno puede vencer mientras el navegador muestra la solicitud de permiso.
      if (stream && this.role === 'student' && this.state?.floorId !== this.peerId) this.release(stream)
      else if (stream) {
        this.micStream = stream
        this.mic = stream.getAudioTracks()[0]
        this.mic.onended = () => { this.microphone(false).catch(e => this.fail(e.message)) }
      }
    } else if (!enabled) { this.release(this.micStream); this.micStream = null; this.mic = null }
    this.publishVideoState(); this.notify(); await this.updateTracks()
  }
  async shareScreen(enabled) {
    if (enabled && this.role === 'student' && this.state?.floorId !== this.peerId) {
      throw new Error('Pide la palabra y espera la autorización del maestro para presentar.')
    }
    if (enabled && this.role === 'student' && this.state?.teacherVideo?.source === 'screen') {
      throw new Error('El maestro está presentando. Espera a que termine para compartir tu pantalla.')
    }
    if (enabled && !this.screen) {
      const floorGeneration = this.floorGeneration
      const stream = await this.capture({ video: { displaySurface: 'browser' }, audio: true,
        selfBrowserSurface: 'exclude', systemAudio: 'include', windowAudio: 'window' }, true)
      // La autorización puede cambiar mientras el usuario elige qué ventana compartir.
      if (stream && this.role === 'student' && (this.state?.floorId !== this.peerId ||
        floorGeneration !== this.floorGeneration || this.state?.teacherVideo?.source === 'screen')) this.release(stream)
      else this.screen = stream
      if (this.screen) {
        this.screen.getVideoTracks()[0].onended = () => { this.shareScreen(false).catch(e => this.fail(e.message)) }
        // El navegador puede terminar solo el audio; la presentación continúa sin sonido.
        for (const track of this.screen.getAudioTracks()) track.onended = () => {
          this.notify(); this.updateTracks().catch(e => this.fail(e.message))
        }
      }
    } else if (!enabled) { this.release(this.screen); this.screen = null }
    // El estado explícito limpia el último fotograma sin esperar a replaceTrack/ICE.
    this.publishVideoState(); this.notify(); await this.updateTracks()
  }
  hand(raised) { this.send({ type: 'hand', raised }) }
  floor(peerId) { this.send({ type: 'floor', peerId }) }
  fail(message) { if (this.closed) return; this.stop(); this.onError(message) }
  stop() {
    if (this.closed) return
    this.send({ type: 'leave' })
    this.closed = true
    this.generation++
    this.socket?.close()
    this.peers.forEach(peer => peer.close())
    this.peers.clear(); this.remote.clear()
    this.media.forEach(stream => stream.getTracks().forEach(track => track.stop()))
    this.media.clear()
    this.camera = this.screen = this.mic = this.micStream = null
    this.onClose?.()
  }
}
