import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// On GitHub Pages project sites the app is served from /<repo>/.
// Set BASE_PATH=/ when a custom domain (public/CNAME) is used.
const base = process.env.BASE_PATH || '/case-connect/';

export default defineConfig({
  base,
  plugins: [react()],
});
