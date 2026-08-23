"""Language ID for lyrics.

`langdetect` has no Cantonese class and is a poor fit for CJK: it scores
character n-grams, so written Chinese can come back as Korean, and it cannot
tell Yue from Mandarin. Whisper's audio LID has the same Cantonese→Korean
failure mode, then transcribes into Hangul, after which text ID "confirms"
Korean.

Writing system is the reliable signal for CJK lyrics. Hangul, kana, and Han
do not overlap. Written Cantonese is Han plus a small set of particles.
"""

from __future__ import annotations

from pathlib import Path

from langdetect import DetectorFactory, LangDetectException, detect_langs

# Deterministic langdetect results across runs.
DetectorFactory.seed = 0

# Distinctive written-Cantonese characters (rare in Mandarin lyrics).
_CANTONESE_MARKERS = frozenset(
    "嘅咗喺啲冇佢哋唔喎噃咩嚟嗰㗎嘢嗱啱攞咁噏嚿冚乸咗啫嗻嘜嚟緊"
)

_MIN_SCRIPT_CHARS = 4
_MIN_HINT_CHARS = 2
_LANGDETECT_MIN_PROB = 0.55

# Whisper's tokenizer has `zh` but not `yue`.
WHISPER_LANGUAGE = {
    "yue": "zh",
    "zh": "zh",
    "zh-cn": "zh",
    "zh-tw": "zh",
    "ko": "ko",
    "ja": "ja",
}


def detect_lyrics_language(
    text: str,
    title: str | None = None,
    artist: str | None = None,
    album: str | None = None,
    file_path: str | None = None,
) -> str:
    """Return a BCP-47-ish code: yue, zh, ko, ja, or a langdetect code."""
    lyrics = " ".join((text or "").split())
    hint = metadata_blob(title, artist, album, file_path)

    lyrics_script = script_language(lyrics)
    hint_script = script_language(hint, min_chars=_MIN_HINT_CHARS) if hint else None

    # Whisper often emits Hangul for Cantonese. If the tags are clearly Han,
    # trust the tags over the (wrong) transcript script.
    if lyrics_script == "ko" and hint_script in {"zh", "yue"}:
        return hint_script
    if lyrics_script:
        return lyrics_script
    if hint_script:
        return hint_script

    guessed = _from_langdetect(lyrics or hint)
    if guessed:
        return guessed
    raise ValueError("could not detect language")


def metadata_blob(
    title: str | None = None,
    artist: str | None = None,
    album: str | None = None,
    file_path: str | None = None,
) -> str:
    parts: list[str] = []
    for value in (title, artist, album):
        if value and value.strip():
            parts.append(value.strip())
    if file_path:
        stem = Path(file_path).stem.replace("_", " ").replace("-", " ")
        if stem:
            parts.append(stem)
    return " ".join(parts)


def script_language(text: str, min_chars: int = _MIN_SCRIPT_CHARS) -> str | None:
    """Classify CJK from writing system, or None if Latin/unknown."""
    if not text:
        return None

    han = hangul = kana = 0
    for char in text:
        code = ord(char)
        if 0x4E00 <= code <= 0x9FFF or 0x3400 <= code <= 0x4DBF:
            han += 1
        elif 0xAC00 <= code <= 0xD7AF or 0x1100 <= code <= 0x11FF:
            hangul += 1
        elif 0x3040 <= code <= 0x30FF:
            kana += 1

    if hangul >= min_chars and hangul >= han and hangul >= kana:
        return "ko"
    # Kana is the Japanese tell; lyrics mix kana with kanji (Han).
    if kana >= min_chars:
        return "ja"
    if han >= min_chars:
        if _cantonese_marker_count(text) >= 2:
            return "yue"
        return "zh"
    return None


def whisper_language_code(code: str | None) -> str | None:
    if not code:
        return None
    return WHISPER_LANGUAGE.get(code.lower(), code.lower())


def _cantonese_marker_count(text: str) -> int:
    return sum(1 for char in set(text) if char in _CANTONESE_MARKERS)


def _from_langdetect(text: str) -> str | None:
    sample = " ".join((text or "").split())
    if len(sample) < 3:
        return None
    try:
        ranked = detect_langs(sample)
    except LangDetectException:
        return None
    if not ranked or ranked[0].prob < _LANGDETECT_MIN_PROB:
        return None
    return _normalize_langdetect(ranked[0].lang)


def _normalize_langdetect(code: str) -> str:
    lowered = code.lower()
    if lowered in {"zh-cn", "zh-tw", "zh"}:
        return "zh"
    return lowered
