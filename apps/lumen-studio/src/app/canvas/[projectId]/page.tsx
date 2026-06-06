import { redirect } from 'next/navigation';

interface CanvasProjectPageProps {
  params: Promise<{
    projectId: string;
  }>;
}

export default async function CanvasProjectPage({ params }: CanvasProjectPageProps) {
  const { projectId } = await params;
  redirect(`/app/canvas/${projectId}`);
}
