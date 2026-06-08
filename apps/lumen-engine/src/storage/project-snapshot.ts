import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { NodeOutputType } from '@lumen/shared/domain';

import { config } from '../config.js';
import { getMongo } from '../database/mongo.js';
import { logger } from '../utils/logger.js';
import { uploadProjectSnapshotBuffer } from './r2.js';

interface StudioProjectDocument {
  _id: string;
  owner_id: string;
  thumbnail?: string;
  deleted_at?: Date;
}

const STUDIO_PROJECTS_COLLECTION = 'studio_projects';

export interface SnapshotCandidate {
  type: 'image' | 'video';
  url: string;
}

export async function updateProjectSnapshotFromRun(args: {
  projectId: string;
  userId: string | null;
  candidate: SnapshotCandidate;
  signal?: AbortSignal;
}): Promise<void> {
  if (!args.userId) {
    logger.warn(
      { projectId: args.projectId },
      'project snapshot update skipped: missing project owner',
    );
    return;
  }

  const snapshotUrl = await resolveProjectSnapshotUrl(args.candidate, args.projectId, args.signal);
  if (!snapshotUrl) return;

  const db = await getMongo();
  const result = await db.collection<StudioProjectDocument>(STUDIO_PROJECTS_COLLECTION).updateOne(
    {
      _id: args.projectId,
      owner_id: args.userId,
      deleted_at: { $exists: false },
    },
    {
      $set: { thumbnail: snapshotUrl },
    },
  );

  if (result.matchedCount === 0) {
    logger.warn(
      { projectId: args.projectId, userId: args.userId },
      'project snapshot update skipped: project not found for owner',
    );
    return;
  }

  logger.info(
    {
      projectId: args.projectId,
      userId: args.userId,
      snapshotUrl,
      outputType: args.candidate.type,
    },
    'project snapshot updated',
  );
}

async function resolveProjectSnapshotUrl(
  candidate: SnapshotCandidate,
  projectId: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (candidate.type === 'image') {
    return candidate.url.trim() || null;
  }

  try {
    const frame = await extractVideoFirstFrame(candidate.url, signal);
    if (!frame) return null;
    const asset = await uploadProjectSnapshotBuffer({
      body: frame,
      contentType: 'image/jpeg',
      projectId,
    });
    return asset?.url ?? null;
  } catch (err) {
    logger.warn(
      { err, projectId, videoUrl: candidate.url },
      'failed to extract video snapshot, keeping previous thumbnail',
    );
    return null;
  }
}

async function extractVideoFirstFrame(
  videoUrl: string,
  signal?: AbortSignal,
): Promise<Buffer | null> {
  const trimmed = videoUrl.trim();
  if (!trimmed) return null;

  const workdir = await mkdtemp(join(tmpdir(), 'lumen-snapshot-'));
  const outputPath = join(workdir, 'frame.jpg');

  try {
    await runFfmpeg(
      config.VIDEO_EDIT_FFMPEG_PATH,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-ss',
        '0',
        '-i',
        trimmed,
        '-frames:v',
        '1',
        '-q:v',
        '2',
        outputPath,
      ],
      signal,
    );
    const frame = await readFile(outputPath);
    return frame.byteLength > 0 ? frame : null;
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function runFfmpeg(command: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const stderr: Buffer[] = [];
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      cleanup();
      reject(new Error('video snapshot extraction cancelled'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} exited with code ${code}: ${Buffer.concat(stderr).toString('utf8').slice(-1000)}`,
        ),
      );
    });
  });
}

export function isSnapshotOutputType(type: NodeOutputType): type is 'image' | 'video' {
  return type === 'image' || type === 'video';
}
