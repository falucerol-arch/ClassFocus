import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Mic, MicOff, Video, VideoOff, Volume2 } from 'lucide-react'
import { DevicePreview as PreviewController } from '../services/devicePreviewService'
import { classroomError } from '../services/classroomUi'

const empty = { camera: null, microphone: false, devices: [], level: 0 }
export default forwardRef(function DevicePreview({ name, teacher, onError, onBusy }, ref) {
  const [state, setState] = useState(empty)
  const [busy, setBusy] = useState(false)
  const controller = useRef(null)
  const video = useRef(null)
  const mounted = useRef(true)
  const outputSupported = typeof globalThis.HTMLMediaElement?.prototype?.setSinkId === 'function'
  useEffect(() => {
    mounted.current = true
    const preview = new PreviewController({ onChange: value => { if (mounted.current) setState(value) } })
    controller.current = preview
    preview.refresh().catch(() => {})
    return () => { mounted.current = false; preview.stop() }
  }, [])
  useImperativeHandle(ref, () => ({ takeForCall: role => controller.current?.takeForCall(role) || {} }), [])
  useEffect(() => {
    const element = video.current
    element.srcObject = state.camera
    if (state.camera) element.play().catch(() => {})
    return () => { element.srcObject = null }
  }, [state.camera])
  async function perform(action, kind) {
    setBusy(true); onBusy(true); onError('')
    try { await action() }
    catch (error) { if (mounted.current) onError(classroomError(error, kind)) }
    finally { if (mounted.current) { setBusy(false); onBusy(false) } }
  }
  function choices(kind) {
    return state.devices.filter(item => item.kind === kind && item.deviceId)
      .filter((item, index, items) => items.findIndex(other => other.deviceId === item.deviceId) === index)
  }
  const cameras = choices('videoinput'), microphones = choices('audioinput'), outputs = choices('audiooutput')
  return <div className="meeting-device-preview" aria-label="Comprobar dispositivos">
    <div className="meeting-preview-video"><video ref={video} muted autoPlay playsInline />
      {!state.camera && <div className="meeting-preview-placeholder"><div className="meeting-lobby-avatar">{name.split(' ').slice(0, 2).map(word => word[0]).join('')}</div><p>Tu cámara está apagada</p></div>}
      <span className="meeting-preview-name">{name} (tú)</span>
      <div className="meeting-preview-toggles">
        <button type="button" aria-label={state.microphone ? 'Detener prueba de micrófono' : 'Probar micrófono'} aria-pressed={state.microphone}
          disabled={busy} onClick={() => perform(() => controller.current.enable('microphone', !state.microphone), 'microphone')}>
          {state.microphone ? <Mic size={20} /> : <MicOff size={20} />}<span>{state.microphone ? 'Detener prueba' : 'Probar micrófono'}</span></button>
        <button type="button" aria-label={state.camera ? 'Apagar cámara de prueba' : 'Probar cámara'} aria-pressed={!!state.camera}
          disabled={busy} onClick={() => perform(() => controller.current.enable('camera', !state.camera), 'camera')}>
          {state.camera ? <Video size={20} /> : <VideoOff size={20} />}<span>{state.camera ? 'Apagar cámara' : 'Probar cámara'}</span></button>
      </div>
    </div>
    <div className="meeting-device-selectors">
      <label>Cámara<select aria-label="Cámara para la clase" value={state.cameraId || ''} disabled={busy}
        onChange={event => perform(() => controller.current.select('camera', event.target.value), 'camera')}>
        <option value="">Cámara predeterminada</option>{cameras.map((item, i) => <option key={item.deviceId} value={item.deviceId}>{item.label || `Cámara ${i + 1}`}</option>)}</select></label>
      <label>Micrófono<select aria-label="Micrófono para la clase" value={state.microphoneId || ''} disabled={busy}
        onChange={event => perform(() => controller.current.select('microphone', event.target.value), 'microphone')}>
        <option value="">Micrófono predeterminado</option>{microphones.map((item, i) => <option key={item.deviceId} value={item.deviceId}>{item.label || `Micrófono ${i + 1}`}</option>)}</select></label>
      <label>Altavoces<select aria-label="Salida de audio de prueba" value={state.outputId || ''} disabled={busy || !outputSupported}
        onChange={event => perform(() => controller.current.testSpeaker(event.target.value), 'speaker')}>
        <option value="">Salida predeterminada</option>{outputs.map((item, i) => <option key={item.deviceId} value={item.deviceId}>{item.label || `Altavoz ${i + 1}`}</option>)}</select></label>
    </div>
    <div className="meeting-device-checks"><div className="meeting-mic-check"><span>{state.microphone ? state.meterAvailable ? 'Habla para comprobar el nivel' : 'Micrófono activo · medidor no disponible' : 'Prueba de micrófono apagada'}</span>
      <div className="meeting-level" role="meter" aria-label="Nivel del micrófono" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.level}>
        <i style={{ width: `${state.level}%` }} /></div></div>
      <button type="button" disabled={busy} onClick={() => perform(() => controller.current.testSpeaker(state.outputId), 'speaker')}><Volume2 size={17} />Probar altavoces</button></div>
    <p className="meeting-preview-note">Esta prueba solo la ves y escuchas tú. {teacher ? 'Al entrar, se conservan la cámara y el micrófono que hayas activado.' : 'Se conserva tu cámara; el micrófono entra apagado hasta que el maestro te dé la palabra.'}
      {!outputSupported && ' La salida de audio utiliza la configuración del sistema.'}</p>
  </div>
})
