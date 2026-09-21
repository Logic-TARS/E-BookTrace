def normalize_note_tags(tags: list[str]) -> list[str]:
    normalized = []
    seen = set()
    for tag in tags:
        value = tag.strip()
        if not value or value in seen:
            continue
        seen.add(value)
        normalized.append(value)
    return normalized
