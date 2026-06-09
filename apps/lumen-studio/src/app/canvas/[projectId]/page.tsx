import { redirectWithLocale } from '@/i18n/server';

interface CanvasProjectPageProps {
  params: Promise<{
    projectId: string;
  }>;
}

export default async function CanvasProjectPage({ params }: CanvasProjectPageProps) {
  const { projectId } = await params;
  await redirectWithLocale(`/app/canvas/${projectId}`);
}
