// Curated language list for the UI's language pickers. Each entry needs a
// working macOS `say` voice (TTS is still `say`-based — see CLAUDE.md open
// items) and, where available, a Sarvam STT language code so Indian
// languages can automatically route through Sarvam instead of Whisper
// (see backend/app/providers/sarvam_stt_provider.py) when an API key is
// configured — Whisper's `base` model has known quality problems on these.
//
// Voices verified via `say -v '?'` on macOS. Sarvam codes verified against
// https://docs.sarvam.ai (Saaras v3 supported source languages).
export interface LanguageOption {
  code: string;
  label: string;
  sayVoice: string;
  sarvamLanguageCode?: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: 'en', label: 'English', sayVoice: 'Samantha', sarvamLanguageCode: 'en-IN' },
  { code: 'es', label: 'Spanish', sayVoice: 'Monica' },
  { code: 'fr', label: 'French', sayVoice: 'Thomas' },
  { code: 'de', label: 'German', sayVoice: 'Anna' },
  { code: 'it', label: 'Italian', sayVoice: 'Alice' },
  { code: 'pt', label: 'Portuguese', sayVoice: 'Luciana' },
  { code: 'ja', label: 'Japanese', sayVoice: 'Kyoko' },
  { code: 'ko', label: 'Korean', sayVoice: 'Yuna' },
  { code: 'zh', label: 'Chinese (Mandarin)', sayVoice: 'Tingting' },
  { code: 'ru', label: 'Russian', sayVoice: 'Milena' },
  { code: 'hi', label: 'Hindi', sayVoice: 'Lekha', sarvamLanguageCode: 'hi-IN' },
  { code: 'bn', label: 'Bengali', sayVoice: 'Piya', sarvamLanguageCode: 'bn-IN' },
  { code: 'ta', label: 'Tamil', sayVoice: 'Vani', sarvamLanguageCode: 'ta-IN' },
  { code: 'te', label: 'Telugu', sayVoice: 'Geeta', sarvamLanguageCode: 'te-IN' },
  { code: 'kn', label: 'Kannada', sayVoice: 'Soumya', sarvamLanguageCode: 'kn-IN' },
];

export function findLanguageOption(code: string): LanguageOption | undefined {
  return LANGUAGE_OPTIONS.find((option) => option.code === code);
}
