"""Shared text post-processing for STT output."""


def collapse_repetition_loops(text: str, max_consecutive_repeats: int = 2) -> str:
    """Detects and truncates runaway repetition loops — a well-known
    degenerate-generation failure mode in ASR/seq2seq models (observed
    live: Sarvam STT produced the same short Hindi phrase repeated dozens
    of times). Keeps up to `max_consecutive_repeats` copies of any phrase
    that repeats 3+ times consecutively, dropping the rest — short
    natural repetition ("yes yes") survives, runaway loops don't.
    """
    words = text.split()
    if len(words) < 6:
        return text

    max_phrase_len = min(8, len(words) // 3)
    for n in range(max_phrase_len, 1, -1):
        i = 0
        while i + n * 3 <= len(words):
            phrase = words[i : i + n]
            repeats = 1
            j = i + n
            while words[j : j + n] == phrase:
                repeats += 1
                j += n
            if repeats >= 3:
                keep_until = i + n * max_consecutive_repeats
                return " ".join(words[:keep_until])
            i += 1

    return text
