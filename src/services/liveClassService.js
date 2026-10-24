import { signalingUrl } from './signalingUrl.js'

const DEFAULT_ICE_SERVERS = [
  {
    urls: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302'
    ]
  },
  {
    urls: 'stun:stun.cloudflare.com:3478'
  }
]

function getRtcConfiguration() {
  const configured =
    import.meta.env?.VITE_RTC_ICE_SERVERS

  if (!configured) {
    return {
      iceServers:
        DEFAULT_ICE_SERVERS,

      iceCandidatePoolSize:
        10
    }
  }

  try {
    const parsed =
      JSON.parse(configured)

    if (
      !Array.isArray(parsed) ||
      !parsed.length
    ) {
      throw new Error(
        'VITE_RTC_ICE_SERVERS debe ser un arreglo JSON.'
      )
    }

    return {
      iceServers:
        parsed,

      iceCandidatePoolSize:
        10
    }

  } catch (error) {

    console.warn(
      '[ClassFocus RTC] VITE_RTC_ICE_SERVERS no es válido. Se usarán servidores STUN por defecto.',
      error
    )

    return {
      iceServers:
        DEFAULT_ICE_SERVERS,

      iceCandidatePoolSize:
        10
    }
  }
}


// =====================================================
// CONEXIÓN ENTRE MAESTRO Y ALUMNO
// =====================================================

export class ClassPeer {

  constructor({
    teacher,
    send,
    onStreams,
    onFailure,
    configuration,
    Peer =
      globalThis.RTCPeerConnection,
    Stream =
      globalThis.MediaStream
  }) {

    this.teacher =
      teacher

    this.send =
      send

    this.onStreams =
      onStreams

    this.Stream =
      Stream

    this.pc =
      new Peer(configuration)

    this.pendingIce =
      []


    // ===============================================
    // ICE
    // ===============================================

    this.pc.onicecandidate =
      ({ candidate }) => {

        if (candidate) {
          send({
            kind: 'ice',

            candidate:
              candidate.toJSON()
          })
        }
      }


    // ===============================================
    // PISTAS REMOTAS
    // ===============================================

    this.pc.ontrack =
      () => {

        queueMicrotask(
          () =>
            this.publishStreams()
        )
      }


    // ===============================================
    // ESTADO DE CONEXIÓN
    // ===============================================

    this.pc.onconnectionstatechange =
      () => {

        const state =
          this.pc.connectionState

        console.log(
          '[ClassFocus WebRTC]',
          state
        )

        if (
          state === 'failed'
        ) {
          onFailure(
            'No se pudo conectar el audio/video. Sal y vuelve a entrar a la clase.'
          )
        }
      }


    // ===============================================
    // EL MAESTRO CREA LOS CANALES
    // ===============================================

    if (teacher) {

      // Cámara
      this.pc.addTransceiver(
        'video',
        {
          direction:
            'sendrecv'
        }
      )

      // Micrófono
      this.pc.addTransceiver(
        'audio',
        {
          direction:
            'sendrecv'
        }
      )

      // Voz del turno
      this.pc.addTransceiver(
        'audio',
        {
          direction:
            'sendonly'
        }
      )

      // Pantalla
      this.pc.addTransceiver(
        'video',
        {
          direction:
            'sendrecv'
        }
      )

      // Audio pantalla
      this.pc.addTransceiver(
        'audio',
        {
          direction:
            'sendrecv'
        }
      )
    }
  }


  // ===================================================
  // PUBLICAR STREAMS
  // ===================================================

  publishStreams() {

    if (this.closed) {
      return
    }

    const slots =
      this.pc.getTransceivers()


    // Cámara + audio principal
    const tracks =
      slots
        .slice(0, 2)
        .map(
          transceiver =>
            transceiver
              .receiver
              .track
        )
        .filter(
          track =>
            track &&
            track.readyState !==
              'ended'
        )


    // Audio del turno
    const floorTrack =
      !this.teacher
        ? slots[2]
            ?.receiver
            ?.track
        : null


    const floor =
      floorTrack &&
      floorTrack.readyState !==
        'ended'
        ? floorTrack
        : null


    // Pantalla
    const presentation =
      [
        slots[3]
          ?.receiver
          ?.track,

        slots[4]
          ?.receiver
          ?.track
      ]
        .filter(
          track =>
            track &&
            track.readyState !==
              'ended'
        )


    this.onStreams(
      new this.Stream(
        tracks
      ),

      floor
        ? new this.Stream(
            [floor]
          )
        : null,

      presentation.length
        ? new this.Stream(
            presentation
          )
        : null
    )
  }


  // ===================================================
  // CAMBIAR PISTAS
  // ===================================================

  async tracks(
    video,
    audio,
    floor = null,
    screen = null,
    screenAudio = null
  ) {

    if (this.closed) {
      return
    }

    const slots =
      this.pc.getTransceivers()

    const tracks = [
      video,
      audio,
      floor,
      screen,
      screenAudio
    ]

    try {

      await Promise.all(
        slots.map(
          (slot, index) =>
            slot.sender.replaceTrack(
              tracks[index] ||
              null
            )
        )
      )

    } catch (error) {

      if (!this.closed) {
        throw error
      }
    }
  }


  // ===================================================
  // CREAR OFFER
  // ===================================================

  async offer(
    video,
    audio,
    floor,
    screen,
    screenAudio
  ) {

    await this.tracks(
      video,
      audio,
      floor,
      screen,
      screenAudio
    )

    const offer =
      await this.pc.createOffer()

    await this.pc
      .setLocalDescription(
        offer
      )

    this.send({
      kind:
        'offer',

      sdp:
        this.pc
          .localDescription
          .sdp
    })
  }


  // ===================================================
  // RECIBIR SEÑAL
  // ===================================================

  async receive(
    data,
    video,
    audio,
    screen,
    screenAudio
  ) {

    if (this.closed) {
      return
    }


    // ===============================================
    // ICE
    // ===============================================

    if (
      data.kind ===
      'ice'
    ) {

      if (
        !this.pc
          .remoteDescription
      ) {

        this.pendingIce.push(
          data.candidate
        )

      } else {

        await this.pc
          .addIceCandidate(
            data.candidate
          )
      }

      return
    }


    // ===============================================
    // OFFER / ANSWER
    // ===============================================

    await this.pc
      .setRemoteDescription({
        type:
          data.kind,

        sdp:
          data.sdp
      })


    // ===============================================
    // EL ALUMNO RESPONDE
    // ===============================================

    if (!this.teacher) {

      const slots =
        this.pc
          .getTransceivers()


      if (slots[0]) {
        slots[0].direction =
          'sendrecv'
      }

      if (slots[1]) {
        slots[1].direction =
          'sendrecv'
      }

      if (slots[2]) {
        slots[2].direction =
          'recvonly'
      }

      if (slots[3]) {
        slots[3].direction =
          'sendrecv'
      }

      if (slots[4]) {
        slots[4].direction =
          'sendrecv'
      }


      // MUY IMPORTANTE:
      // aquí se agrega la cámara
      // antes de crear el answer.
      await this.tracks(
        video,
        audio,
        null,
        screen,
        screenAudio
      )


      const answer =
        await this.pc
          .createAnswer()


      await this.pc
        .setLocalDescription(
          answer
        )


      this.send({
        kind:
          'answer',

        sdp:
          this.pc
            .localDescription
            .sdp
      })
    }


    // ===============================================
    // ICE PENDIENTE
    // ===============================================

    for (
      const candidate
      of this.pendingIce.splice(0)
    ) {

      await this.pc
        .addIceCandidate(
          candidate
        )
    }


    this.publishStreams()
  }


  close() {

    this.closed =
      true

    this.pc.close()

    this.pendingIce =
      []
  }
}


// =====================================================
// CLASE EN VIVO
// =====================================================

export class LiveClass {

  constructor({
    subjectId,
    role,
    token,
    onChange,
    onError,
    onClose
  }) {

    Object.assign(
      this,
      {
        subjectId,
        role,
        token,
        onChange,
        onError,
        onClose
      }
    )


    this.peers =
      new Map()

    this.remote =
      new Map()

    this.media =
      new Set()

    this.queue =
      Promise.resolve()

    this.state =
      null

    this.generation =
      0

    this.floorGeneration =
      0


    this.configuration =
      getRtcConfiguration()
  }


  // ===================================================
  // ADOPTAR MEDIA DE LA VISTA PREVIA
  // ===================================================

  adoptMedia({
    camera = null,
    microphone = null,
    cameraId = '',
    microphoneId = '',
    outputId = ''
  } = {}) {

    if (
      this.closed ||
      this.socket ||
      this.joined
    ) {
      throw new Error(
        'La clase ya fue iniciada.'
      )
    }


    this.cameraId =
      cameraId

    this.microphoneId =
      microphoneId

    this.outputId =
      outputId


    this.camera =
      camera


    if (camera) {

      this.media.add(
        camera
      )

      camera
        .getVideoTracks()
        .forEach(
          track => {

            track.onended =
              () => {

                this
                  .cameraEnabled(
                    false
                  )
                  .catch(
                    error =>
                      this.fail(
                        error.message
                      )
                  )
              }
          }
        )
    }


    // El maestro conserva micrófono.
    if (
      microphone &&
      this.role ===
        'teacher'
    ) {

      this.media.add(
        microphone
      )

      this.micStream =
        microphone

      this.mic =
        microphone
          .getAudioTracks()[0]


      if (this.mic) {

        this.mic.onended =
          () => {

            this
              .microphone(
                false
              )
              .catch(
                error =>
                  this.fail(
                    error.message
                  )
              )
          }
      }

    } else if (
      microphone
    ) {

      microphone
        .getTracks()
        .forEach(
          track =>
            track.stop()
        )
    }
  }


  // ===================================================
  // CONECTAR SIGNALING
  // ===================================================

  async connect() {

    if (
      !navigator
        .mediaDevices
        ?.getUserMedia ||

      !globalThis
        .RTCPeerConnection
    ) {
      throw new Error(
        'Abre la app en localhost o HTTPS con un navegador compatible.'
      )
    }


    const url =
      signalingUrl()


    this.socket =
      new WebSocket(url)


    this.socket.onopen =
      () => {

        this.send({
          type:
            'authenticate',

          token:
            this.token
        })
      }


    this.socket.onmessage =
      ({ data }) => {

        this.queue =
          this.queue
            .then(
              async () => {

                if (
                  !this.closed
                ) {

                  await this.receive(
                    JSON.parse(
                      data
                    )
                  )
                }
              }
            )
            .catch(
              error =>
                this.fail(
                  error.message
                )
            )
      }


    this.socket.onerror =
      () => {

        this.fail(
          'No se pudo conectar con las clases en vivo.'
        )
      }


    this.socket.onclose =
      () => {

        if (!this.closed) {

          this.fail(
            'Se perdió la conexión con la clase. Vuelve a entrar.'
          )
        }
      }
  }


  // ===================================================
  // ENVIAR
  // ===================================================

  send(message) {

    if (
      !this.closed &&
      this.socket
        ?.readyState ===
        WebSocket.OPEN
    ) {

      this.socket.send(
        JSON.stringify(
          message
        )
      )
    }
  }


  // ===================================================
  // ACTUALIZAR UI
  // ===================================================

  notify() {

    if (this.closed) {
      return
    }


    this.onChange({
      room:
        this.state,

      remotes:
        new Map(
          this.remote
        ),

      local:
        this.camera,

      microphone:
        !!this.mic,

      sharing:
        !!this.screen,

      screenAudio:
        !!this.screenAudioTrack(),

      presentation:
        this.screen,

      outputId:
        this.outputId ||
        '',

      joined:
        this.joined,

      peerId:
        this.peerId
    })
  }


  // ===================================================
  // RECIBIR MENSAJES
  // ===================================================

  async receive(message) {

    if (
      message.type ===
        'error' ||

      message.type ===
        'ended'
    ) {

      this.fail(
        message.message
      )

      return
    }


    // ===============================================
    // AUTENTICADO
    // ===============================================

    if (
      message.type ===
      'authenticated'
    ) {

      this.peerId =
        message.peerId

      this.send({
        type:
          'join',

        subjectId:
          this.subjectId
      })
    }


    // ===============================================
    // ENTRÓ A LA CLASE
    // ===============================================

    if (
      message.type ===
      'joined'
    ) {

      this.joined =
        true


      // =================================================
      // CORRECCIÓN PRINCIPAL
      //
      // Antes el alumno podía entrar con this.camera=null.
      // Entonces respondía el WebRTC SIN VIDEO.
      //
      // Ahora al entrar se activa automáticamente la cámara.
      // =================================================

      if (
        this.role ===
          'student' &&

        !this.camera
      ) {

        try {

          await this
            .cameraEnabled(
              true
            )

        } catch (error) {

          console.warn(
            '[ClassFocus] No se pudo activar la cámara automáticamente:',
            error
          )

          this.onError?.(
            `No se pudo activar la cámara: ${error.message}`
          )
        }
      }


      this.notify()
    }


    // ===============================================
    // ESTADO DE LA SALA
    // ===============================================

    if (
      message.type ===
      'room'
    ) {

      const previousFloor =
        this.state
          ?.floorId


      const previousVideo =
        this.state
          ?.students
          ?.find(
            student =>
              student.peerId ===
              this.peerId
          )
          ?.video


      this.state =
        message


      this.notify()


      if (
        previousFloor !==
        message.floorId
      ) {

        this.floorGeneration++
      }


      const myVideo =
        message.students
          ?.find(
            student =>
              student.peerId ===
              this.peerId
          )
          ?.video


      if (
        this.role ===
          'student' &&

        this.screen &&

        (
          message.floorId !==
            this.peerId ||

          message.teacherVideo
            ?.source ===
            'screen' ||

          (
            previousVideo
              ?.source ===
              'screen' &&

            myVideo
              ?.source !==
              'screen'
          )
        )
      ) {

        await this
          .shareScreen(
            false
          )
      }


      if (
        this.role ===
          'student' &&

        message.floorId !==
          this.peerId &&

        this.mic
      ) {

        await this
          .microphone(
            false
          )
      }


      const expected =
        this.role ===
          'teacher'

          ? message
              .students
              .map(
                student =>
                  student.peerId
              )

          : [
              message
                .teacher
                .peerId
            ]


      // Eliminar peers que ya salieron.
      for (
        const [
          id,
          peer
        ]
        of this.peers
      ) {

        if (
          !expected.includes(
            id
          )
        ) {

          peer.close()

          this.peers.delete(
            id
          )

          this.remote.delete(
            id
          )
        }
      }


      // ===============================================
      // EL MAESTRO CREA OFFER A CADA ALUMNO
      // ===============================================

      if (
        this.role ===
        'teacher'
      ) {

        for (
          const id
          of expected
        ) {

          if (
            !this.peers.has(
              id
            )
          ) {

            const peer =
              this.makePeer(
                id
              )


            await peer.offer(
              this.videoTrack(),
              this.mic,
              this.floorTrack(
                id
              ),
              this.outboundScreen(
                id
              ),
              this.outboundScreenAudio(
                id
              )
            )
          }
        }
      }


      await this
        .updateTracks()


      this.publishVideoState()

      this.notify()
    }


    // ===============================================
    // SIGNAL WEBRTC
    // ===============================================

    if (
      message.type ===
      'signal'
    ) {

      let peer =
        this.peers.get(
          message.from
        )


      if (!peer) {

        if (
          this.role !==
            'student' ||

          message.from !==
            this.state
              ?.teacher
              ?.peerId ||

          ![
            'offer',
            'ice'
          ].includes(
            message.data.kind
          )
        ) {

          throw new Error(
            'Señal inesperada en la clase.'
          )
        }


        peer =
          this.makePeer(
            message.from
          )
      }


      await peer.receive(
        message.data,
        this.videoTrack(),
        this.mic,
        this.outboundScreen(
          message.from
        ),
        this.outboundScreenAudio(
          message.from
        )
      )
    }
  }


  // ===================================================
  // CREAR PEER
  // ===================================================

  makePeer(id) {

    const peer =
      new ClassPeer({

        teacher:
          this.role ===
          'teacher',

        configuration:
          this.configuration,


        send:
          data =>
            this.send({
              type:
                'signal',

              to:
                id,

              data
            }),


        onFailure:
          text => {

            if (
              this.closed
            ) {
              return
            }


            if (
              this.role ===
              'teacher'
            ) {

              this.onError(
                'Un alumno no pudo conectar su audio/video.'
              )

            } else {

              this.fail(
                text
              )
            }
          },


        onStreams:
          (
            stream,
            floor,
            presentation
          ) => {

            if (
              this.closed
            ) {
              return
            }


            console.log(
              '[ClassFocus] Stream remoto recibido',
              {
                peerId:
                  id,

                videoTracks:
                  stream
                    .getVideoTracks()
                    .length,

                audioTracks:
                  stream
                    .getAudioTracks()
                    .length
              }
            )


            this.remote.set(
              id,
              {
                stream,
                floor,
                presentation
              }
            )


            this
              .updateTracks()
              .catch(
                error =>
                  this.fail(
                    error.message
                  )
              )


            this.notify()
          }
      })


    this.peers.set(
      id,
      peer
    )


    return peer
  }


  // ===================================================
  // VIDEO
  // ===================================================

  videoTrack() {

    return (
      this.role ===
        'teacher'

        ? (
            this.screen ||
            this.camera
          )

        : this.camera
    )
      ?.getVideoTracks()[0] ||
      null
  }


  // ===================================================
  // AUDIO DEL TURNO
  // ===================================================

  floorTrack(target) {

    const id =
      this.state
        ?.floorId


    return (
      this.role ===
        'teacher' &&

      id &&

      id !== target
    )
      ? (
          this.remote
            .get(id)
            ?.stream
            ?.getAudioTracks()[0] ||
          null
        )
      : null
  }


  // ===================================================
  // PANTALLA
  // ===================================================

  outboundScreen(target) {

    if (
      this.role ===
      'student'
    ) {

      return (
        this.screen
          ?.getVideoTracks()[0] ||
        null
      )
    }


    if (
      this.screen
    ) {
      return null
    }


    const presenter =
      this.state
        ?.students
        ?.find(
          student =>
            student.peerId ===
            this.state
              ?.floorId
        )


    if (
      presenter
        ?.video
        ?.source ===
        'screen' &&

      presenter.peerId !==
        target
    ) {

      return (
        this.remote
          .get(
            presenter.peerId
          )
          ?.presentation
          ?.getVideoTracks()[0] ||
        null
      )
    }


    return null
  }


  // ===================================================
  // AUDIO DE PANTALLA
  // ===================================================

  screenAudioTrack() {

    return (
      this.screen
        ?.getAudioTracks()
        .find(
          track =>
            track.readyState !==
            'ended'
        ) ||
      null
    )
  }


  outboundScreenAudio(
    target
  ) {

    if (
      this.screen
    ) {

      return this
        .screenAudioTrack()
    }


    if (
      this.role !==
      'teacher'
    ) {

      return null
    }


    const presenter =
      this.state
        ?.students
        ?.find(
          student =>
            student.peerId ===
            this.state
              ?.floorId
        )


    if (
      presenter
        ?.video
        ?.source ===
        'screen' &&

      presenter.peerId !==
        target
    ) {

      return (
        this.remote
          .get(
            presenter.peerId
          )
          ?.presentation
          ?.getAudioTracks()
          .find(
            track =>
              track.readyState !==
              'ended'
          ) ||
        null
      )
    }


    return null
  }


  // ===================================================
  // PUBLICAR ESTADO DE VIDEO
  // ===================================================

  publishVideoState() {

    if (
      !this.joined ||
      this.closed
    ) {

      return
    }


    const source =
      this.screen

        ? 'screen'

        : this.camera

          ? 'camera'

          : 'off'


    const track =
      (
        this.screen ||
        this.camera
      )
        ?.getVideoTracks()[0]


    const key =
      `${source}:${track?.id || ''}`


    if (
      key ===
      this.lastVideoKey
    ) {

      return
    }


    this.lastVideoKey =
      key


    this.send({
      type:
        'media',

      source
    })
  }


  // ===================================================
  // ACTUALIZAR TRACKS
  // ===================================================

  async updateTracks() {

    await Promise.all(
      [
        ...this.peers
      ].map(
        ([id, peer]) =>
          peer.tracks(
            this.videoTrack(),
            this.mic,
            this.floorTrack(
              id
            ),
            this.outboundScreen(
              id
            ),
            this.outboundScreenAudio(
              id
            )
          )
      )
    )
  }


  // ===================================================
  // CAPTURAR MEDIA
  // ===================================================

  async capture(
    constraints,
    display = false
  ) {

    if (
      this.closed ||
      !this.joined
    ) {

      throw new Error(
        'Entra a la clase antes de activar tus dispositivos.'
      )
    }


    const generation =
      this.generation


    const stream =
      await (
        display

          ? navigator
              .mediaDevices
              .getDisplayMedia(
                constraints
              )

          : navigator
              .mediaDevices
              .getUserMedia(
                constraints
              )
      )


    if (
      this.closed ||

      generation !==
        this.generation
    ) {

      stream
        .getTracks()
        .forEach(
          track =>
            track.stop()
        )

      return null
    }


    this.media.add(
      stream
    )


    return stream
  }


  // ===================================================
  // LIBERAR MEDIA
  // ===================================================

  release(stream) {

    stream
      ?.getTracks()
      .forEach(
        track =>
          track.stop()
      )


    this.media.delete(
      stream
    )
  }


  // ===================================================
  // CÁMARA
  // ===================================================

  async cameraEnabled(
    enabled
  ) {

    if (
      enabled &&
      !this.camera
    ) {

      this.camera =
        await this.capture({
          video: {
            width: {
              ideal: 640
            },

            height: {
              ideal: 360
            },

            facingMode:
              'user',

            ...(
              this.cameraId
                ? {
                    deviceId: {
                      exact:
                        this.cameraId
                    }
                  }
                : {}
            )
          },

          audio:
            false
        })


      if (
        this.camera
      ) {

        const track =
          this.camera
            .getVideoTracks()[0]


        if (track) {

          track.enabled =
            true


          track.onended =
            () => {

              this
                .cameraEnabled(
                  false
                )
                .catch(
                  error =>
                    console.error(
                      error
                    )
                )
            }
        }
      }

    } else if (
      !enabled
    ) {

      this.release(
        this.camera
      )

      this.camera =
        null
    }


    this.publishVideoState()

    this.notify()

    await this
      .updateTracks()
  }


  // ===================================================
  // MICRÓFONO
  // ===================================================

  async microphone(
    enabled
  ) {

    if (
      enabled &&

      this.role ===
        'student' &&

      this.state
        ?.floorId !==
        this.peerId
    ) {

      throw new Error(
        'Pide la palabra y espera la autorización del maestro.'
      )
    }


    if (
      enabled &&
      !this.mic
    ) {

      const stream =
        await this.capture({
          audio: {
            echoCancellation:
              true,

            noiseSuppression:
              true,

            autoGainControl:
              true,

            ...(
              this.microphoneId
                ? {
                    deviceId: {
                      exact:
                        this.microphoneId
                    }
                  }
                : {}
            )
          },

          video:
            false
        })


      if (
        stream &&

        this.role ===
          'student' &&

        this.state
          ?.floorId !==
          this.peerId
      ) {

        this.release(
          stream
        )

      } else if (
        stream
      ) {

        this.micStream =
          stream


        this.mic =
          stream
            .getAudioTracks()[0]


        if (
          this.mic
        ) {

          this.mic.onended =
            () => {

              this
                .microphone(
                  false
                )
                .catch(
                  error =>
                    console.error(
                      error
                    )
                )
            }
        }
      }

    } else if (
      !enabled
    ) {

      this.release(
        this.micStream
      )

      this.micStream =
        null

      this.mic =
        null
    }


    this.publishVideoState()

    this.notify()

    await this
      .updateTracks()
  }


  // ===================================================
  // COMPARTIR PANTALLA
  // ===================================================

  async shareScreen(
    enabled
  ) {

    if (
      enabled &&

      this.role ===
        'student' &&

      this.state
        ?.floorId !==
        this.peerId
    ) {

      throw new Error(
        'Pide la palabra y espera la autorización del maestro para presentar.'
      )
    }


    if (
      enabled &&

      this.role ===
        'student' &&

      this.state
        ?.teacherVideo
        ?.source ===
        'screen'
    ) {

      throw new Error(
        'El maestro está presentando. Espera a que termine para compartir tu pantalla.'
      )
    }


    if (
      enabled &&
      !this.screen
    ) {

      const floorGeneration =
        this.floorGeneration


      const stream =
        await this.capture(
          {
            video: {
              displaySurface:
                'browser'
            },

            audio:
              true,

            selfBrowserSurface:
              'exclude',

            systemAudio:
              'include',

            windowAudio:
              'window'
          },

          true
        )


      if (
        stream &&

        this.role ===
          'student' &&

        (
          this.state
            ?.floorId !==
            this.peerId ||

          floorGeneration !==
            this.floorGeneration ||

          this.state
            ?.teacherVideo
            ?.source ===
            'screen'
        )
      ) {

        this.release(
          stream
        )

      } else {

        this.screen =
          stream
      }


      if (
        this.screen
      ) {

        const videoTrack =
          this.screen
            .getVideoTracks()[0]


        if (
          videoTrack
        ) {

          videoTrack.onended =
            () => {

              this
                .shareScreen(
                  false
                )
                .catch(
                  error =>
                    this.fail(
                      error.message
                    )
                )
            }
        }


        for (
          const track
          of this.screen
            .getAudioTracks()
        ) {

          track.onended =
            () => {

              this.notify()

              this
                .updateTracks()
                .catch(
                  error =>
                    this.fail(
                      error.message
                    )
                )
            }
        }
      }

    } else if (
      !enabled
    ) {

      this.release(
        this.screen
      )

      this.screen =
        null
    }


    this.publishVideoState()

    this.notify()

    await this
      .updateTracks()
  }


  // ===================================================
  // MANO
  // ===================================================

  hand(raised) {

    this.send({
      type:
        'hand',

      raised
    })
  }


  // ===================================================
  // TURNO
  // ===================================================

  floor(peerId) {

    this.send({
      type:
        'floor',

      peerId
    })
  }


  // ===================================================
  // ERROR
  // ===================================================

  fail(message) {

    if (
      this.closed
    ) {
      return
    }

    this.stop()

    this.onError(
      message
    )
  }


  // ===================================================
  // SALIR
  // ===================================================

  stop() {

    if (
      this.closed
    ) {
      return
    }


    this.send({
      type:
        'leave'
    })


    this.closed =
      true


    this.generation++


    this.socket
      ?.close()


    this.peers
      .forEach(
        peer =>
          peer.close()
      )


    this.peers.clear()

    this.remote.clear()


    this.media
      .forEach(
        stream =>
          stream
            .getTracks()
            .forEach(
              track =>
                track.stop()
            )
      )


    this.media.clear()


    this.camera =
      null

    this.screen =
      null

    this.mic =
      null

    this.micStream =
      null


    this.onClose?.()
  }
}