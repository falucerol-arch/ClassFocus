import { storageService } from '../services/storageService'

const levelFor = value => (value === null ? 'none' : value >= 75 ? 'good' : value >= 55 ? 'mid' : 'bad')

// Vista rápida de toda la clase: un recuadro por alumno con su atención promedio y sus incidencias.
export default function ClassOverview({ students = [], selectedId, onSelect }) {
  const rows = students.map(({ student }) => {
    const samples = storageService.getSamples(student.id)
    const incidents = storageService.getIncidents(student.id)
    const average = samples.length ? Math.round(samples.reduce((sum, item) => sum + item.attention, 0) / samples.length) : null
    return { student, average, incidents: incidents.length }
  })
  if (!rows.length) return null

  return (
    <section className="class-overview">
      <div className="section-title"><h3>Vista rápida de la clase</h3><span>Verde ≥ 75 % · Ámbar 55–74 % · Rojo &lt; 55 %</span></div>
      <div className="overview-grid">
        {rows.map(row => (
          <button key={row.student.id} type="button" className={`overview-tile ${levelFor(row.average)} ${row.student.id === selectedId ? 'selected' : ''}`} onClick={() => onSelect?.(row.student.id)}>
            <span className="overview-initial">{row.student.name.trim().charAt(0).toUpperCase()}</span>
            <strong>{row.student.name}</strong>
            <div className="overview-bar"><i style={{ width: `${row.average ?? 0}%` }} /></div>
            <small>{row.average === null ? 'Sin datos todavía' : `${row.average}% atención`} · {row.incidents} {row.incidents === 1 ? 'incidencia' : 'incidencias'}</small>
          </button>
        ))}
      </div>
    </section>
  )
}
