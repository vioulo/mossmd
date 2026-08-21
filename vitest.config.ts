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
        replacement: path.resolve(__dirname, 'src/syntax/index.ts'),
      },
      {
        find: /^mossmd\/syntax\/callout$/,
        replacement: path.resolve(__dirname, 'src/syntax/callout/index.ts'),
      },
      {
        find: /^mossmd\/theme$/,
        replacement: path.resolve(__dirname, 'src/theme/index.ts'),
      },
      {
        find: /^mossmd\/plugins\/image-blocks$/,
        replacement: path.resolve(__dirname, 'src/plugins/image-blocks.ts'),
      },
      {
        find: /^mossmd\/plugins\/table-widget$/,
        replacement: path.resolve(__dirname, 'src/plugins/table-widget.ts'),
      },
      {
        find: /^mossmd\/plugins\/wiki-links$/,
        replacement: path.resolve(__dirname, 'src/plugins/wiki-links.ts'),
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
