"""Sarvam AI translation (Mayura) — for Indian language pairs, better
quality than Argos Translate on colloquial/conversational text (Argos
mistranslated "अरे छोड़ो", "hey, never mind", as "Log in"). Needs a Sarvam
API key, not free.

REST API: POST https://api.sarvam.ai/translate, JSON body (input,
source_language_code, target_language_code, mode, model), auth via the
`api-subscription-key` header. `mode=modern-colloquial` fits casual
conversational speech better than the default `formal`.
"""
import asyncio

import requests

from app.providers.mt_provider import MTProvider

SARVAM_TRANSLATE_URL = "https://api.sarvam.ai/translate"


class SarvamMTProvider(MTProvider):
    def __init__(self, api_key: str, source_lang: str, target_lang: str, model: str = "mayura:v1") -> None:
        self.api_key = api_key
        self.source_lang = source_lang
        self.target_lang = target_lang
        self.model = model

    async def translate(self, text: str) -> str:
        if not text.strip():
            return ""
        return await asyncio.to_thread(self._translate_sync, text)

    def _translate_sync(self, text: str) -> str:
        response = requests.post(
            SARVAM_TRANSLATE_URL,
            headers={"api-subscription-key": self.api_key},
            json={
                "input": text,
                "source_language_code": self.source_lang,
                "target_language_code": self.target_lang,
                "mode": "modern-colloquial",
                "model": self.model,
            },
            timeout=15,
        )
        response.raise_for_status()
        return (response.json().get("translated_text") or "").strip()
