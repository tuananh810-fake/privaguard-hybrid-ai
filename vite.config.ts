import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler)/ },
            { name: 'vendor-firestore', test: /node_modules[\\/]@firebase[\\/]firestore/ },
            { name: 'vendor-firebase', test: /node_modules[\\/](@firebase|firebase)/ },
            { name: 'vendor-icons', test: /node_modules[\\/]lucide-react/ },
          ],
        },
      },
    },
  },
});
