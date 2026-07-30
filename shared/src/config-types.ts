// Persisted app config shape — written by the DeviceSetupWizard, read by
// MainScreen, round-tripped through the preload IPC bridge (see
// electron/src/preload/index.ts).

export interface LanguageConfig {
  sttLanguage: string; // e.g. "en", "es", "hi" — matches Whisper language codes
  mtSourceLang: string;
  mtTargetLang: string;
  ttsVoice: string; // macOS `say` voice name, e.g. "Monica", "Lekha", "Samantha"
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

  incoming: LanguageConfig;
  outgoing: LanguageConfig;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  setupComplete: false,
  realMicDeviceId: null,
  meetingAudioInDeviceId: null,
  headphoneDeviceId: null,
  virtualMicOutDeviceId: null,
  incoming: {
    sttLanguage: 'es',
    mtSourceLang: 'es',
    mtTargetLang: 'en',
    ttsVoice: 'Samantha',
  },
  outgoing: {
    sttLanguage: 'en',
    mtSourceLang: 'en',
    mtTargetLang: 'es',
    ttsVoice: 'Monica',
  },
};
