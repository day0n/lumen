import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const initialShellSources = [
  '../src/components/shell/Topbar.tsx',
  '../src/components/shell/LumenMark.tsx',
  '../src/components/shell/LanguageToggle.tsx',
  '../src/components/shell/shell-icons.tsx',
];

test('initial shell sources exclude animation and icon runtimes', async () => {
  for (const relativePath of initialShellSources) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from ['"]motion\/react['"]/);
    assert.doesNotMatch(source, /from ['"]@tabler\/icons-react['"]/);
  }
});

test('notifications stay behind a fixed-size lazy shell boundary', async () => {
  const source = await readFile(
    new URL('../src/components/shell/Topbar.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /lazy\(\(\) =>\s*import\(['"]\.\/NotificationsPopover['"]\)/s);
  assert.match(
    source,
    /<Suspense fallback=\{<NotificationSlotFallback \/>\}>\s*<NotificationsPopover \/>\s*<\/Suspense>/s,
  );
  assert.match(source, /h-11 w-11/);
  assert.doesNotMatch(source, /import\s+\{\s*NotificationsPopover\s*\}\s+from\s+['"][^'"]+['"]/);
});
