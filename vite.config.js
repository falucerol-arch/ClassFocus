import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  // En Render el sitio se publica desde la raíz
  base: '/',

  server: {
    port: 5173
  }
})