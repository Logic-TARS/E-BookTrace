from datetime import date
from typing import Any, Optional


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


def escape_markdown_inline(value: str) -> str:
    escaped = value.replace("\\", "\\\\")
    for character in ("`", "*", "_", "[", "]"):
        escaped = escaped.replace(character, f"\\{character}")
    return escaped


def markdown_blockquote(value: str) -> str:
    return "\n".join(f"> {line}" for line in (value.splitlines() or [""]))


def _inline_value(value: Any) -> str:
    return escape_markdown_inline(" ".join(str(value or "").splitlines()))


def _note_sort_key(note: dict[str, Any]) -> tuple[Any, str, str]:
    return (
        note.get("progress_percent") or 0,
        str(note.get("created_at") or ""),
        str(note.get("id") or ""),
    )


def render_notes_markdown(
    notes: list[dict[str, Any]], *, offline: bool = False
) -> str:
    sections = ["# E-书痕 笔记"]
    if offline:
        sections.append("> 离线导出，可能不完整。")

    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for note in notes:
        key = (
            str(note.get("book_title") or ""),
            str(note.get("book_author") or ""),
        )
        groups.setdefault(key, []).append(note)

    for (book_title, book_author), book_notes in sorted(groups.items()):
        book_parts = [f"## 《{_inline_value(book_title)}》"]
        book_parts.append(f"**作者**：{_inline_value(book_author)}")

        for note in sorted(book_notes, key=_note_sort_key):
            chapter = _inline_value(note.get("chapter"))
            progress = _inline_value(note.get("progress_percent"))
            note_parts = [f"### {chapter} · {progress}%"]
            note_parts.append(markdown_blockquote(str(note.get("highlight_text") or "")))

            reflection = str(note.get("note") or "")
            if reflection:
                note_parts.extend(["**感悟**", markdown_blockquote(reflection)])

            tags = note.get("tags") or []
            if tags:
                note_parts.append(
                    "**标签**：" + "、".join(_inline_value(tag) for tag in tags)
                )

            note_parts.extend(
                [
                    f"**创建时间**：{_inline_value(note.get('created_at'))}",
                    f"**更新时间**：{_inline_value(note.get('updated_at'))}",
                ]
            )
            book_parts.append("\n\n".join(note_parts))

        sections.append("\n\n".join(book_parts))

    return "\n\n".join(sections) + "\n"


def notes_markdown_filename(today: Optional[date] = None) -> str:
    export_date = today or date.today()
    return f"E-书痕-笔记-{export_date.isoformat()}.md"
