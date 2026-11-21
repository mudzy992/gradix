import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Backend koji dev/preview server proxy-ja (isti default kao docker-compose).
const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:3000'

const proxy = {
  '/api': { target: apiTarget, changeOrigin: true },
  '/socket.io': { target: apiTarget, ws: true },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    host: true,
    proxy,
  },
  // `vite preview` služi buildani dist — isti proxy kao u dev modu
  // (koristi se u CI web-e2e jobu i za lokalnu provjeru produkcijskog builda).
  preview: {
    proxy,
  },
})
