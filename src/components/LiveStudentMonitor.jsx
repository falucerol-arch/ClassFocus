import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, Video } from 'lucide-react'
import './LiveClassroom.css'

// El panel solo ofrece el acceso; los medios y la llamada pertenecen a su propia ruta.
export default function LiveStudentMonitor({ subjects = [] }) {
  const navigate = useNavigate()
  const [selected, setSelected] = useState('')
  const subject = subjects.find(item => item.id === selected) || subjects[0]
  return <section className="class-launcher">
    <div className="class-launcher-copy"><div className="class-launcher-icon"><Video size={24} /></div>
      <div><span className="eyebrow">AULA EN VIVO</span><h2>Un espacio para tu clase</h2>
        <p>Abre el aula para presentar, escuchar a tus alumnos y organizar sus turnos.</p></div></div>
    <div className="class-launcher-actions"><label htmlFor="live-subject">Materia</label>
      <select id="live-subject" value={subject?.id || ''} disabled={!subject} onChange={event => setSelected(event.target.value)}>
        {!subject && <option value="">Sin materias asignadas</option>}
        {subjects.map(item => <option key={item.id} value={item.id}>{item.name}{item.section ? ` · ${item.section}` : ''}</option>)}
      </select>
      <button className="primary-button" disabled={!subject} onClick={() => navigate(`/teacher/class?subject=${encodeURIComponent(subject.id)}`)}>
        Abrir aula <ArrowUpRight size={17} /></button>
    </div>
  </section>
}
