import type { RemakeEnvironment, RemakeScene } from './remake.js';

export type RemakeStageName = 'breakdown' | 'script' | 'lock' | 'storyboard' | 'video' | 'final';

export type RemakeStageStatus = 'locked' | 'ready' | 'running' | 'success' | 'error' | 'cancelled';

export interface RemakeStageState {
  status: RemakeStageStatus;
  startedAt?: string;
  settledAt?: string;
}

export interface RemakeJobCharacter {
  name: string;
  gender: 'female' | 'male' | 'unspecified';
  ageRange: string;
  tone: string;
}

export interface RemakeJobPlan {
  scriptText: string;
  scenes: RemakeScene[];
  sellingPoints: string[];
  audienceTags: string[];
  environments: RemakeEnvironment[];
  sceneEnvironmentMap: Record<string, number>;
  creatorPrompt?: string;
  productPrompt?: string;
  bgmPrompt?: string;
  sceneImagePrompts?: string[];
  sceneVideoPrompts?: string[];
  voice?: string;
  character?: RemakeJobCharacter;
}

export interface RemakeTranscriptItem {
  startSec: number;
  endSec: number;
  text: string;
}

export interface RemakeShotItem {
  startSec: number;
  endSec: number;
  action: string;
  actionPattern?: string;
  camera: string;
  visual: string;
  dialogue?: string;
}

export interface RemakeJobBreakdown {
  durationSec: number;
  hook: string;
  angle: string;
  summary: string;
  transcript: RemakeTranscriptItem[];
  shots: RemakeShotItem[];
  language: string;
}

export interface RemakeJobReference {
  id: string;
  label: string;
  value: string;
  source: 'link' | 'video';
  title?: string;
  productName?: string;
  category?: string;
  region?: string;
  thumbnailUrl?: string;
  previewUrl?: string;
}

export interface RemakeJobSceneOutput {
  sceneIndex: number;
  imageUrl?: string;
  videoUrl?: string;
  voiceUrl?: string;
  mixUrl?: string;
}

export interface RemakeJobEnvironmentOutput {
  environmentIndex: number;
  imageUrl?: string;
}

export interface RemakeJobOutputs {
  creatorLockUrl?: string;
  productLockUrl?: string;
  environmentLocks: RemakeJobEnvironmentOutput[];
  scenes: RemakeJobSceneOutput[];
  bgmUrl?: string;
  finalUrl?: string;
}

export interface RemakeJobSettings {
  aspectRatio: string;
  resolution: '720p' | '1080p';
  language: 'zh' | 'en';
  durationSeconds?: number;
}

export interface RemakeJobRecord {
  id: string;
  ownerId: string;
  videoId?: string;
  reference: RemakeJobReference;
  settings: RemakeJobSettings;
  plan: RemakeJobPlan;
  breakdown?: RemakeJobBreakdown;
  productImageUrls: string[];
  creatorImageUrls: string[];
  environmentImageUrls: string[];
  userPrompt?: string;
  stages: Record<RemakeStageName, RemakeStageState>;
  gate1ConfirmedAt?: string;
  gate2ConfirmedAt?: string;
  outputs: RemakeJobOutputs;
  status: 'active' | 'archived';
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export type RemakeTaskHandler =
  | 'nano-banana2'
  | 'veo-3.1'
  | 'fish-tts'
  | 'suno-music'
  | 'lumen-video-edit';

export type RemakeTaskStatus = 'queued' | 'running' | 'success' | 'error' | 'cancelled';

export interface RemakeTaskRecord {
  id: string;
  jobId: string;
  stage: RemakeStageName;
  sliceKey: string;
  handler: RemakeTaskHandler;
  status: RemakeTaskStatus;
  outputUrl?: string;
  outputKind?: 'image' | 'video' | 'audio' | 'text';
  progress: number;
  error?: string;
  inputPrompt?: string;
  startedAt?: string;
  settledAt?: string;
  createdAt: string;
  updatedAt: string;
}
