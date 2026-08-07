export const SPEAK_VOICE_IDS = [
  'cedar',
  'ash',
  'echo',
  'ballad',
  'verse',
  'marin',
  'coral',
  'shimmer',
  'sage',
  'alloy',
] as const;

export type CallVoiceId = typeof SPEAK_VOICE_IDS[number];
export type VoiceCategory = 'male' | 'female';

export type SpeakVoiceOption = {
  id: CallVoiceId;
  label: string;
  presentationCategory: VoiceCategory;
  displayOrder: number;
  enabled: boolean;
  isDefault?: boolean;
};

// Product-curated presentation metadata. These labels are UI groups, not biological claims.
export const SPEAK_VOICE_OPTIONS: readonly SpeakVoiceOption[] = Object.freeze([
  { id: 'cedar', label: 'Voice 1', presentationCategory: 'male', displayOrder: 1, enabled: true, isDefault: true },
  { id: 'ash', label: 'Voice 2', presentationCategory: 'male', displayOrder: 2, enabled: true },
  { id: 'echo', label: 'Voice 3', presentationCategory: 'male', displayOrder: 3, enabled: true },
  { id: 'ballad', label: 'Voice 4', presentationCategory: 'male', displayOrder: 4, enabled: true },
  { id: 'verse', label: 'Voice 5', presentationCategory: 'male', displayOrder: 5, enabled: true },
  { id: 'marin', label: 'Voice 1', presentationCategory: 'female', displayOrder: 1, enabled: true, isDefault: true },
  { id: 'coral', label: 'Voice 2', presentationCategory: 'female', displayOrder: 2, enabled: true },
  { id: 'shimmer', label: 'Voice 3', presentationCategory: 'female', displayOrder: 3, enabled: true },
  { id: 'sage', label: 'Voice 4', presentationCategory: 'female', displayOrder: 4, enabled: true },
  { id: 'alloy', label: 'Voice 5', presentationCategory: 'female', displayOrder: 5, enabled: true },
]);

export const DEFAULT_VOICE_BY_CATEGORY: Readonly<Record<VoiceCategory, CallVoiceId>> = Object.freeze({
  male: 'cedar',
  female: 'marin',
});

export function voicesForCategory(category: VoiceCategory) {
  return SPEAK_VOICE_OPTIONS.filter((option) => option.enabled && option.presentationCategory === category);
}

export function isCallVoiceId(value: unknown): value is CallVoiceId {
  return typeof value === 'string' && (SPEAK_VOICE_IDS as readonly string[]).includes(value);
}

export function voiceSelection(category: VoiceCategory, voiceId?: string | null) {
  const options = voicesForCategory(category);
  const selected = options.find((option) => option.id === voiceId) ?? options[0];
  return { category, voiceId: selected?.id ?? DEFAULT_VOICE_BY_CATEGORY[category] };
}

export function adjacentVoiceId(category: VoiceCategory, voiceId: CallVoiceId, direction: -1 | 1) {
  const options = voicesForCategory(category);
  if (!options.length) return DEFAULT_VOICE_BY_CATEGORY[category];
  const foundIndex = options.findIndex((option) => option.id === voiceId);
  const currentIndex = foundIndex >= 0 ? foundIndex : 0;
  return options[(currentIndex + direction + options.length) % options.length]?.id ?? DEFAULT_VOICE_BY_CATEGORY[category];
}
