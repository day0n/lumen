import { Route as rootRouteImport } from './routes/__root';
import { Route as CanvasProjectIdRouteImport } from './routes/canvas.$projectId';
import { Route as CanvasNewRouteImport } from './routes/canvas.new';
import { Route as DashboardRouteImport } from './routes/dashboard';
import { Route as IndexRouteImport } from './routes/index';
import { Route as MaterialsRouteImport } from './routes/materials';
import { Route as ProjectsRouteImport } from './routes/projects';

const ProjectsRoute = ProjectsRouteImport.update({
  id: '/projects',
  path: '/projects',
  getParentRoute: () => rootRouteImport,
} as unknown as Parameters<typeof ProjectsRouteImport.update>[0]);
const MaterialsRoute = MaterialsRouteImport.update({
  id: '/materials',
  path: '/materials',
  getParentRoute: () => rootRouteImport,
} as unknown as Parameters<typeof MaterialsRouteImport.update>[0]);
const DashboardRoute = DashboardRouteImport.update({
  id: '/dashboard',
  path: '/dashboard',
  getParentRoute: () => rootRouteImport,
} as unknown as Parameters<typeof DashboardRouteImport.update>[0]);
const IndexRoute = IndexRouteImport.update({
  id: '/',
  path: '/',
  getParentRoute: () => rootRouteImport,
} as unknown as Parameters<typeof IndexRouteImport.update>[0]);
const CanvasNewRoute = CanvasNewRouteImport.update({
  id: '/canvas/new',
  path: '/canvas/new',
  getParentRoute: () => rootRouteImport,
} as unknown as Parameters<typeof CanvasNewRouteImport.update>[0]);
const CanvasProjectIdRoute = CanvasProjectIdRouteImport.update({
  id: '/canvas/$projectId',
  path: '/canvas/$projectId',
  getParentRoute: () => rootRouteImport,
} as unknown as Parameters<typeof CanvasProjectIdRouteImport.update>[0]);

export interface FileRoutesByFullPath {
  '/': typeof IndexRoute;
  '/dashboard': typeof DashboardRoute;
  '/materials': typeof MaterialsRoute;
  '/projects': typeof ProjectsRoute;
  '/canvas/$projectId': typeof CanvasProjectIdRoute;
  '/canvas/new': typeof CanvasNewRoute;
}
export interface FileRoutesByTo {
  '/': typeof IndexRoute;
  '/dashboard': typeof DashboardRoute;
  '/materials': typeof MaterialsRoute;
  '/projects': typeof ProjectsRoute;
  '/canvas/$projectId': typeof CanvasProjectIdRoute;
  '/canvas/new': typeof CanvasNewRoute;
}
export interface FileRoutesById {
  __root__: typeof rootRouteImport;
  '/': typeof IndexRoute;
  '/dashboard': typeof DashboardRoute;
  '/materials': typeof MaterialsRoute;
  '/projects': typeof ProjectsRoute;
  '/canvas/$projectId': typeof CanvasProjectIdRoute;
  '/canvas/new': typeof CanvasNewRoute;
}
export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath;
  fullPaths: '/' | '/dashboard' | '/materials' | '/projects' | '/canvas/$projectId' | '/canvas/new';
  fileRoutesByTo: FileRoutesByTo;
  to: '/' | '/dashboard' | '/materials' | '/projects' | '/canvas/$projectId' | '/canvas/new';
  id:
    | '__root__'
    | '/'
    | '/dashboard'
    | '/materials'
    | '/projects'
    | '/canvas/$projectId'
    | '/canvas/new';
  fileRoutesById: FileRoutesById;
}
export interface RootRouteChildren {
  IndexRoute: typeof IndexRoute;
  DashboardRoute: typeof DashboardRoute;
  MaterialsRoute: typeof MaterialsRoute;
  ProjectsRoute: typeof ProjectsRoute;
  CanvasProjectIdRoute: typeof CanvasProjectIdRoute;
  CanvasNewRoute: typeof CanvasNewRoute;
}

declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/projects': {
      id: '/projects';
      path: '/projects';
      fullPath: '/projects';
      preLoaderRoute: typeof ProjectsRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    '/materials': {
      id: '/materials';
      path: '/materials';
      fullPath: '/materials';
      preLoaderRoute: typeof MaterialsRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    '/dashboard': {
      id: '/dashboard';
      path: '/dashboard';
      fullPath: '/dashboard';
      preLoaderRoute: typeof DashboardRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    '/': {
      id: '/';
      path: '/';
      fullPath: '/';
      preLoaderRoute: typeof IndexRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    '/canvas/new': {
      id: '/canvas/new';
      path: '/canvas/new';
      fullPath: '/canvas/new';
      preLoaderRoute: typeof CanvasNewRouteImport;
      parentRoute: typeof rootRouteImport;
    };
    '/canvas/$projectId': {
      id: '/canvas/$projectId';
      path: '/canvas/$projectId';
      fullPath: '/canvas/$projectId';
      preLoaderRoute: typeof CanvasProjectIdRouteImport;
      parentRoute: typeof rootRouteImport;
    };
  }
}

const rootRouteChildren: RootRouteChildren = {
  IndexRoute: IndexRoute,
  DashboardRoute: DashboardRoute,
  MaterialsRoute: MaterialsRoute,
  ProjectsRoute: ProjectsRoute,
  CanvasProjectIdRoute: CanvasProjectIdRoute,
  CanvasNewRoute: CanvasNewRoute,
};
export const routeTree = rootRouteImport
  ._addFileChildren(rootRouteChildren)
  ._addFileTypes<FileRouteTypes>();
