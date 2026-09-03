"""Translation providers and align prompt for Melodica lyrics.

Google Gemini Flash is the default provider; swap later (e.g. Ollama) without
changing the /translate-align request/response shape.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Optional, Protocol

import httpx
from pydantic import BaseModel, ConfigDict, Field

_DEFAULT_GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
_DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite"


class WordGloss(BaseModel):
    text: str
    gloss: str


class TranslateLineIn(BaseModel):
    line_index: int = Field(alias="lineIndex")
    original: str

    model_config = ConfigDict(populate_by_name=True)


class TranslateDocumentIn(BaseModel):
    id: str
    lines: list[TranslateLineIn]


class TranslateLineOut(BaseModel):
    line_index: int = Field(alias="lineIndex")
    original: str
    sense: str
    words: list[WordGloss]

    model_config = ConfigDict(populate_by_name=True)


class TranslateDocumentOut(BaseModel):
    id: str
    lines: list[TranslateLineOut]


class TranslateAlignRequest(BaseModel):
    target_language: str = Field(alias="targetLanguage")
    source_language: Optional[str] = Field(default=None, alias="sourceLanguage")
    documents: list[TranslateDocumentIn]
    api_key: Optional[str] = Field(default=None, alias="apiKey")
    base_url: Optional[str] = Field(default=None, alias="baseUrl")
    model: Optional[str] = Field(default=None)

    model_config = ConfigDict(populate_by_name=True)


class TranslateAlignResponse(BaseModel):
    documents: list[TranslateDocumentOut]


class TranslationProvider(Protocol):
    def complete_json(self, system: str, user: str) -> dict[str, Any]: ...


class GeminiFlashProvider:
    """Google Gemini generateContent API (Flash family by default)."""

    def __init__(self, api_key: str, base_url: str, model: str) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model

    def complete_json(self, system: str, user: str) -> dict[str, Any]:
        url = f"{self.base_url}/models/{self.model}:generateContent"
        payload = {
            "system_instruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {
                "temperature": 0.2,
                "responseMimeType": "application/json",
            },
        }
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": self.api_key,
        }
        with httpx.Client(timeout=120.0) as client:
            response = client.post(url, headers=headers, json=payload)
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                detail = response.text[:500]
                raise RuntimeError(
                    f"Gemini HTTP {response.status_code}: {detail}"
                ) from exc
            data = response.json()

        content = _gemini_text(data)
        return _parse_json_object(content)


def resolve_api_key(request_key: Optional[str]) -> Optional[str]:
    """Prefer the key passed from Rust (Settings, or .env in debug builds)."""
    if request_key and request_key.strip():
        return request_key.strip()
    # Fallback for standalone `sidecar:dev` without Rust credentials.
    env = os.environ.get("MELODICA_TRANSLATE_API_KEY", "").strip()
    return env or None


def resolve_base_url(request_url: Optional[str]) -> str:
    if request_url and request_url.strip():
        return request_url.strip()
    return os.environ.get("MELODICA_TRANSLATE_BASE_URL", _DEFAULT_GEMINI_BASE).strip()


def resolve_model(request_model: Optional[str]) -> str:
    if request_model and request_model.strip():
        return request_model.strip()
    return os.environ.get("MELODICA_TRANSLATE_MODEL", _DEFAULT_GEMINI_MODEL).strip()


def translate_align(
    req: TranslateAlignRequest,
    provider: Optional[TranslationProvider] = None,
) -> TranslateAlignResponse:
    if not req.documents:
        raise ValueError("documents must not be empty")

    api_key = resolve_api_key(req.api_key)
    if not api_key:
        raise ValueError(
            "No translation API key. Set one in Settings or MELODICA_TRANSLATE_API_KEY."
        )

    active = provider or GeminiFlashProvider(
        api_key=api_key,
        base_url=resolve_base_url(req.base_url),
        model=resolve_model(req.model),
    )

    system = _system_prompt(req.target_language, req.source_language)
    user = _user_payload(req.documents)
    raw = active.complete_json(system, user)
    return _normalize_response(raw, req.documents)


def _gemini_text(data: dict[str, Any]) -> str:
    try:
        parts = data["candidates"][0]["content"]["parts"]
        texts = [
            str(part.get("text") or "")
            for part in parts
            if isinstance(part, dict)
        ]
        content = "".join(texts).strip()
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("Gemini response missing text content") from exc
    if not content:
        raise RuntimeError("Gemini returned empty content")
    return content


def _system_prompt(target: str, source: Optional[str]) -> str:
    source_bit = (
        f"Source language code: {source}."
        if source
        else "Infer the source language from the lyrics."
    )
    return (
        "You help language learners study song lyrics. "
        f"Translate into {target}. {source_bit} "
        "For every input line return: "
        "(1) words: an ordered list of {text, gloss} covering the original line "
        "in singing order (tokenize naturally for the source language; "
        "gloss is a short target-language gloss per token); "
        "(2) sense: one natural target-language sentence for the whole line. "
        "Respond with JSON only, shape: "
        '{"documents":[{"id":"...","lines":[{"lineIndex":0,"sense":"...","words":[{"text":"...","gloss":"..."}]}]}]} '
        "Preserve every document id and every lineIndex. Do not invent extra lines."
    )


def _user_payload(documents: list[TranslateDocumentIn]) -> str:
    payload = {
        "documents": [
            {
                "id": doc.id,
                "lines": [
                    {"lineIndex": line.line_index, "original": line.original}
                    for line in doc.lines
                ],
            }
            for doc in documents
        ]
    }
    return json.dumps(payload, ensure_ascii=False)


def _parse_json_object(content: str) -> dict[str, Any]:
    text = (content or "").strip()
    if not text:
        raise RuntimeError("LLM returned empty content")
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        raise RuntimeError("LLM content was not JSON")
    data = json.loads(match.group(0))
    if not isinstance(data, dict):
        raise RuntimeError("LLM JSON root must be an object")
    return data


def _normalize_response(
    raw: dict[str, Any],
    originals: list[TranslateDocumentIn],
) -> TranslateAlignResponse:
    by_id = {doc.id: doc for doc in originals}
    raw_docs = raw.get("documents")
    if not isinstance(raw_docs, list):
        raise RuntimeError("LLM JSON missing documents array")

    out_docs: list[TranslateDocumentOut] = []
    for raw_doc in raw_docs:
        if not isinstance(raw_doc, dict):
            continue
        doc_id = str(raw_doc.get("id", ""))
        original = by_id.get(doc_id)
        if original is None:
            continue
        original_by_index = {line.line_index: line.original for line in original.lines}
        lines_out: list[TranslateLineOut] = []
        for raw_line in raw_doc.get("lines") or []:
            if not isinstance(raw_line, dict):
                continue
            idx = raw_line.get("lineIndex", raw_line.get("line_index"))
            try:
                line_index = int(idx)
            except (TypeError, ValueError):
                continue
            if line_index not in original_by_index:
                continue
            sense = str(raw_line.get("sense") or "").strip()
            words_raw = raw_line.get("words") or []
            words: list[WordGloss] = []
            if isinstance(words_raw, list):
                for item in words_raw:
                    if not isinstance(item, dict):
                        continue
                    text = str(item.get("text") or "").strip()
                    gloss = str(item.get("gloss") or "").strip()
                    if text:
                        words.append(WordGloss(text=text, gloss=gloss))
            lines_out.append(
                TranslateLineOut(
                    line_index=line_index,
                    original=original_by_index[line_index],
                    sense=sense,
                    words=words,
                )
            )
        out_docs.append(TranslateDocumentOut(id=doc_id, lines=lines_out))

    # Ensure every requested document appears (possibly with empty lines on failure).
    seen = {doc.id for doc in out_docs}
    for doc in originals:
        if doc.id not in seen:
            out_docs.append(TranslateDocumentOut(id=doc.id, lines=[]))

    return TranslateAlignResponse(documents=out_docs)
