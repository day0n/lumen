import { existsSync } from 'node:fs';
import Module from 'node:module';
import { resolve } from 'node:path';

import { RemakeJobRepository, type RemakeStageName, closeMongoDatabases } from '@lumen/db';
import type { ModelConfig, NodeType } from '@lumen/shared/domain';
import { config as dotenvConfig } from 'dotenv';

type StageUntil = Extract<RemakeStageName, 'lock' | 'storyboard' | 'video' | 'final'>;

interface Args {
  ownerId: string;
  jobId?: string;
  videoId?: string;
  referenceUrl?: string;
  productName: string;
  prompt: string;
  locale: 'zh' | 'en';
  productImageUrls: string[];
  creatorImageUrls: string[];
  environmentImageUrls: string[];
  stageFrom: StageUntil;
  stageUntil: StageUntil;
  sliceKeys: string[];
  maxScenes?: number;
}

const STAGE_ORDER: StageUntil[] = ['lock', 'storyboard', 'video', 'final'];

const HANDLER_TYPE_MAP: Record<string, NodeType> = {
  'nano-banana2': 'image',
  'doubao-seedream-3.0': 'image',
  'veo-3.1': 'video',
  'seedance-1.5-pro': 'video',
  'lumen-video-edit': 'video',
  'fish-tts': 'audio',
  'doubao-tts': 'audio',
  'suno-music': 'audio',
};

loadEnv();
stubServerOnlyForNodeCli();

const args = parseArgs(process.argv.slice(2));

async function main() {
  const [{ getMongoDatabase, closeRedisClients }, jobs, stages, taskOutcome, engineBase, r2] =
    await Promise.all([
      import('@lumen/db'),
      import('../src/server/remake/jobs'),
      import('../src/server/remake/stages'),
      import('../src/server/remake/taskOutcome'),
      import('../../lumen-engine/src/handlers/base.js'),
      import('../../lumen-engine/src/storage/r2.js'),
    ]);

  const db = await getMongoDatabase({
    uri: requiredEnv('MONGODB_URI'),
    dbName: process.env.MONGODB_DB?.trim() || 'lumen_app',
    appName: 'lumen-remake-e2e',
  });
  const repository = new RemakeJobRepository(db);
  await repository.ensureIndexes();

  let view: NonNullable<Awaited<ReturnType<typeof jobs.getRemakeJobView>>>;
  if (args.jobId) {
    console.log(`[e2e] resuming job ${args.jobId}`);
    view =
      (await jobs.getRemakeJobView(args.jobId, args.ownerId)) ??
      fail(`job ${args.jobId} not found for owner ${args.ownerId}`);
  } else {
    console.log('[e2e] creating remake job');
    view = await jobs.createRemakeJob({
      ownerId: args.ownerId,
      videoId: args.videoId,
      reference: {
        id: args.videoId ?? `e2e-${Date.now()}`,
        label: args.productName,
        value: args.referenceUrl ?? args.videoId ?? args.productName,
        source: args.videoId || args.referenceUrl ? 'video' : 'link',
        productName: args.productName,
      },
      settings: {
        aspectRatio: '9:16',
        resolution: '720p',
        language: args.locale === 'zh' ? 'zh' : 'en',
        durationSeconds: args.maxScenes ? Math.max(5, args.maxScenes * 4) : 20,
      },
      productImageUrls: args.productImageUrls,
      creatorImageUrls: args.creatorImageUrls,
      environmentImageUrls: args.environmentImageUrls,
      userPrompt: args.prompt,
      locale: args.locale,
    });

    console.log(
      `[e2e] job=${view.job.id} scenes=${view.job.plan.scenes.length} envs=${view.job.plan.environments.length}`,
    );

    view =
      (await jobs.confirmGate1({
        jobId: view.job.id,
        ownerId: args.ownerId,
        scriptText: view.job.plan.scriptText,
        sellingPoints: view.job.plan.sellingPoints,
        audienceTags: view.job.plan.audienceTags,
        voiceLanguage: args.locale === 'zh' ? 'zh' : 'en',
        locale: args.locale,
      })) ?? view;

    if (args.maxScenes && args.maxScenes > 0) {
      view = await clampScenes({
        repository,
        jobs,
        ownerId: args.ownerId,
        jobId: view.job.id,
        maxScenes: args.maxScenes,
      });
    }
  }

  for (const stage of stagesToRun(args.stageFrom, args.stageUntil)) {
    view =
      (await jobs.getRemakeJobView(view.job.id, args.ownerId)) ??
      fail(`job disappeared before ${stage}`);
    let planned = await expandStage(stages, view.job, stage);
    if (stage === args.stageFrom && args.sliceKeys.length > 0) {
      const wanted = new Set(args.sliceKeys);
      planned = planned.filter((task) => wanted.has(task.sliceKey));
    }
    if (!planned.length) fail(`no tasks planned for ${stage}`);

    console.log(`[e2e] ${stage}: planned ${planned.length} task(s)`);
    const created = await repository.createTasks(
      planned.map((task) => ({
        jobId: view.job.id,
        stage: task.stage,
        sliceKey: task.sliceKey,
        handler: task.handler,
        input: task.input,
        settings: task.settings,
      })),
    );
    await repository.updateJob(view.job.id, args.ownerId, {
      stagePatch: { name: stage, state: { status: 'running', startedAt: new Date() } },
      error: null,
    });

    for (const task of created) {
      const plannedTask = planned.find((item) => item.sliceKey === task.sliceKey);
      if (!plannedTask) fail(`missing planned task for ${task.sliceKey}`);
      console.log(`[e2e] ${stage}/${task.sliceKey}: ${task.handler} start`);
      await repository.patchTaskStatus(task.id, { status: 'running', progress: 0 });
      try {
        const nodeType = HANDLER_TYPE_MAP[task.handler];
        if (!nodeType) throw new Error(`unsupported handler ${task.handler}`);
        const output = await engineBase.executeNode(nodeType, plannedTask.input, {
          id: task.handler,
          settings: plannedTask.settings ?? {},
        } satisfies ModelConfig);
        const stored = await r2.persistNodeOutput({
          output,
          runId: view.job.id,
          projectId: `remake-e2e-${args.ownerId}`,
          nodeId: task.sliceKey,
        });
        await taskOutcome.recordTaskOutcome({
          jobId: view.job.id,
          ownerId: args.ownerId,
          taskId: task.id,
          status: 'success',
          progress: 1,
          outputUrl: stored.value,
          outputKind: stored.type,
        });
        console.log(`[e2e] ${stage}/${task.sliceKey}: success ${stored.value}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await taskOutcome.recordTaskOutcome({
          jobId: view.job.id,
          ownerId: args.ownerId,
          taskId: task.id,
          status: 'error',
          error: message,
        });
        throw new Error(`${stage}/${task.sliceKey} failed: ${message}`, { cause: error });
      }
    }

    view =
      (await jobs.getRemakeJobView(view.job.id, args.ownerId)) ??
      fail(`job disappeared after ${stage}`);
    console.log(`[e2e] ${stage}: status=${view.stageStatuses[stage]}`);
    if (view.stageStatuses[stage] !== 'success') {
      fail(`${stage} did not settle as success`);
    }

    if (stage === 'storyboard') {
      view =
        (await jobs.confirmGate2({ jobId: view.job.id, ownerId: args.ownerId })) ??
        fail('confirm gate2 failed');
      console.log('[e2e] gate2 confirmed');
    }
  }

  view =
    (await jobs.getRemakeJobView(view.job.id, args.ownerId)) ?? fail('job disappeared at finish');
  console.log(
    `[e2e] done job=${view.job.id} final=${view.job.outputs.finalUrl ?? '(not requested)'}`,
  );
  console.log(JSON.stringify(summarize(view), null, 2));

  await closeMongoDatabases();
  await closeRedisClients();
}

async function expandStage(
  stages: typeof import('../src/server/remake/stages'),
  job: Awaited<ReturnType<typeof import('../src/server/remake/jobs').getRemakeJobView>>['job'],
  stage: StageUntil,
) {
  if (stage === 'lock') return stages.expandLockStage(job);
  if (stage === 'storyboard') return stages.expandStoryboardStage(job);
  if (stage === 'video') return stages.expandVideoStage(job);
  const final = stages.expandFinalStage(job);
  return final ? [final] : [];
}

async function clampScenes(input: {
  repository: RemakeJobRepository;
  jobs: typeof import('../src/server/remake/jobs');
  ownerId: string;
  jobId: string;
  maxScenes: number;
}) {
  const view =
    (await input.jobs.getRemakeJobView(input.jobId, input.ownerId)) ??
    fail('job disappeared before scene clamp');
  const scenes = view.job.plan.scenes.slice(0, input.maxScenes).map((scene, index) => ({
    ...scene,
    index: index + 1,
    durationSeconds: Math.min(4, scene.durationSeconds),
    environmentIndex: scene.environmentIndex ?? 1,
  }));
  const usedSceneIndexes = scenes.map((scene) => scene.index);
  const environments =
    view.job.plan.environments.length > 0
      ? [
          {
            ...view.job.plan.environments[0]!,
            index: 1,
            usedSceneIndexes,
          },
        ]
      : [
          {
            index: 1,
            name: 'Main UGC space',
            description: 'Reusable UGC scene space for the end-to-end smoke run.',
            usedSceneIndexes,
          },
        ];
  const sceneEnvironmentMap = Object.fromEntries(
    scenes.map((scene) => [String(scene.index), scene.environmentIndex ?? 1]),
  );
  const updated = await input.repository.updateJob(input.jobId, input.ownerId, {
    plan: {
      ...view.job.plan,
      scenes,
      environments,
      sceneEnvironmentMap,
    },
    stagePatch: { name: 'lock', state: { status: 'ready' } },
    outputsPatch: { scenes: [], environmentLocks: [] },
  });
  if (!updated) fail('failed to clamp scenes');
  console.log(`[e2e] clamped plan to ${scenes.length} scene(s) for debugging`);
  return (
    (await input.jobs.getRemakeJobView(input.jobId, input.ownerId)) ??
    fail('job disappeared after scene clamp')
  );
}

function summarize(
  view: Awaited<ReturnType<typeof import('../src/server/remake/jobs').getRemakeJobView>>,
) {
  if (!view) return {};
  return {
    jobId: view.job.id,
    stages: view.stageStatuses,
    outputs: {
      creatorLockUrl: Boolean(view.job.outputs.creatorLockUrl),
      productLockUrl: Boolean(view.job.outputs.productLockUrl),
      environmentLocks: view.job.outputs.environmentLocks.length,
      scenes: view.job.outputs.scenes.map((scene) => ({
        sceneIndex: scene.sceneIndex,
        image: Boolean(scene.imageUrl),
        video: Boolean(scene.videoUrl),
      })),
      bgmUrl: Boolean(view.job.outputs.bgmUrl),
      finalUrl: view.job.outputs.finalUrl ?? null,
    },
  };
}

function stagesToRun(stageFrom: StageUntil, stageUntil: StageUntil): StageUntil[] {
  const start = STAGE_ORDER.indexOf(stageFrom);
  const end = STAGE_ORDER.indexOf(stageUntil);
  if (start > end) fail(`--stage-from ${stageFrom} is after --stage-until ${stageUntil}`);
  return STAGE_ORDER.slice(start, end + 1);
}

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      values.set(key, [...(values.get(key) ?? []), next]);
      index += 1;
    } else {
      values.set(key, [...(values.get(key) ?? []), 'true']);
    }
  }

  const stageUntil = readOne(values, 'stage-until') ?? 'final';
  if (!isStageUntil(stageUntil)) fail(`invalid --stage-until ${stageUntil}`);
  const stageFrom = readOne(values, 'stage-from') ?? 'lock';
  if (!isStageUntil(stageFrom)) fail(`invalid --stage-from ${stageFrom}`);
  const maxScenesRaw = readOne(values, 'max-scenes');
  const maxScenes = maxScenesRaw ? Number.parseInt(maxScenesRaw, 10) : undefined;

  return {
    ownerId: readOne(values, 'owner') ?? `remake-e2e-${Date.now()}`,
    jobId: readOne(values, 'job-id'),
    videoId: readOne(values, 'video-id'),
    referenceUrl: readOne(values, 'reference-url'),
    productName: readOne(values, 'product') ?? 'UGC test product',
    prompt:
      readOne(values, 'prompt') ??
      'End-to-end remake smoke test. Preserve the source action skeleton and use the supplied scene image as the environment anchor.',
    locale: readOne(values, 'locale') === 'en' ? 'en' : 'zh',
    productImageUrls: readMany(values, 'product-image'),
    creatorImageUrls: readMany(values, 'creator-image'),
    environmentImageUrls: readMany(values, 'environment-image'),
    stageFrom,
    stageUntil,
    sliceKeys: readMany(values, 'slice-key'),
    ...(maxScenes ? { maxScenes } : {}),
  };
}

function readOne(values: Map<string, string[]>, key: string): string | undefined {
  return values.get(key)?.at(-1);
}

function readMany(values: Map<string, string[]>, key: string): string[] {
  return (values.get(key) ?? [])
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

function isStageUntil(value: string): value is StageUntil {
  return (STAGE_ORDER as string[]).includes(value);
}

function loadEnv() {
  const studioEnv = resolve(process.cwd(), '.env.local');
  const engineEnv = resolve(process.cwd(), '../lumen-engine/.env.local');
  if (existsSync(studioEnv)) dotenvConfig({ path: studioEnv, override: false });
  if (existsSync(engineEnv)) dotenvConfig({ path: engineEnv, override: false });
}

function stubServerOnlyForNodeCli() {
  const original = (Module as unknown as { _load: typeof Module._load })._load;
  (Module as unknown as { _load: typeof Module._load })._load = function load(
    request: string,
    parent: NodeJS.Module | null | undefined,
    isMain: boolean,
  ) {
    if (request === 'server-only') return {};
    return original.apply(this, [request, parent, isMain]);
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function fail(message: string): never {
  throw new Error(message);
}

main().catch(async (error) => {
  console.error('[e2e] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
  try {
    await closeMongoDatabases();
    const { closeRedisClients } = await import('@lumen/db');
    await closeRedisClients();
  } catch {
    // ignore cleanup errors
  }
});
