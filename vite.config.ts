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
            { name: 'vendor-icons', test: /node_modules[\\/]lucide-react/ },
            {
              name: 'vendor-auth',
              test: /node_modules[\\/](?:@firebase[\\/]auth|firebase[\\/]auth)/,
            },
            {
              name: 'vendor-firestore',
              test: /node_modules[\\/](?:@firebase[\\/]firestore|firebase[\\/]firestore)/,
            },
          ],
        },
      },
    },
  },
});
