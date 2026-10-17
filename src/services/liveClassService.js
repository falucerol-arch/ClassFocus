const CHANNEL_NAME = 'classfocus-live-class-v2'
const STALE_AFTER = 6500
const makeId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`

class SignalBus {
  constructor(onMessage, onTransport) {
    this.onMessage = onMessage
    this.onTransport = onTransport
    this.queue = []
    this.bc = null
    this.ws = null
    this.openWebSocket()
  }

  openWebSocket() {
    if (typeof WebSocket === 'undefined') return this.openBroadcastFallback()
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = import.meta.env.VITE_SIGNALING_URL || `${scheme}://${window.location.hostname}:8787`
    try {
      this.ws = new WebSocket(url)
      this.ws.onopen = () => {
        this.onTransport?.('websocket')
        this.queue.splice(0).forEach(message => this.ws.send(JSON.stringify(message)))
      }
      this.ws.onmessage = event => {
        try { this.onMessage(JSON.parse(event.data)) } catch { /* ignora mensajes inválidos */ }
      }
      this.ws.onerror = () => this.openBroadcastFallback()
      this.ws.onclose = () => this.openBroadcastFallback()
    } catch {
      this.openBroadcastFallback()
    }
  }

  openBroadcastFallback() {
    if (this.bc || typeof BroadcastChannel === 'undefined') return
    this.bc = new BroadcastChannel(CHANNEL_NAME)
    this.bc.onmessage = event => this.onMessage(event.data)
    this.onTransport?.('local')
    this.queue.splice(0).forEach(message => this.bc.postMessage(message))
  }

  send(message) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message))
    else if (this.bc) this.bc.postMessage(message)
    else this.queue.push(message)
  }

  close() {
    this.ws?.close()
    this.bc?.close()
  }
}

export class StudentLiveBroadcaster {
  constructor({ student, subject, stream, onStatus }) {
    this.student = student
    this.subject = subject
    this.stream = stream
    this.onStatus = onStatus
    this.peers = new Map()
    this.sessionId = makeId('student')
    this.bus = new SignalBus(
      message => this.handleMessage(message),
      mode => onStatus?.(mode === 'websocket'
        ? 'Transmitiendo al monitor del maestro mediante WebRTC.'
        : 'Modo demo local activo. Inicia el servidor de señalización para otros equipos.')
    )
    this.announce()
    this.heartbeat = setInterval(() => this.announce(), 2000)
  }

  announce() {
    this.bus.send({
      type: 'student-online',
      sessionId: this.sessionId,
      studentId: this.student.id,
      studentName: this.student.name,
      subjectId: this.subject.id,
      subjectName: this.subject.name,
      timestamp: Date.now()
    })
  }

  async handleMessage(message) {
    if (!message || message.studentSessionId !== this.sessionId) return
    if (message.type === 'teacher-watch') await this.createOffer(message.teacherSessionId)
    if (message.type === 'teacher-answer') {
      const pc = this.peers.get(message.teacherSessionId)
      if (pc && message.answer) await pc.setRemoteDescription(message.answer).catch(() => {})
    }
    if (message.type === 'teacher-ice') {
      const pc = this.peers.get(message.teacherSessionId)
      if (pc && message.candidate) await pc.addIceCandidate(message.candidate).catch(() => {})
    }
  }

  async createOffer(teacherSessionId) {
    this.peers.get(teacherSessionId)?.close()
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
    this.peers.set(teacherSessionId, pc)
    this.stream?.getTracks().forEach(track => pc.addTrack(track, this.stream))
    pc.onicecandidate = event => {
      if (event.candidate) this.bus.send({ type: 'student-ice', teacherSessionId, studentSessionId: this.sessionId, candidate: event.candidate })
    }
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    this.bus.send({
      type: 'student-offer',
      teacherSessionId,
      studentSessionId: this.sessionId,
      studentId: this.student.id,
      studentName: this.student.name,
      subjectId: this.subject.id,
      offer
    })
  }

  stop() {
    clearInterval(this.heartbeat)
    this.bus.send({ type: 'student-offline', sessionId: this.sessionId })
    this.peers.forEach(pc => pc.close())
    this.peers.clear()
    this.bus.close()
  }
}

export class TeacherLiveMonitor {
  constructor({ teacherId, allowedSubjects, onStudentsChange, onStream }) {
    this.teacherId = teacherId
    this.allowedSubjects = new Set(allowedSubjects)
    this.onStudentsChange = onStudentsChange
    this.onStream = onStream
    this.teacherSessionId = makeId('teacher')
    this.students = new Map()
    this.peers = new Map()
    this.bus = new SignalBus(message => this.handleMessage(message))
    this.cleanupTimer = setInterval(() => this.cleanupStale(), 2000)
  }

  emit() {
    this.onStudentsChange?.([...this.students.values()].sort((a, b) => a.studentName.localeCompare(b.studentName)))
  }

  handleMessage(message) {
    if (!message) return
    if (message.type === 'student-online') {
      if (!this.allowedSubjects.has(message.subjectId)) return
      const existing = this.students.get(message.sessionId)
      this.students.set(message.sessionId, { ...existing, ...message, lastSeen: Date.now() })
      this.emit()
      if (!existing) this.requestWatch(message.sessionId)
    }
    if (message.type === 'student-offline') {
      this.students.delete(message.sessionId)
      this.peers.get(message.sessionId)?.close()
      this.peers.delete(message.sessionId)
      this.emit()
    }
    if (message.type === 'student-offer' && message.teacherSessionId === this.teacherSessionId) this.acceptOffer(message)
    if (message.type === 'student-ice' && message.teacherSessionId === this.teacherSessionId) {
      this.peers.get(message.studentSessionId)?.addIceCandidate(message.candidate).catch(() => {})
    }
  }

  requestWatch(studentSessionId) {
    this.bus.send({ type: 'teacher-watch', teacherSessionId: this.teacherSessionId, studentSessionId })
  }

  async acceptOffer(message) {
    this.peers.get(message.studentSessionId)?.close()
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
    this.peers.set(message.studentSessionId, pc)
    pc.ontrack = event => this.onStream?.(message.studentSessionId, event.streams[0])
    pc.onicecandidate = event => {
      if (event.candidate) this.bus.send({ type: 'teacher-ice', teacherSessionId: this.teacherSessionId, studentSessionId: message.studentSessionId, candidate: event.candidate })
    }
    await pc.setRemoteDescription(message.offer)
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    this.bus.send({ type: 'teacher-answer', teacherSessionId: this.teacherSessionId, studentSessionId: message.studentSessionId, answer })
  }

  cleanupStale() {
    const now = Date.now()
    let changed = false
    for (const [sessionId, student] of this.students.entries()) {
      if (now - student.lastSeen > STALE_AFTER) {
        this.students.delete(sessionId)
        this.peers.get(sessionId)?.close()
        this.peers.delete(sessionId)
        changed = true
      }
    }
    if (changed) this.emit()
  }

  stop() {
    clearInterval(this.cleanupTimer)
    this.peers.forEach(pc => pc.close())
    this.peers.clear()
    this.bus.close()
  }
}
