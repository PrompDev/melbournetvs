export interface InstallationImage {
  url: string;
  alt: string;
  width: number;
  height: number;
}

/**
 * Genuine Melbourne TVs job photos. These are intentionally described as
 * workmanship examples, not suburb-specific jobs: no location attribution is
 * added until the business verifies where an image was captured.
 */
export const INSTALLATION_IMAGES: readonly InstallationImage[] = [
  {
    url: "https://cdn.melbournetvs.com/work/v1/installer-large-tv.jpg",
    alt: "TV installer standing beside a large wall-mounted Samsung television",
    width: 2880,
    height: 2160,
  },
  {
    url: "https://cdn.melbournetvs.com/work/v1/apartment-wall-mounted-tv.jpg",
    alt: "Wall-mounted TV above a timber media cabinet in an apartment",
    width: 1600,
    height: 1200,
  },
  {
    url: "https://cdn.melbournetvs.com/work/v1/clean-wall-mounted-tv.jpg",
    alt: "Wall-mounted TV on a clean white wall in a bright living room",
    width: 1200,
    height: 1600,
  },
  {
    url: "https://cdn.melbournetvs.com/work/v1/frame-tv-lounge.jpg",
    alt: "Samsung Frame TV displaying artwork in a modern living room",
    width: 1420,
    height: 1894,
  },
  {
    url: "https://cdn.melbournetvs.com/work/v1/tv-above-fireplace.jpg",
    alt: "Wall-mounted TV above a tiled fireplace",
    width: 1600,
    height: 1200,
  },
  {
    url: "https://cdn.melbournetvs.com/work/v1/living-room-tv-soundbar.webp",
    alt: "Wall-mounted TV and soundbar in a furnished living room",
    width: 1360,
    height: 1020,
  },
  {
    url: "https://cdn.melbournetvs.com/work/v1/tv-soundbar.jpg",
    alt: "Wall-mounted TV with a soundbar installed below",
    width: 1600,
    height: 1200,
  },
  {
    url: "https://cdn.melbournetvs.com/work/v1/technician-tv-setup.jpg",
    alt: "TV technician checking a large wall-mounted television",
    width: 1600,
    height: 1200,
  },
] as const;

function stableIndex(value: string, length: number): number {
  let hash = 0;
  for (const character of value.toLowerCase()) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash % length;
}

export function getLocationImage(locationKey: string): InstallationImage {
  return INSTALLATION_IMAGES[stableIndex(locationKey, INSTALLATION_IMAGES.length)];
}
