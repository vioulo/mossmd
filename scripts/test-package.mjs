import { mkdir, rm, cp, writeFile } from 'fs/promises';
import { execSync } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const TEMP_DIR = join(ROOT, '.test-package');
const BUN_TMPDIR = join(TEMP_DIR, '.bun-tmp');
const BUN_INSTALL = join(TEMP_DIR, '.bun-install');

async function run() {
  console.log('Building package...');
  execSync('bun run build', { cwd: ROOT, stdio: 'inherit' });

  console.log('Packing tarball...');
  const tarball = 'mossmd-test-package.tgz';
  execSync(`bun pm pack --filename ${tarball}`, { cwd: ROOT, stdio: 'inherit' });

  console.log('Creating temp directory...');
  await rm(TEMP_DIR, { recursive: true, force: true });
  await mkdir(TEMP_DIR, { recursive: true });
  await mkdir(BUN_TMPDIR, { recursive: true });
  await mkdir(BUN_INSTALL, { recursive: true });

  console.log('Extracting tarball...');
  execSync(`tar -xzf ${tarball} -C ${TEMP_DIR}`, { cwd: ROOT, stdio: 'inherit' });

  const pkgDir = join(TEMP_DIR, 'package');

  console.log('Writing test consumer...');
  const consumerDir = join(TEMP_DIR, 'consumer');
  await mkdir(consumerDir, { recursive: true });

  await writeFile(join(consumerDir, 'package.json'), JSON.stringify({
    name: 'mossmd-test-consumer',
    version: '0.0.0',
    type: 'module',
    dependencies: {
      'mossmd': `file:${pkgDir}`,
      '@codemirror/state': '^6.5.2',
      '@codemirror/view': '^6.38.8',
      '@codemirror/commands': '^6.10.0',
      '@codemirror/autocomplete': '^6.20.0',
      '@codemirror/search': '^6.5.11',
      '@codemirror/language': '^6.12.3',
      '@codemirror/lang-markdown': '^6.5.0',
      '@lezer/common': '^1.2.3',
      '@lezer/highlight': '^1.2.3',
      '@lezer/markdown': '^1.6.3',
      'react': '^19.2.7',
      'react-dom': '^19.2.7',
    },
    devDependencies: {
      '@vitejs/plugin-react': '^4.2.0',
      'vite': '^5.0.0',
    },
  }, null, 2));

  await writeFile(join(consumerDir, 'vite.config.ts'), `
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: { lib: { entry: 'src/main.tsx', formats: ['es'] } },
});
`);

  await mkdir(join(consumerDir, 'src'), { recursive: true });
  await writeFile(join(consumerDir, 'src/main.tsx'), `
import { MossMD } from 'mossmd';
import 'mossmd/styles.css';
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')!).render(
  <MossMD markdownSource="# Hello from consumer" readOnly />
);
`);

  await writeFile(join(consumerDir, 'index.html'), `
<!doctype html>
<html><head><meta charset="UTF-8"><title>Test</title></head>
<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
`);

  console.log('Installing consumer deps...');
  execSync('bun install', {
    cwd: consumerDir,
    env: { ...process.env, BUN_INSTALL, BUN_TMPDIR, TMPDIR: BUN_TMPDIR },
    stdio: 'inherit',
  });

  console.log('Building consumer...');
  execSync('bun run build', { cwd: consumerDir, stdio: 'inherit' });

  console.log('Cleaning up...');
  await rm(TEMP_DIR, { recursive: true, force: true });
  await rm(join(ROOT, tarball), { force: true });

  console.log('✅ Package test passed!');
}

run().catch((err) => {
  console.error('❌ Package test failed:', err);
  process.exit(1);
});
