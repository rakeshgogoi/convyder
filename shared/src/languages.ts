// Curated language list for the UI's language pickers. Each entry needs a
// working macOS `say` voice (TTS is still `say`-based — see CLAUDE.md open
// items) and, where available, a Sarvam STT language code so Indian
// languages can automatically route through Sarvam instead of Whisper
// (see backend/app/providers/sarvam_stt_provider.py) when an API key is
// configured — Whisper's `base` model has known quality problems on these.
//
// Voices verified via `say -v '?'` on macOS. Sarvam codes verified against
// https://docs.sarvam.ai (Saaras v3 supported source languages).
//
// sayVoiceMale is deliberately optional: macOS only ships a distinct male
// *and* female voice pair for languages covered by its shared "Eddy"/"Flo"
// personality-voice set (English, Spanish, French, German, Italian,
// Portuguese, Japanese, Korean, Chinese). The 5 Indian languages plus
// Russian only have the single voice this system shipped — no male
// alternative exists to select, verified via the same `say -v '?'` query,
// not assumed. backend-process.ts falls back to the female voice for
// these when male is requested.
export interface LanguageOption {
  code: string;
  label: string;
  sayVoiceFemale: string;
  sayVoiceMale?: string;
  sarvamLanguageCode?: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  // No sarvamLanguageCode for English on purpose, even though Sarvam
  // supports en-IN: Whisper already handles general English well (proven
  // extensively), and auto-routing English through Sarvam the moment any
  // Sarvam key is configured (e.g. just for Hindi output) would silently
  // send audio off-device and cost money for no quality benefit.
  { code: 'en', label: 'English', sayVoiceFemale: 'Samantha', sayVoiceMale: 'Eddy (English (US))' },
  { code: 'es', label: 'Spanish', sayVoiceFemale: 'Monica', sayVoiceMale: 'Eddy (Spanish (Spain))' },
  // Thomas is a native (non-generic) male French voice — better quality
  // than the shared Eddy voice, so it's kept as-is; Flo fills the female
  // side since no native fr_FR female name is in this verified voice set.
  { code: 'fr', label: 'French', sayVoiceFemale: 'Flo (French (France))', sayVoiceMale: 'Thomas' },
  { code: 'de', label: 'German', sayVoiceFemale: 'Anna', sayVoiceMale: 'Eddy (German (Germany))' },
  { code: 'it', label: 'Italian', sayVoiceFemale: 'Alice', sayVoiceMale: 'Eddy (Italian (Italy))' },
  { code: 'pt', label: 'Portuguese', sayVoiceFemale: 'Luciana', sayVoiceMale: 'Eddy (Portuguese (Brazil))' },
  { code: 'ja', label: 'Japanese', sayVoiceFemale: 'Kyoko', sayVoiceMale: 'Eddy (Japanese (Japan))' },
  { code: 'ko', label: 'Korean', sayVoiceFemale: 'Yuna', sayVoiceMale: 'Eddy (Korean (South Korea))' },
  { code: 'zh', label: 'Chinese (Mandarin)', sayVoiceFemale: 'Tingting', sayVoiceMale: 'Eddy (Chinese (China mainland))' },
  { code: 'ru', label: 'Russian', sayVoiceFemale: 'Milena' },
  { code: 'hi', label: 'Hindi', sayVoiceFemale: 'Lekha', sarvamLanguageCode: 'hi-IN' },
  { code: 'bn', label: 'Bengali', sayVoiceFemale: 'Piya', sarvamLanguageCode: 'bn-IN' },
  { code: 'ta', label: 'Tamil', sayVoiceFemale: 'Vani', sarvamLanguageCode: 'ta-IN' },
  { code: 'te', label: 'Telugu', sayVoiceFemale: 'Geeta', sarvamLanguageCode: 'te-IN' },
  { code: 'kn', label: 'Kannada', sayVoiceFemale: 'Soumya', sarvamLanguageCode: 'kn-IN' },
];

export function findLanguageOption(code: string): LanguageOption | undefined {
  return LANGUAGE_OPTIONS.find((option) => option.code === code);
}
