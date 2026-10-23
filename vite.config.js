import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

   export default defineConfig(({ command, isPreview }) => ({
  plugins: [react()],

  // El desarrollo usa la raíz; se conserva la ruta existente del build para GitHub Pages.
     base: command === 'serve' && !isPreview ? '/' : '/ClassFocus/',

  server: {
    port: 5173
  }
}))