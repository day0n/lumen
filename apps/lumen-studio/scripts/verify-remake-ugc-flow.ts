import assert from 'node:assert/strict';

import { CreateRemakeJobInputSchema, RemakeJobRecordSchema, type RemakeStageName } from '@lumen/db';
import { type LumenCanvas, computeSingleNodeInput } from '@lumen/shared/domain';

import {
  SliceKeys,
  estimateFinalDurationSeconds,
  expandLockStage,
  parseEnvironmentIndexFromSliceKey,
  sliceOutputField,
} from '../src/server/remake/stages';

const productUrl = 'https://cdn.example.test/product.png';
const productSideUrl = 'https://cdn.example.test/product-side.png';
const productDetailUrl = 'https://cdn.example.test/product-detail.png';
const creatorUrl = 'https://cdn.example.test/creator.png';
const environmentUrl = 'https://cdn.example.test/bathroom-counter.png';

const plan = {
  scriptText: 'Scene 1: Try the pink eye mask in a clean bathroom.',
  sellingPoints: ['Cooling eye care'],
  audienceTags: ['busy skincare shopper'],
  character: {
    name: 'Mia',
    gender: 'female' as const,
    ageRange: '22-30',
    tone: 'warm practical UGC creator',
  },
  creatorPrompt: 'Create a reusable creator reference sheet.',
  productPrompt: 'Create a reusable product reference sheet.',
  environments: [
    {
      index: 1,
      name: 'Bathroom counter',
      description:
        'Clean bathroom counter with mirror, shallow depth, soft daylight, and a close-up demo surface.',
      usedSceneIndexes: [1],
    },
  ],
  sceneEnvironmentMap: { '1': 1 },
  scenes: [
    {
      index: 1,
      action: 'Mia lifts the eye mask from the counter and holds it near her face.',
      dialogue: 'Cooling eye care in one step.',
      voiceLine: 'Cooling eye care in one step.',
      durationSeconds: 4,
      camera: 'handheld close-up, slight push-in',
      environmentIndex: 1,
    },
  ],
};

const stages = Object.fromEntries(
  (['breakdown', 'script', 'lock', 'storyboard', 'video', 'final'] as RemakeStageName[]).map(
    (name) => [
      name,
      {
        status:
          name === 'breakdown' || name === 'script' ? ('success' as const) : ('locked' as const),
      },
    ],
  ),
);

const createInput = CreateRemakeJobInputSchema.parse({
  ownerId: 'user_1',
  reference: {
    id: 'ref_1',
    label: 'Pink eye mask',
    value: 'https://example.test/reference-video',
    source: 'video',
    productName: 'Pink eye mask',
  },
  settings: {
    aspectRatio: '9:16',
    resolution: '720p',
    language: 'en',
  },
  plan,
  creatorImageUrls: [],
  environmentImageUrls: [environmentUrl],
  userPrompt: 'Use my bathroom scene reference and make a faithful UGC remake.',
});

assert.deepEqual(createInput.productImageUrls, [], 'product images are optional');
assert.deepEqual(createInput.environmentImageUrls, [environmentUrl], 'environment refs persist');

const job = RemakeJobRecordSchema.parse({
  id: 'job_1',
  ownerId: createInput.ownerId,
  reference: createInput.reference,
  settings: createInput.settings,
  plan: createInput.plan,
  productImageUrls: createInput.productImageUrls,
  creatorImageUrls: createInput.creatorImageUrls,
  environmentImageUrls: createInput.environmentImageUrls,
  userPrompt: createInput.userPrompt,
  stages,
  outputs: { scenes: [] },
  status: 'active',
  createdAt: new Date('2026-06-06T00:00:00.000Z').toISOString(),
  updatedAt: new Date('2026-06-06T00:00:00.000Z').toISOString(),
});

assert.deepEqual(job.outputs.environmentLocks, [], 'legacy output docs default environmentLocks');

const lockTasks = expandLockStage(job);
assert.deepEqual(
  lockTasks.map((task) => task.sliceKey),
  [SliceKeys.creatorLock, SliceKeys.productLock, SliceKeys.environmentLock(1)],
  'lock stage creates creator, product, and environment locks',
);
assert.equal(sliceOutputField(SliceKeys.environmentLock(1)), 'environmentLockUrl');
assert.equal(parseEnvironmentIndexFromSliceKey(SliceKeys.environmentLock(1)), 1);

const environmentTask = lockTasks.find((task) => task.sliceKey === SliceKeys.environmentLock(1));
assert.ok(environmentTask, 'environment lock task exists');
assert.equal(environmentTask.input.image, environmentUrl);
assert.deepEqual(environmentTask.input.images, [environmentUrl]);

const productTask = lockTasks.find((task) => task.sliceKey === SliceKeys.productLock);
assert.ok(productTask, 'product lock task exists');
assert.equal(productTask.input.image, null);
assert.deepEqual(
  productTask.input.images,
  [],
  'product can be generated from prompt when no image exists',
);
assert.equal(
  estimateFinalDurationSeconds(job),
  3.8,
  'BGM task is trimmed to estimated final short duration',
);

const referencedJob = RemakeJobRecordSchema.parse({
  ...job,
  id: 'job_2',
  productImageUrls: [productUrl, productSideUrl, productDetailUrl],
  creatorImageUrls: [creatorUrl],
  environmentImageUrls: [environmentUrl],
});
const referencedTasks = expandLockStage(referencedJob);
assert.deepEqual(
  referencedTasks.find((task) => task.sliceKey === SliceKeys.creatorLock)?.input.images,
  [creatorUrl],
  'uploaded creator image is used for creator lock',
);
assert.deepEqual(
  referencedTasks.find((task) => task.sliceKey === SliceKeys.productLock)?.input.images,
  [productUrl, productSideUrl, productDetailUrl],
  'uploaded product refs are carried as a multi-image set',
);

const canvas: LumenCanvas = {
  nodes: [
    workflowImageNode('creator', creatorUrl),
    workflowImageNode('product', productUrl),
    workflowImageNode('environment', environmentUrl),
    {
      id: 'storyboard',
      position: { x: 400, y: 0 },
      data: {
        kind: 'image',
        title: 'Storyboard',
        prompt: 'Generate storyboard from all refs',
        settings: {},
      },
    },
  ],
  edges: [
    { id: 'e1', source: 'creator', target: 'storyboard' },
    { id: 'e2', source: 'product', target: 'storyboard' },
    { id: 'e3', source: 'environment', target: 'storyboard' },
  ],
};

const resolved = computeSingleNodeInput(canvas, 'storyboard');
assert.deepEqual(resolved.missingInputs, []);
assert.deepEqual(
  resolved.input.images,
  [creatorUrl, productUrl, environmentUrl],
  'workflow resolver keeps all image refs in images[]',
);
assert.equal(resolved.input.image, creatorUrl, 'legacy image keeps first reference');
assert.equal(
  resolved.input.lastFrameImage,
  productUrl,
  'legacy lastFrameImage keeps second reference',
);

console.log('remake UGC flow verification passed');

function workflowImageNode(id: string, output: string): LumenCanvas['nodes'][number] {
  return {
    id,
    position: { x: 0, y: 0 },
    data: {
      kind: 'image',
      title: id,
      prompt: '',
      output,
      settings: {},
    },
  };
}
