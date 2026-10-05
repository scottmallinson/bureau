import type { Platform } from './types.js';

export interface PlatformInfo {
  label: string;
  /** Short mark for tight spaces such as calendar chips. */
  short: string;
  /**
   * Categorical colour slot (1-8). Colour follows the platform, never its
   * rank, so a filter that hides one platform never repaints the others.
   */
  slot: number;
}

export const PLATFORMS: Record<Platform, PlatformInfo> = {
  ghost: { label: 'Ghost', short: 'GH', slot: 1 },
  linkedin: { label: 'LinkedIn', short: 'LI', slot: 2 },
  bluesky: { label: 'Bluesky', short: 'BS', slot: 3 },
  mastodon: { label: 'Mastodon', short: 'MA', slot: 7 },
  threads: { label: 'Threads', short: 'TH', slot: 5 },
  twitter: { label: 'X', short: 'X', slot: 4 },
  facebook: { label: 'Facebook', short: 'FB', slot: 6 },
  instagram: { label: 'Instagram', short: 'IG', slot: 8 },
  other: { label: 'Other', short: '··', slot: 0 },
};

/** Maps Buffer's `Service` enum onto Bureau platforms. */
export function platformFromBufferService(service: string): Platform {
  switch (service) {
    case 'linkedin':
    case 'twitter':
    case 'mastodon':
    case 'bluesky':
    case 'threads':
    case 'facebook':
    case 'instagram':
      return service;
    default:
      return 'other';
  }
}

export function platformLabel(platform: Platform): string {
  return PLATFORMS[platform]?.label ?? platform;
}
