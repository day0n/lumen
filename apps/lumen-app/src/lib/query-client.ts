import { QueryClient } from '@tanstack/react-query';

export const queryDurations = {
  projectsList: { staleTime: 60_000, gcTime: 30 * 60_000 },
  projectDetail: { staleTime: 5 * 60_000, gcTime: 60 * 60_000 },
  materials: { staleTime: 5 * 60_000, gcTime: 60 * 60_000 },
  folders: { staleTime: 5 * 60_000, gcTime: 60 * 60_000 },
  hotVideos: { staleTime: 30 * 60_000, gcTime: 6 * 60 * 60_000 },
  me: { staleTime: 60_000, gcTime: 10 * 60_000 },
} as const;

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 30 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}
