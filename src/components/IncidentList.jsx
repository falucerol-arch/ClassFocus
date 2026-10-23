export const typeLabels = {
  gaze: 'Mirada desviada',
  tab: 'Cambio de pestaña',
  'no-face': 'Rostro ausente',
  fullscreen: 'Salida de pantalla completa',
  'multi-face': 'Varias personas',
  clipboard: 'Copiar o pegar',
  'camera-off': 'Cámara apagada'
}

export default function IncidentList({ incidents }) {
  return (
    <div className="table-card">
      <div className="section-title"><h3>Incidencias recientes</h3><span>{incidents.length} registradas</span></div>
      <div className="incident-list">
        {incidents.length === 0 && <div className="empty-state">Todavía no hay incidencias.</div>}
        {incidents.slice(0, 12).map(item => (
          <div className="incident-row" key={item.id}>
            <span className={`severity ${item.severity}`}></span>
            <div><strong>{typeLabels[item.type] || item.type}</strong><small>{item.message}</small></div>
            <time>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
          </div>
        ))}
      </div>
    </div>
  )
}
