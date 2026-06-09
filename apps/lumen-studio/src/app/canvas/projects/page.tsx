import { redirectWithLocale } from '@/i18n/server';

export default async function CanvasProjectsPage() {
  await redirectWithLocale('/app/projects');
}
