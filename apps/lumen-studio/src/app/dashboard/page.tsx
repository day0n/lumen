import { redirectWithLocale } from '@/i18n/server';

export default async function DashboardPage() {
  await redirectWithLocale('/app/dashboard');
}
