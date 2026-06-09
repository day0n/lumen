import { redirectWithLocale } from '@/i18n/server';

export default async function MaterialsPage() {
  await redirectWithLocale('/app/materials');
}
