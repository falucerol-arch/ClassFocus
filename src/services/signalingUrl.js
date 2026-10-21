// Avisos y llamadas usan siempre el mismo servidor, tanto en local como al desplegar.
export function signalingUrl() {
  return import.meta.env?.VITE_SIGNALING_URL || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.hostname}:8787`
}
