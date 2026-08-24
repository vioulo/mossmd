import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

const pkgVersion = (
  JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')) as {
    version: string;
  }
).version;

export default defineConfig({
  root: path.resolve(__dirname, 'demo'),
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^mossmd$/,
        replacement: path.resolve(__dirname, 'src/index.ts'),
      },
      {
        find: /^mossmd\/code-languages$/,
        replacement: path.resolve(__dirname, 'src/core/code-languages.ts'),
      },
      {
        find: /^mossmd\/styles\.css$/,
        replacement: path.resolve(__dirname, 'src/styles/inline-preview.css'),
      },
      {
        find: /^mossmd\/editor\.css$/,
        replacement: path.resolve(__dirname, 'src/styles/inline-preview.css'),
      },
      {
        find: /^mossmd\/content\.css$/,
        replacement: path.resolve(__dirname, 'src/styles/content.css'),
      },
      {
        find: /^mossmd\/tokens\.css$/,
        replacement: path.resolve(__dirname, 'src/styles/tokens.css'),
      },
      {
        find: /^mossmd\/collab$/,
        replacement: path.resolve(__dirname, 'src/collab/index.ts'),
      },
      {
        find: /^mossmd\/syntax$/,
        replacement: path.resolve(__dirname, 'src/syntax/index.ts'),
      },
      {
        find: /^mossmd\/theme$/,
        replacement: path.resolve(__dirname, 'src/theme/index.ts'),
      },
      {
        find: /^mossmd\/features$/,
        replacement: path.resolve(__dirname, 'src/features/index.ts'),
      },
      {
        find: /^mossmd\/features\/image$/,
        replacement: path.resolve(__dirname, 'src/features/image/index.ts'),
      },
      {
        find: /^mossmd\/features\/table$/,
        replacement: path.resolve(__dirname, 'src/features/table/index.ts'),
      },
      {
        find: /^mossmd\/features\/wiki-links$/,
        replacement: path.resolve(__dirname, 'src/features/wiki-links/index.ts'),
      },
      {
        find: /^mossmd\/features\/callout$/,
        replacement: path.resolve(__dirname, 'src/features/callout/index.ts'),
      },
    ],
  },
  build: {
    outDir: path.resolve(__dirname, 'demo-dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: false,
    allowedHosts: true,
  },
});
