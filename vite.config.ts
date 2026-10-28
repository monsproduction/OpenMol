import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Versionsnummer für „Über OpenMol“ (auch in der Browser-Version)
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
})
