import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
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
        find: /^mossmd\/collab$/,
        replacement: path.resolve(__dirname, 'src/collab/index.ts'),
      },
      {
        find: /^mossmd\/syntax$/,
        replacement: path.resolve(__dirname, 'src/core/custom-syntax.ts'),
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
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/__tests__/setup.ts'],
    globals: false,
  },
});
