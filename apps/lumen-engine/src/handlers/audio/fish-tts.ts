import { config } from '../../config.js';
import type { ResolvedInput } from '../../engine/resolver.js';
import { logger } from '../../utils/logger.js';
import type { NodeOutput } from '../base.js';

const VOICE_MAPPING: Record<string, string> = {
  Rachel: '03397b4c4be74759b72533b663fbd001',
  Elon_Musk: '03397b4c4be74759b72533b663fbd001',
  Alle: '59e9dc1cb20c452584788a2690c80970',
  Paula: 'c2623f0c075b4492ac367989aee1576f',
  Friendly_Woman: 'b545c585f631496c914815291da4e893',
  Marcus_Narrator: '8bed0e9b444046e2bf72da4b251d9a1d',
  CCTV_Narrator: '59cb5986671546eaa6ca8ae6f29f6d22',
  AD_Sister: '7f92f8afb8ec43bf81429cc1c9199cb1',
  LeiJun: 'aebaa2305aa2452fbdc8f41eec852a79',
};

const DEFAULT_VOICE_ID = '03397b4c4be74759b72533b663fbd001'; // Rachel

export async function execute(
  input: ResolvedInput,
  settings: Record<string, unknown>,
): Promise<NodeOutput> {
  const voiceName = (settings.voice as string) ?? 'Rachel';
  const referenceId = VOICE_MAPPING[voiceName] ?? DEFAULT_VOICE_ID;

  const response = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.FISH_AUDIO_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: input.prompt,
      reference_id: referenceId,
      format: 'mp3',
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`fish tts failed (${response.status}): ${errText}`);
  }

  const audioBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(audioBuffer).toString('base64');
  const dataUrl = `data:audio/mpeg;base64,${base64}`;

  logger.info({ voiceName, bytes: audioBuffer.byteLength }, 'fish tts audio generated');

  return { type: 'audio', value: dataUrl };
}
