// Deja MediaPipe listo para funcionar SIN internet (ideal para una exposición con wifi dudoso).
//   npm run setup:offline          copia el WASM y descarga el modelo si falta
//   npm run setup:offline -- --force   vuelve a descargar el modelo
import { access, cp, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const wasmFrom = path.join(root, 'node_modules/@mediapipe/tasks-vision/wasm')
const wasmTo = path.join(root, 'public/mediapipe/wasm')
const modelPath = path.join(root, 'public/models/face_landmarker.task')
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const exists = file => access(file).then(() => true, () => false)

if (!(await exists(wasmFrom))) {
  console.error('No encuentro node_modules/@mediapipe/tasks-vision. Ejecuta primero: npm ci')
  process.exit(1)
}
await mkdir(wasmTo, { recursive: true })
await cp(wasmFrom, wasmTo, { recursive: true })
console.log('✔ WASM de MediaPipe copiado a public/mediapipe/wasm')

if ((await exists(modelPath)) && !process.argv.includes('--force')) {
  console.log('✔ El modelo ya existe en public/models/face_landmarker.task')
} else {
  try {
    await mkdir(path.dirname(modelPath), { recursive: true })
    const response = await fetch(MODEL_URL)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    await writeFile(modelPath, Buffer.from(await response.arrayBuffer()))
    console.log('✔ Modelo descargado en public/models/face_landmarker.task')
  } catch (error) {
    console.error(`✖ No se pudo descargar el modelo (${error.message}).`)
    console.error(`  Descárgalo manualmente desde:\n  ${MODEL_URL}\n  y guárdalo como public/models/face_landmarker.task`)
    process.exit(1)
  }
}
console.log('Listo: ClassFocus usará estos archivos locales y solo recurrirá a internet si faltan.')
