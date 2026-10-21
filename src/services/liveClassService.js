import { signalingUrl } from './signalingUrl.js'

// Tres canales fijos por alumno: video, audio y audio del turno de palabra.
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
    }
  }
  publishStreams() {
    if (this.closed) return
    const slots = this.pc.getTransceivers()
    const tracks = slots.slice(0, 2).map(t => t.receiver.track).filter(Boolean)
    const floor = !this.teacher && slots[2]?.receiver.track
    this.onStreams(new this.Stream(tracks), floor ? new this.Stream([floor]) : null)
  }
  async tracks(video, audio, floor = null) {
    if (this.closed) return
    const slots = this.pc.getTransceivers()
    try { await Promise.all(slots.map((slot, index) => slot.sender.replaceTrack([video, audio, floor][index] || null))) }
    catch (error) { if (!this.closed) throw error }
  }
  async offer(video, audio, floor) {
    await this.tracks(video, audio, floor)
    await this.pc.setLocalDescription(await this.pc.createOffer())
    this.send({ kind: 'offer', sdp: this.pc.localDescription.sdp })
  }
  async receive(data, video, audio) {
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
      await this.tracks(video, audio)
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
      microphone: !!this.mic, sharing: !!this.screen, presentation: this.screen, outputId: this.outputId || '', joined: this.joined, peerId: this.peerId })
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
      this.state = message
      if (this.role === 'student' && message.floorId !== this.peerId && this.mic) await this.microphone(false)
      const expected = this.role === 'teacher' ? message.students.map(s => s.peerId) : [message.teacher.peerId]
      for (const [id, peer] of this.peers) if (!expected.includes(id)) { peer.close(); this.peers.delete(id); this.remote.delete(id) }
      if (this.role === 'teacher') for (const id of expected) if (!this.peers.has(id)) {
        const peer = this.makePeer(id)
        await peer.offer(this.videoTrack(), this.mic, this.floorTrack(id))
      }
      if (previousFloor !== message.floorId) await this.updateTracks()
      this.publishVideoState()
      this.notify()
    }
    if (message.type === 'signal') {
      let peer = this.peers.get(message.from)
      if (!peer) {
        if (this.role !== 'student' || message.from !== this.state?.teacher.peerId || !['offer', 'ice'].includes(message.data.kind)) throw new Error('Señal inesperada en la clase.')
        peer = this.makePeer(message.from)
      }
      await peer.receive(message.data, this.videoTrack(), this.mic)
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
      onStreams: (stream, floor) => {
        if (this.closed) return
        this.remote.set(id, { stream, floor })
        // Solo el audio autorizado se reproduce y se reenvía a los demás alumnos.
        this.updateTracks().catch(error => this.fail(error.message))
        this.notify()
      } })
    this.peers.set(id, peer)
    return peer
  }
  videoTrack() { return (this.screen || this.camera)?.getVideoTracks()[0] || null }
  floorTrack(target) {
    const id = this.state?.floorId
    return this.role === 'teacher' && id && id !== target ? this.remote.get(id)?.stream.getAudioTracks()[0] || null : null
  }
  publishVideoState() {
    if (this.role !== 'teacher' || !this.joined || this.closed) return
    const source = this.screen ? 'screen' : this.camera ? 'camera' : 'off'
    const key = `${source}:${this.videoTrack()?.id || ''}`
    if (key === this.lastVideoKey) return
    this.lastVideoKey = key
    // replaceTrack no informa por sí solo a la interfaz remota que la presentación terminó.
    this.send({ type: 'media', source })
  }
  async updateTracks() {
    await Promise.all([...this.peers].map(([id, peer]) => peer.tracks(this.videoTrack(), this.mic, this.floorTrack(id))))
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
    await this.updateTracks(); this.publishVideoState(); this.notify()
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
    await this.updateTracks(); this.publishVideoState(); this.notify()
  }
  async shareScreen(enabled) {
    if (this.role !== 'teacher') throw new Error('Solo el maestro puede compartir pantalla.')
    if (enabled && !this.screen) {
      this.screen = await this.capture({ video: true, audio: false }, true)
      if (this.screen) this.screen.getVideoTracks()[0].onended = () => { this.shareScreen(false).catch(e => this.fail(e.message)) }
    } else if (!enabled) { this.release(this.screen); this.screen = null }
    await this.updateTracks(); this.publishVideoState(); this.notify()
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
