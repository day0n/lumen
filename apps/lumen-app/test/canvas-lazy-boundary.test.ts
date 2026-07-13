import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const canvasRouteSources = ['../src/routes/canvas.new.tsx', '../src/routes/canvas.$projectId.tsx'];

test('canvas routes load the implementation behind a shared lightweight fallback', async () => {
  for (const relativePath of canvasRouteSources) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');

    assert.match(source, /lazy\(\(\) =>\s*import\('\.\.\/features\/canvas\/CanvasRoute'\)/);
    assert.doesNotMatch(
      source,
      /import\s+\{\s*CanvasRoute\s*\}\s+from\s+['"]\.\.\/features\/canvas\/CanvasRoute['"]/,
    );
    assert.match(source, /<Suspense fallback=\{<CanvasRouteFallback \/>\}>/);
  }
});

test('canvas fallback stays independent from the studio canvas runtime', async () => {
  const fallback = await readFile(
    new URL('../src/features/canvas/CanvasRouteFallback.tsx', import.meta.url),
    'utf8',
  );
  const appFallback = await readFile(
    new URL('../src/features/routing/AppRouteFallback.tsx', import.meta.url),
    'utf8',
  );

  for (const dependency of ['CanvasEntryLoader', '@xyflow/react', 'motion/react', 'lumen-studio']) {
    assert.doesNotMatch(fallback, new RegExp(dependency.replace('/', '\\/')));
  }
  assert.match(appFallback, /isCanvasShellRoute\(pathname\)/);
  assert.match(appFallback, /return <CanvasRouteFallback \/>/);
});

test('ReactFlow styles and canvas implementation stay behind the dynamic route boundary', async () => {
  const appStyles = await readFile(new URL('../src/styles/app.css', import.meta.url), 'utf8');
  const canvasRoute = await readFile(
    new URL('../src/features/canvas/CanvasRoute.tsx', import.meta.url),
    'utf8',
  );
  const warmup = await readFile(new URL('../src/lib/app-warmup.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(appStyles, /@xyflow\/react\/dist\/style\.css/);
  assert.match(canvasRoute, /import '@xyflow\/react\/dist\/style\.css'/);
  assert.match(canvasRoute, /fallback=\{<CanvasRouteFallback \/>\}/);
  assert.doesNotMatch(
    canvasRoute,
    /import\s+\{\s*CanvasEntryLoader\s*\}\s+from\s+['"]@\/components\/canvas\/CanvasEntryLoader['"]/,
  );
  assert.doesNotMatch(warmup, /import\(['"]@\/components\/canvas\/CanvasEntryLoader['"]\)/);
});
