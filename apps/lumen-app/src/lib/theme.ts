'use client';

import { type MantineColorsTuple, createTheme } from '@mantine/core';

const flame: MantineColorsTuple = [
  '#edfbff',
  '#d4f6ff',
  '#a4edff',
  '#79e4ff',
  '#4fd4f4',
  '#27bde3',
  '#1397bd',
  '#107797',
  '#145f78',
  '#164f65',
];

const ink: MantineColorsTuple = [
  '#f4f6f8',
  '#e2e7ec',
  '#c6ced6',
  '#9ba6af',
  '#68737d',
  '#3c434a',
  '#292e33',
  '#1b1f23',
  '#111315',
  '#090a0b',
];

export const lumenTheme = createTheme({
  primaryColor: 'flame',
  primaryShade: { light: 5, dark: 5 },
  colors: {
    flame,
    ink,
  },
  fontFamily: 'var(--font-inter), -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
  headings: {
    fontFamily:
      'var(--font-display), var(--font-inter), -apple-system, BlinkMacSystemFont, sans-serif',
    fontWeight: '700',
  },
  defaultRadius: 'lg',
  radius: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '20px',
  },
  cursorType: 'pointer',
  components: {
    Button: {
      defaultProps: {
        radius: 'xl',
      },
    },
    Input: {
      defaultProps: {
        radius: 'lg',
      },
    },
  },
});
