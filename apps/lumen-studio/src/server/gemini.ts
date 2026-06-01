import 'server-only';

import { GoogleGenAI } from '@google/genai';

import { getStudioServerConfig } from './config';

let cachedClient: GoogleGenAI | null = null;

export class GeminiNotConfiguredError extends Error {
  constructor() {
    super('Gemini 未配置（需要 GOOGLE_OC_JSON/GOOGLE_CLOUD_PROJECT/GOOGLE_CLOUD_LOCATION）');
    this.name = 'GeminiNotConfiguredError';
  }
}

export function getStudioGoogleClient(): GoogleGenAI {
  if (cachedClient) return cachedClient;

  const config = getStudioServerConfig();
  const serviceAccount = config.GOOGLE_OC_JSON?.trim();
  const project = config.GOOGLE_CLOUD_PROJECT?.trim();
  const location = config.GOOGLE_CLOUD_LOCATION?.trim() || 'global';

  if (!serviceAccount || !project) {
    throw new GeminiNotConfiguredError();
  }

  const serviceAccountJson = Buffer.from(serviceAccount, 'base64').toString('utf-8');
  const credentials = JSON.parse(serviceAccountJson);

  cachedClient = new GoogleGenAI({
    vertexai: true,
    project,
    location,
    googleAuthOptions: { credentials },
  });

  return cachedClient;
}

export async function generateGeminiText(prompt: string): Promise<string> {
  const client = getStudioGoogleClient();
  const response = await client.models.generateContent({
    model: 'gemini-3.5-flash',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });

  return response.text ?? '';
}
