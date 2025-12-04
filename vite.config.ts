import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, existsSync, mkdirSync } from 'fs';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-manifest',
      closeBundle() {
        // Copy manifest.json to dist
        copyFileSync(
          resolve(__dirname, 'manifest.json'),
          resolve(__dirname, 'dist/manifest.json')
        );

        // Copy inject.js to dist
        if (existsSync(resolve(__dirname, 'src/content/inject.js'))) {
          copyFileSync(
            resolve(__dirname, 'src/content/inject.js'),
            resolve(__dirname, 'dist/inject.js')
          );
        }
        
        // Copy brute-force-scanner.js to dist
        if (existsSync(resolve(__dirname, 'src/content/brute-force-scanner.js'))) {
          copyFileSync(
            resolve(__dirname, 'src/content/brute-force-scanner.js'),
            resolve(__dirname, 'dist/brute-force-scanner.js')
          );
        }
        
        // Copy icons if they exist
        const iconsDir = resolve(__dirname, 'public/icons');
        const distIconsDir = resolve(__dirname, 'dist/icons');
        
        if (existsSync(iconsDir)) {
          if (!existsSync(distIconsDir)) {
            mkdirSync(distIconsDir, { recursive: true });
          }
          
          // Copy icon files if they exist
          ['icon16.png', 'icon48.png', 'icon128.png', 'SERVICEITLOGO.png'].forEach(icon => {
            const iconPath = resolve(iconsDir, icon);
            if (existsSync(iconPath)) {
              copyFileSync(iconPath, resolve(distIconsDir, icon));
            }
          });
        }
      },
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        content: resolve(__dirname, 'src/content/index.tsx'),
        background: resolve(__dirname, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        assetFileNames: (assetInfo) => {
          // Name CSS file as content.css to match manifest.json
          if (assetInfo.name === 'style.css') {
            return 'content.css';
          }
          return '[name].[ext]';
        },
      },
    },
    cssCodeSplit: false,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
  },
});

