import { DrawingUtils, FaceLandmarker } from '@mediapipe/tasks-vision'

const utilsByContext = new WeakMap()

// Dibuja la malla facial sobre un canvas con las mismas dimensiones que el video.
// El canvas se refleja por CSS igual que el video, por lo que no se invierte aquí.
export function drawFaceMesh(canvas, video, faces = [], { accent = '#ff4d5a' } = {}) {
  const width = video?.videoWidth
  const height = video?.videoHeight
  if (!canvas || !width || !height) return
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, width, height)
  if (!faces.length) return

  let utils = utilsByContext.get(ctx)
  if (!utils) {
    utils = new DrawingUtils(ctx)
    utilsByContext.set(ctx, utils)
  }

  faces.forEach((landmarks, index) => {
    // La segunda persona se resalta en otro color para que el aviso sea evidente.
    const main = index === 0 ? accent : '#ffb020'
    utils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, { color: 'rgba(255,255,255,.2)', lineWidth: 0.6 })
    utils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, { color: main, lineWidth: 2 })
    utils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LIPS, { color: main, lineWidth: 1.6 })
    utils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, { color: '#5cf2c6', lineWidth: 1.6 })
    utils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, { color: '#5cf2c6', lineWidth: 1.6 })
    utils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, { color: main, lineWidth: 1.4 })
    utils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW, { color: main, lineWidth: 1.4 })
    utils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, { color: '#ffffff', lineWidth: 1.6 })
    utils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS, { color: '#ffffff', lineWidth: 1.6 })
  })
}

export function clearMesh(canvas) {
  const ctx = canvas?.getContext('2d')
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
}
