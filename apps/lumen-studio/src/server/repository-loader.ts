/**
 * Cache a resolved repository per process while allowing initialization to
 * retry after a failure.
 */
export function createRepositoryLoader<T>(factory: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  return () => {
    if (promise) return promise;
    promise = factory().catch((error) => {
      promise = null;
      throw error;
    });
    return promise;
  };
}
