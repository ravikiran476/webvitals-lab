import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // React and the charting library change rarely: separate files stay cached across releases.
        // React itself must not land in the charts chunk, or the first page would need the charts too.
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (/[\\/]node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor|internmap|decimal\.js-light|eventemitter3|lodash|react-smooth|recharts-scale|tiny-invariant|clsx|react-is)[\\/]/.test(id)) return 'charts';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:4000' },
  },
});
