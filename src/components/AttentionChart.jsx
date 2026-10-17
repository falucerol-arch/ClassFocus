import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

export default function AttentionChart({ data }) {
  const chartData = data.length ? data.slice(-20).map((x, i) => ({
    name: x.label || `${i + 1}`,
    atencion: x.attention
  })) : [
    { name: '1', atencion: 78 }, { name: '2', atencion: 85 }, { name: '3', atencion: 82 },
    { name: '4', atencion: 91 }, { name: '5', atencion: 84 }, { name: '6', atencion: 88 }
  ]

  return (
    <div className="chart-card">
      <div className="section-title"><h3>Atención durante la sesión</h3><span>0–100%</span></div>
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis dataKey="name" />
            <YAxis domain={[0, 100]} />
            <Tooltip />
            <Line type="monotone" dataKey="atencion" stroke="currentColor" strokeWidth={3} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
