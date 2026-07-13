import 'server-only';

import { type RemakeJobQueryService, createRemakeJobQueryService } from '@lumen/backend';
import type { RemakeJobRecord, RemakeTaskRecord } from '@lumen/db';

import { getRemakeJobRepository } from '@/server/db';
import { traceStudioStep } from '@/server/telemetry';

let remakeJobQueries: RemakeJobQueryService<RemakeJobRecord, RemakeTaskRecord> | null = null;

export function getStudioRemakeJobQueries(): RemakeJobQueryService<
  RemakeJobRecord,
  RemakeTaskRecord
> {
  remakeJobQueries ??= createRemakeJobQueryService({
    getRepository: getRemakeJobRepository,
    trace: traceStudioStep,
    tracePrefix: 'studio',
  });
  return remakeJobQueries;
}
