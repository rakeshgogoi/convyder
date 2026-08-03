// Persisted app config shape — written by the Settings panel, read by
// MainScreen, round-tripped through the preload IPC bridge (see
// electron/src/preload/index.ts). Kept minimal: language *codes* only —
// backend-process.ts derives the concrete STT provider/voice/env vars
// from these plus LANGUAGE_OPTIONS at spawn time, so this file doesn't
// need to know about `say` voices or Sarvam.

export interface DirectionLanguageConfig {
  /** The language being spoken/transcribed (STT + MT source). */
  spokenLanguageCode: string;
  /** The language it's translated into (MT target + TTS voice). */
  targetLanguageCode: string;
  /** Which voice gender to speak the translated text in. Not every
   * language has a distinct installed voice for both — see
   * LanguageOption.sayVoiceMale in languages.ts — in which case this is
   * best-effort and silently falls back to whichever voice exists. */
  voiceGender: 'male' | 'female';
}

export interface AppConfig {
  setupComplete: boolean;

  /** Real microphone — outgoing pipeline's audio source. */
  realMicDeviceId: string | null;
  /** Loopback capture device fed by the meeting app's Speaker output (e.g. BlackHole 2ch) — incoming pipeline's audio source. */
  meetingAudioInDeviceId: string | null;
  /** Your headphones/speakers — where incoming's original+translated audio plays. */
  headphoneDeviceId: string | null;
  /** Virtual mic device the meeting app selects as its Microphone (e.g. BlackHole 16ch) — outgoing pipeline's playback target. */
  virtualMicOutDeviceId: string | null;

  incoming: DirectionLanguageConfig;
  outgoing: DirectionLanguageConfig;

  /** Optional — enables Sarvam STT for Indian languages instead of Whisper. Stored locally, sent only to api.sarvam.ai. */
  sarvamApiKey: string | null;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  setupComplete: false,
  realMicDeviceId: null,
  meetingAudioInDeviceId: null,
  headphoneDeviceId: null,
  virtualMicOutDeviceId: null,
  incoming: { spokenLanguageCode: 'es', targetLanguageCode: 'en', voiceGender: 'female' },
  outgoing: { spokenLanguageCode: 'en', targetLanguageCode: 'es', voiceGender: 'female' },
  sarvamApiKey: null,
};
