import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';

let _client: GoogleGenAI | null = null;

export function getGoogleClient(): GoogleGenAI {
  if (_client) return _client;

  const serviceAccountJson = Buffer.from(config.GOOGLE_OC_JSON, 'base64').toString('utf-8');
  const credentials = JSON.parse(serviceAccountJson);

  _client = new GoogleGenAI({
    vertexai: true,
    project: config.GOOGLE_CLOUD_PROJECT,
    location: config.GOOGLE_CLOUD_LOCATION,
    googleAuthOptions: { credentials },
  });

  return _client;
}
