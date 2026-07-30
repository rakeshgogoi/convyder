"""Local TTS via Windows SAPI (System.Speech), invoked through PowerShell.
Free, no API key, Windows-only — mirrors say_tts_provider.py's shape and
constraints for the macOS side.

Windows has nothing as consistent as macOS's `say -v` voice-name list —
installed SAPI voices vary wildly across Windows versions/editions and
which language packs the user has installed. Rather than a fixed voice
name, the PowerShell script picks the best *installed* voice matching
the requested language by ISO culture prefix (e.g. "es" matches
"es-ES", "es-MX", ...), falling back to whatever voice is the OS
default if no matching language pack is installed — English always
works out of the box; other languages need the user to install that
language's Windows Speech pack (Settings > Time & Language > Language
& region > Add a language > install its speech/text-to-speech pack).
"""
import asyncio
import os
import subprocess
import tempfile
import wave

from app.providers.tts_provider import TTSProvider

SAMPLE_RATE_HZ = 16000

# Text is written to a file and read back inside PowerShell rather than
# passed as a command-line argument — avoids both shell-injection risk and
# PowerShell's own parameter-binding ambiguity (translated text starting
# with "-" could otherwise be mistaken for a new flag).
_POWERSHELL_SCRIPT = r"""
param([string]$TextPath, [string]$LangCode, [string]$OutPath)
Add-Type -AssemblyName System.Speech
$Text = Get-Content -Path $TextPath -Raw -Encoding UTF8
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice = $synth.GetInstalledVoices() | Where-Object {
    $_.Enabled -and $_.VoiceInfo.Culture.TwoLetterISOLanguageName -eq $LangCode
} | Select-Object -First 1
if ($voice) { $synth.SelectVoice($voice.VoiceInfo.Name) }
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
    16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono
)
$synth.SetOutputToWaveFile($OutPath, $format)
$synth.Speak($Text)
$synth.Dispose()
"""


class WindowsTTSProvider(TTSProvider):
    def __init__(self, language_code: str = "en") -> None:
        self.language_code = language_code

    async def synthesize(self, text: str) -> bytes:
        if not text.strip():
            return b""
        return await asyncio.to_thread(self._synthesize_sync, text)

    def _synthesize_sync(self, text: str) -> bytes:
        with tempfile.TemporaryDirectory() as tmp_dir:
            script_path = os.path.join(tmp_dir, "synthesize.ps1")
            text_path = os.path.join(tmp_dir, "text.txt")
            wav_path = os.path.join(tmp_dir, "out.wav")

            with open(script_path, "w", encoding="utf-8") as f:
                f.write(_POWERSHELL_SCRIPT)
            with open(text_path, "w", encoding="utf-8") as f:
                f.write(text)

            subprocess.run(
                [
                    "powershell",
                    "-NoProfile",
                    "-ExecutionPolicy", "Bypass",
                    "-File", script_path,
                    "-TextPath", text_path,
                    "-LangCode", self.language_code,
                    "-OutPath", wav_path,
                ],
                check=True,
                capture_output=True,
            )
            with wave.open(wav_path, "rb") as wf:
                return wf.readframes(wf.getnframes())
