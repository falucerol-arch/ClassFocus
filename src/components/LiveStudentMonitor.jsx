import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, CameraOff, CircleDot, Info, RefreshCw, UsersRound } from 'lucide-react'
import { TeacherLiveMonitor } from '../services/liveClassService'

function StudentVideo({ student, stream }) {
  const videoRef = useRef(null)

  useEffect(() => {
    if (!videoRef.current) return
    videoRef.current.srcObject = stream || null
    if (stream) videoRef.current.play().catch(() => {})
  }, [stream])

  return (
    <article className="live-student-card">
      <div className="live-video-wrap">
        <video ref={videoRef} muted playsInline />
        {!stream && <div className="live-video-placeholder"><CameraOff size={30} /><span>Conectando video…</span></div>}
        <span className="live-badge"><CircleDot size={13} /> EN VIVO</span>
      </div>
      <div className="live-student-meta">
        <div><strong>{student.studentName}</strong><span>{student.subjectName}</span></div>
        <span className="online-pill">Conectado</span>
      </div>
    </article>
  )
}

export default function LiveStudentMonitor({ teacherId, subjects = [] }) {
  const [students, setStudents] = useState([])
  const [streams, setStreams] = useState({})
  const [restartKey, setRestartKey] = useState(0)
  const subjectIds = useMemo(() => subjects.map(subject => subject.id), [subjects])

  useEffect(() => {
    const monitor = new TeacherLiveMonitor({
      teacherId,
      allowedSubjects: subjectIds,
      onStudentsChange: setStudents,
      onStream: (sessionId, stream) => setStreams(current => ({ ...current, [sessionId]: stream }))
    })
    return () => monitor.stop()
  }, [teacherId, subjectIds.join('|'), restartKey])

  return (
    <section className="live-monitor-card">
      <div className="live-monitor-head">
        <div className="live-monitor-title">
          <div className="live-monitor-icon"><Camera size={22} /></div>
          <div><span className="eyebrow">AULA EN VIVO</span><h2>Cámaras de alumnos conectados</h2><p>El video aparece cuando el alumno entra a una clase asignada e inicia su cámara.</p></div>
        </div>
        <div className="live-monitor-actions">
          <span className="connection-count"><UsersRound size={16} /> {students.length} conectados</span>
          <button className="icon-button" type="button" title="Reconectar monitor" onClick={() => setRestartKey(value => value + 1)}><RefreshCw size={17} /></button>
        </div>
      </div>

      <div className="live-monitor-note"><Info size={17} /><span>El proyecto incluye señalización WebSocket en el puerto 8787 para conectar alumnos y maestro por WebRTC. En producción conviene proteger este canal con autenticación, HTTPS/WSS y TURN.</span></div>

      {students.length ? (
        <div className="live-student-grid">
          {students.map(student => <StudentVideo key={student.sessionId} student={student} stream={streams[student.sessionId]} />)}
        </div>
      ) : (
        <div className="live-empty"><CameraOff size={36} /><strong>No hay alumnos transmitiendo</strong><span>Abre otra pestaña como alumno, entra a una clase e inicia la cámara para probar el monitor.</span></div>
      )}
    </section>
  )
}
