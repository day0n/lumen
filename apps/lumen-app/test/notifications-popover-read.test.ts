import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const componentSources = [
  '../src/components/shell/NotificationsPopover.tsx',
  '../../lumen-studio/src/components/home/NotificationsPopover.tsx',
];

test('both notification popovers use the shared optimistic read boundary', async () => {
  for (const relativePath of componentSources) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
    assert.match(
      source,
      /import \{ markNotificationReadOptimistically \} from '@lumen\/shared\/notification-read';/,
    );
    assert.match(source, /markNotificationReadOptimistically\(notification\.id,/);
    assert.doesNotMatch(source, /\/api\/notifications\/official\/\$\{/);
  }
});
