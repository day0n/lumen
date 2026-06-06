import type { Config } from 'tailwindcss';
import studioConfig from '../lumen-studio/tailwind.config';

const config: Config = {
  ...studioConfig,
  content: ['./src/**/*.{ts,tsx,html}', '../lumen-studio/src/**/*.{ts,tsx,mdx}'],
};

export default config;
