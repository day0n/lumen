type UploadTokenOptions = {
  skipCache?: boolean;
};

type UploadGetToken = (options?: UploadTokenOptions) => Promise<string | null>;

export async function getUploadAuthToken(
  getToken: UploadGetToken,
  options?: UploadTokenOptions,
  timeoutMs = 1500,
): Promise<string | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeout = setTimeout(() => resolve(null), timeoutMs);
  });

  try {
    return await Promise.race([getToken(options).catch(() => null), timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
