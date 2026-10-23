import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

const BASE = import.meta.env?.BASE_URL || '/'
const LOCAL = {
  name: 'local',
  wasm: `${BASE}mediapipe/wasm`,
  model: `${BASE}models/face_landmarker.task`
}
const CDN = {
  name: 'cdn',
  wasm: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm',
  model: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
}

// Vite devuelve index.html para rutas inexistentes, por eso se descarta text/html.
async function available(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' })
    return response.ok && !(response.headers.get('content-type') || '').includes('text/html')
  } catch {
    return false
  }
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

export class FaceAnalyzer {
  constructor() {
    this.landmarker = null
    this.lastVideoTime = -1
    this.ready = false
    this.source = null // 'local' o 'cdn': permite mostrar si la demo funciona sin internet
    this.delegate = null
  }

  async initialize() {
    // Primero los archivos propios (funciona sin internet); la CDN queda como respaldo.
    const sources = []
    const localOk = (await available(`${LOCAL.wasm}/vision_wasm_internal.wasm`)) && (await available(LOCAL.model))
    if (localOk) sources.push(LOCAL)
    sources.push(CDN)

    let lastError
    for (const source of sources) {
      try {
        const vision = await FilesetResolver.forVisionTasks(source.wasm)
        // Si la GPU no está disponible o falla, se reintenta con CPU en lugar de abortar.
        for (const delegate of ['GPU', 'CPU']) {
          try {
            this.landmarker = await FaceLandmarker.createFromOptions(vision, {
              baseOptions: { modelAssetPath: source.model, delegate },
              runningMode: 'VIDEO',
              numFaces: 2, // con 2 se puede avisar cuando aparece otra persona
              outputFaceBlendshapes: true,
              outputFacialTransformationMatrixes: false
            })
            this.source = source.name
            this.delegate = delegate
            this.ready = true
            return
          } catch (error) {
            lastError = error
          }
        }
      } catch (error) {
        lastError = error
      }
    }
    throw new Error(`No se pudo cargar el análisis facial${lastError?.message ? `: ${lastError.message}` : '.'}`)
  }

  analyze(video) {
    const empty = { hasFace: false, faceCount: 0, attention: 0, yaw: 0, landmarks: null, faces: [], iris: 0 }
    if (!this.ready || !video || video.readyState < 2) {
      return { ...empty, gaze: 'Sin analizar', expression: 'Sin analizar' }
    }

    if (video.currentTime === this.lastVideoTime) return null
    this.lastVideoTime = video.currentTime

    const result = this.landmarker.detectForVideo(video, performance.now())
    const faces = result.faceLandmarks || []
    const landmarks = faces[0]

    if (!landmarks) {
      return { ...empty, gaze: 'Rostro ausente', expression: 'No disponible' }
    }

    const leftEye = landmarks[33]
    const rightEye = landmarks[263]
    const nose = landmarks[1]
    const eyeMidX = (leftEye.x + rightEye.x) / 2
    const eyeDistance = Math.max(Math.abs(rightEye.x - leftEye.x), 0.001)
    const yaw = (nose.x - eyeMidX) / eyeDistance

    const categories = result.faceBlendshapes?.[0]?.categories || []
    const score = name => categories.find(x => x.categoryName === name)?.score || 0

    // Desviación del iris respecto al centro del ojo (0 = mirando al frente, 1 = extremo).
    const irisH = Math.abs((score('eyeLookInLeft') + score('eyeLookOutRight')) - (score('eyeLookOutLeft') + score('eyeLookInRight'))) / 2
    const irisV = Math.abs((score('eyeLookUpLeft') + score('eyeLookUpRight')) - (score('eyeLookDownLeft') + score('eyeLookDownRight'))) / 2
    const iris = Math.max(irisH, irisV)

    let gaze = 'Al frente'
    if (yaw > 0.13) gaze = 'Hacia la izquierda'
    else if (yaw < -0.13) gaze = 'Hacia la derecha'
    else if (irisH > 0.4) gaze = 'Ojos hacia un lado'

    // Giro de cabeza (peso principal) + desviación del iris (peso moderado).
    const penalty = Math.abs(yaw) * 260 + Math.min(35, irisH * 45 + irisV * 25)
    const attention = Math.round(clamp(100 - penalty, 0, 100))
        if (gaze === 'Al frente' && attention < 55) {
      const up = (score('eyeLookUpLeft') + score('eyeLookUpRight')) - (score('eyeLookDownLeft') + score('eyeLookDownRight'))
      if (irisV > irisH && irisV > 0.15) gaze = up > 0 ? 'Ojos hacia arriba' : 'Ojos hacia abajo'
      else if (Math.abs(yaw) > 0.06) gaze = yaw > 0 ? 'Hacia la izquierda' : 'Hacia la derecha'
      else gaze = 'Hacia otro lado'
    }
    const smile = (score('mouthSmileLeft') + score('mouthSmileRight')) / 2
    const blink = (score('eyeBlinkLeft') + score('eyeBlinkRight')) / 2

    let expression = 'Neutral'
    if (smile > 0.35) expression = 'Positivo aparente'
    else if (blink > 0.55) expression = 'Cansancio aparente'

    return { hasFace: true, faceCount: faces.length, attention, gaze, expression, yaw, landmarks, faces, iris }
  }

  close() {
    this.landmarker?.close?.()
    this.landmarker = null
    this.ready = false
  }
}
