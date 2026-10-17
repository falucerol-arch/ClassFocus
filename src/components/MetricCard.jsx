export default function MetricCard({ icon: Icon, label, value, hint }) {
  return (
    <article className="metric-card">
      <div className="metric-icon"><Icon size={21} /></div>
      <div><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</div>
    </article>
  )
}
