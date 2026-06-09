import { redirectWithLocale } from '@/i18n/server';

export default async function CanvasNewPage() {
  await redirectWithLocale('/app/canvas/new');
}
