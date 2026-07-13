export function isTemplateVideoInViewport(
  rect: Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>,
  viewportWidth: number,
  viewportHeight: number,
) {
  return (
    rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth
  );
}

export async function requestTemplateVideoPlayback(video: Pick<HTMLVideoElement, 'play'>) {
  try {
    await video.play();
  } catch {
    return;
  }
}

export function tryLoadTemplateVideo(video: Pick<HTMLVideoElement, 'load'>) {
  try {
    video.load();
  } catch {
    return;
  }
}

export function releaseTemplateVideo(video: HTMLVideoElement, loaded: boolean) {
  video.pause();
  if (!loaded) return;
  video.removeAttribute('src');
  tryLoadTemplateVideo(video);
}
