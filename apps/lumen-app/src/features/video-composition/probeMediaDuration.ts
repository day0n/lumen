export async function probeMediaDurationClient(
  url: string,
  projectId?: string | null,
): Promise<number | null> {
  if (!url.trim()) return null;

  try {
    const duration = await loadVideoMetadataDuration(url);
    if (duration && duration > 0) return duration;
  } catch {
    // fall through to server probe
  }

  try {
    const params = new URLSearchParams({ url });
    if (projectId) params.set('projectId', projectId);
    const response = await fetch(`/api/media/probe?${params.toString()}`, {
      credentials: 'include',
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { ok?: boolean; data?: { duration?: number } };
    if (!payload.ok || typeof payload.data?.duration !== 'number') return null;
    return payload.data.duration > 0 ? payload.data.duration : null;
  } catch {
    return null;
  }
}

function loadVideoMetadataDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.playsInline = true;
    video.muted = true;

    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
    };

    video.addEventListener(
      'loadedmetadata',
      () => {
        const duration = video.duration;
        cleanup();
        if (Number.isFinite(duration) && duration > 0) {
          resolve(duration);
          return;
        }
        reject(new Error('invalid duration'));
      },
      { once: true },
    );

    video.addEventListener(
      'error',
      () => {
        cleanup();
        reject(new Error('metadata load failed'));
      },
      { once: true },
    );

    video.src = url;
  });
}
