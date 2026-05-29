import { failJson, okJson, readJson, routeError } from '@/server/http';
import { createStudioProject, listStudioProjects } from '@/server/projects';
import { CreateProjectInputSchema } from '@lumen/db';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get('q') ?? undefined;
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

    const projects = await listStudioProjects({ query, limit });
    return okJson({ projects });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const input = CreateProjectInputSchema.omit({ ownerId: true }).partial().parse(body);
    const project = await createStudioProject(input);
    return okJson({ project }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return failJson('请求 JSON 格式不正确', 400);
    }
    return routeError(error);
  }
}
