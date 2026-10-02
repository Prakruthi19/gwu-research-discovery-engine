import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves a project site from /<repo-name>/, so the deploy
  // workflow sets VITE_BASE. Locally (and on root-domain hosts) it's "/".
  base: process.env.VITE_BASE || '/',
})
