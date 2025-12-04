import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Set base for GitHub Pages under repo path
  base: '/BIDGAIA/',
  build: {
    // Emit static site into docs/ for manual GitHub Pages
    outDir: 'docs',
    emptyOutDir: true,
  },
})
