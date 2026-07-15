import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the static notification popover uses the shared optimistic read boundary', async () => {
  const source = await readFile(
    new URL('../src/components/shell/NotificationsPopover.tsx', import.meta.url),
    'utf8',
  );
  assert.match(
    source,
    /import \{ markNotificationReadOptimistically \} from '@lumen\/shared\/notification-read';/,
  );
  assert.match(source, /markNotificationReadOptimistically\(notification\.id,/);
  assert.doesNotMatch(source, /\/api\/notifications\/official\/\$\{/);
});
