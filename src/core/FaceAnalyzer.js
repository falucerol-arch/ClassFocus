import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

export class FaceAnalyzer {
  constructor() {
    this.landmarker = null
    this.lastVideoTime = -1
    this.ready = false
  }

  async initialize() {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm'
    )

    this.landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: false
    })
    this.ready = true
  }

  analyze(video) {
    if (!this.ready || !video || video.readyState < 2) {
      return { hasFace: false, attention: 0, gaze: 'Sin analizar', expression: 'Sin analizar', yaw: 0 }
    }

    if (video.currentTime === this.lastVideoTime) return null
    this.lastVideoTime = video.currentTime

    const result = this.landmarker.detectForVideo(video, performance.now())
    const landmarks = result.faceLandmarks?.[0]

    if (!landmarks) {
      return { hasFace: false, attention: 0, gaze: 'Rostro ausente', expression: 'No disponible', yaw: 0 }
    }

    const leftEye = landmarks[33]
    const rightEye = landmarks[263]
    const nose = landmarks[1]
    const eyeMidX = (leftEye.x + rightEye.x) / 2
    const eyeDistance = Math.max(Math.abs(rightEye.x - leftEye.x), 0.001)
    const yaw = (nose.x - eyeMidX) / eyeDistance

    let gaze = 'Al frente'
    if (yaw > 0.13) gaze = 'Hacia la izquierda'
    if (yaw < -0.13) gaze = 'Hacia la derecha'

    const attention = Math.max(0, Math.min(100, Math.round(100 - Math.abs(yaw) * 260)))

    const categories = result.faceBlendshapes?.[0]?.categories || []
    const score = name => categories.find(x => x.categoryName === name)?.score || 0
    const smile = (score('mouthSmileLeft') + score('mouthSmileRight')) / 2
    const blink = (score('eyeBlinkLeft') + score('eyeBlinkRight')) / 2

    let expression = 'Neutral'
    if (smile > 0.35) expression = 'Positivo aparente'
    else if (blink > 0.55) expression = 'Cansancio aparente'

    return { hasFace: true, attention, gaze, expression, yaw }
  }

  close() {
    this.landmarker?.close?.()
    this.landmarker = null
    this.ready = false
  }
}
