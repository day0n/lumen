import { ShareLoginPanel } from '@/components/share/ShareLoginPanel';
import { localePath } from '@/i18n/routing';
import { getRequestLocale } from '@/i18n/server';
import { cloneSharedProject, getSharedProjectPreview } from '@/server/projects';
import { auth } from '@clerk/nextjs/server';
import { notFound, redirect } from 'next/navigation';

interface ShareProjectPageProps {
  params: Promise<{
    shareId: string;
  }>;
}

export default async function ShareProjectPage({ params }: ShareProjectPageProps) {
  const { shareId } = await params;
  const locale = await getRequestLocale();
  const preview = await getSharedProjectPreview(shareId);
  if (!preview) notFound();

  const { userId } = await auth();
  if (!userId) {
    return <ShareLoginPanel projectTitle={preview.title} shareId={shareId} />;
  }

  const project = await cloneSharedProject(shareId);
  if (!project) notFound();

  redirect(localePath(`/canvas/${project.id}`, locale));
}
