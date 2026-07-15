export async function readClientApiJson<T>(
  response: Response,
  unavailableMessage: string,
): Promise<T> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(unavailableMessage);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(unavailableMessage);
  }
}
