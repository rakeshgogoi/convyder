"""Local, offline MT via Argos Translate. Free, no API key.

Installing the source->target language package involves a network
download, done eagerly at construction (server startup) so it's not on
the hot path of the first translation request — mirrors how
WhisperSTTProvider is loaded once at startup rather than per-connection.
"""
import asyncio

import argostranslate.package
import argostranslate.translate

from app.providers.mt_provider import MTProvider


class ArgosMTProvider(MTProvider):
    def __init__(self, source_lang: str = "en", target_lang: str = "es") -> None:
        self.source_lang = source_lang
        self.target_lang = target_lang
        self._ensure_package_installed()

    def _ensure_package_installed(self) -> None:
        if self._translation_available():
            return

        argostranslate.package.update_package_index()
        available = argostranslate.package.get_available_packages()
        package = next(
            p for p in available if p.from_code == self.source_lang and p.to_code == self.target_lang
        )
        argostranslate.package.install_from_path(package.download())

    def _translation_available(self) -> bool:
        installed = argostranslate.translate.get_installed_languages()
        from_lang = next((l for l in installed if l.code == self.source_lang), None)
        to_lang = next((l for l in installed if l.code == self.target_lang), None)
        return bool(from_lang and to_lang and from_lang.get_translation(to_lang))

    async def translate(self, text: str) -> str:
        return await asyncio.to_thread(
            argostranslate.translate.translate, text, self.source_lang, self.target_lang
        )
