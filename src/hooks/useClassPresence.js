import { useEffect, useState } from 'react'
import { ClassPresence } from '../services/classPresenceService'

export function useClassPresence(userId) {
  const token = sessionStorage.getItem('classfocus_api_token')
  const [state, setState] = useState({ status: 'connecting', classes: [] })
  const [notice, setNotice] = useState(null)
  useEffect(() => {
    setNotice(null)
    const observer = new ClassPresence({ token, onState: setState, onStarted: setNotice })
    observer.start()
    return () => observer.stop()
  }, [userId, token])
  // Una clase finalizada o una conexión caída retira también su aviso anterior.
  const activeNotice = state.classes.find(item => item.instanceId === notice?.instanceId)
  return { ...state, notice: activeNotice, dismiss: () => setNotice(null) }
}
