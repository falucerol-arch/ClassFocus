import { WebSocketServer } from 'ws'

const port = Number(process.env.SIGNALING_PORT || 8787)
const wss = new WebSocketServer({ port, host: '0.0.0.0' })

wss.on('connection', socket => {
  socket.on('message', raw => {
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(raw.toString())
    }
  })
})

console.log(`ClassFocus signaling WebSocket activo en ws://0.0.0.0:${port}`)
