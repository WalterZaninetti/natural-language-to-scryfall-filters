export const INDEX_VERSION = 1;

export interface SetEntry {
  code: string;
  name: string;
  normalized: string;
  setType: string;
  releasedAt?: string;
  blockCode?: string;
  block?: string;
}

export interface GroundingIndex {
  version: number;
  fetchedAt: string;
  sets: SetEntry[];
  keywords: string[];
  types: string[];
  watermarks: string[];
  abilityWords: string[];
}

export interface EntityCandidates {
  sets: SetEntry[];
  keywords: string[];
  types: string[];
  watermarks: string[];
}
