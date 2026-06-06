'use client';

import { useId, useMemo } from 'react';
import { generateLensMap, type LensMapConfig } from './lens-map';

type GlassLensFilterOptions = LensMapConfig & {
  filterScale?: number;
  chroma?: number;
  blur?: number;
};

export function useGlassLensFilter({
  width,
  height,
  borderRadius,
  scale = 0.1,
  depth = 10,
  curvature = 40,
  filterScale = 14,
  chroma = 0.2,
  blur = 0,
}: GlassLensFilterOptions) {
  const reactId = useId();
  const mapUrl = useMemo(
    () =>
      generateLensMap({
        width,
        height,
        borderRadius,
        scale,
        depth,
        curvature,
      }),
    [width, height, borderRadius, scale, depth, curvature],
  );

  const filterId = useMemo(
    () => `lumen-glass-${reactId.replace(/:/g, '')}-${width}x${height}`,
    [height, reactId, width],
  );

  const chromaOffset = Math.max(0.4, chroma * 3);
  const filterStyle = mapUrl ? `url(#${filterId})` : undefined;

  const FilterDefs = useMemo(() => {
    if (!mapUrl) return null;

    function GlassFilterDefs() {
      return (
        <svg aria-hidden className="pointer-events-none absolute h-0 w-0 overflow-hidden">
          <defs>
            <filter
              id={filterId}
              x="-30%"
              y="-30%"
              width="160%"
              height="160%"
              colorInterpolationFilters="sRGB"
            >
              <feImage href={mapUrl} result="displacementMap" width={width} height={height} />
              {blur > 0 ? (
                <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="blurred" />
              ) : null}
              <feDisplacementMap
                in={blur > 0 ? 'blurred' : 'SourceGraphic'}
                in2="displacementMap"
                scale={filterScale}
                xChannelSelector="R"
                yChannelSelector="G"
                result="displaced"
              />
              <feColorMatrix
                in="displaced"
                type="matrix"
                values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
                result="redChannel"
              />
              <feOffset in="redChannel" dx={chromaOffset} dy="0" result="redShift" />
              <feColorMatrix
                in="displaced"
                type="matrix"
                values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
                result="greenChannel"
              />
              <feColorMatrix
                in="displaced"
                type="matrix"
                values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
                result="blueChannel"
              />
              <feOffset in="blueChannel" dx={-chromaOffset} dy="0" result="blueShift" />
              <feBlend in="redShift" in2="greenChannel" mode="screen" result="rg" />
              <feBlend in="rg" in2="blueShift" mode="screen" result="chromatic" />
              <feSpecularLighting
                in="displacementMap"
                surfaceScale={2}
                specularConstant={0.55}
                specularExponent={28}
                lightingColor="white"
                result="specular"
              >
                <fePointLight x={width * 0.35} y={height * 0.2} z={80} />
              </feSpecularLighting>
              <feComposite in="specular" in2="chromatic" operator="in" result="specularMasked" />
              <feBlend in="chromatic" in2="specularMasked" mode="screen" />
            </filter>
          </defs>
        </svg>
      );
    }

    return GlassFilterDefs;
  }, [blur, chromaOffset, filterId, filterScale, height, mapUrl, width]);

  return { filterStyle, FilterDefs, mapUrl };
}
