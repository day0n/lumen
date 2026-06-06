export type LensMapConfig = {
  width: number;
  height: number;
  borderRadius: number;
  scale?: number;
  depth?: number;
  curvature?: number;
};

const NEUTRAL = 128;

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function roundedRectDistance(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): number {
  const r = Math.min(radius, width / 2, height / 2);
  const cx = Math.max(r, Math.min(x, width - r));
  const cy = Math.max(r, Math.min(y, height - r));
  return Math.hypot(x - cx, y - cy) - r;
}

function displacementAt(
  x: number,
  y: number,
  width: number,
  height: number,
  borderRadius: number,
  scale: number,
  depth: number,
  curvature: number,
): { dx: number; dy: number } {
  const sdf = roundedRectDistance(x, y, width, height, borderRadius);
  if (sdf > 0) return { dx: 0, dy: 0 };

  const cx = width / 2;
  const cy = height / 2;
  const nx = (x - cx) / (width / 2);
  const ny = (y - cy) / (height / 2);
  const edge = Math.max(0, Math.min(1, -sdf / Math.max(depth, 1)));
  const radial = Math.hypot(nx, ny);
  const bend = Math.pow(radial, curvature / 40) * scale * (0.35 + edge * 0.65);

  return {
    dx: nx * bend,
    dy: ny * bend,
  };
}

export function generateLensMap({
  width,
  height,
  borderRadius,
  scale = 0.1,
  depth = 10,
  curvature = 40,
}: LensMapConfig): string {
  if (typeof document === 'undefined') return '';

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { dx, dy } = displacementAt(
        x,
        y,
        width,
        height,
        borderRadius,
        scale,
        depth,
        curvature,
      );
      const index = (y * width + x) * 4;
      data[index] = clampByte(NEUTRAL + dx * 127);
      data[index + 1] = clampByte(NEUTRAL + dy * 127);
      data[index + 2] = NEUTRAL;
      data[index + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}
