from datetime import date

from notes import (
    escape_markdown_inline,
    markdown_blockquote,
    normalize_note_tags,
    notes_markdown_filename,
    render_notes_markdown,
)


def test_normalize_note_tags_preserves_first_occurrence():
    assert normalize_note_tags([" 哲学 ", "", "哲学", "阅读", " 阅读 "]) == [
        "哲学",
        "阅读",
    ]


def test_escape_markdown_inline_escapes_structural_characters_in_order():
    assert escape_markdown_inline(r"路径\\`*_[链接]") == (
        r"路径\\\\\`\*\_\[链接\]"
    )


def test_markdown_blockquote_handles_multiline_text():
    assert markdown_blockquote("第一行\n第二行") == "> 第一行\n> 第二行"


def test_render_notes_markdown_groups_books_and_sorts_by_position():
    markdown = render_notes_markdown(
        [
            {
                "id": "later",
                "book_title": "书甲",
                "book_author": "作者甲",
                "chapter": "第二章",
                "progress_percent": 70,
                "highlight_text": "后面的划线",
                "note": "后面的感悟",
                "tags": ["重读"],
                "created_at": "2026-01-02T00:00:00Z",
                "updated_at": "2026-01-03T00:00:00Z",
            },
            {
                "id": "earlier",
                "book_title": "书甲",
                "book_author": "作者甲",
                "chapter": "第一章",
                "progress_percent": 20,
                "highlight_text": "前面的划线",
                "note": "",
                "tags": [],
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z",
            },
        ]
    )

    assert markdown.index("前面的划线") < markdown.index("后面的划线")
    assert markdown.count("## 《书甲》") == 1
    assert "**感悟**" in markdown
    assert "**标签**：重读" in markdown


def test_render_notes_markdown_keeps_user_multiline_content_out_of_structure():
    markdown = render_notes_markdown(
        [
            {
                "id": "unsafe",
                "book_title": "书名\n## 伪造书名",
                "book_author": "作者\n- 伪造列表",
                "chapter": "章节\n### 伪造章节",
                "progress_percent": 10,
                "highlight_text": "第一行\n## 不是标题",
                "note": "感悟首行\n- 不是列表",
                "tags": ["标签\n- 不是列表"],
                "created_at": "2026-01-01\n- 不是列表",
                "updated_at": "2026-01-02\n- 不是列表",
            }
        ]
    )

    assert "\n## 伪造书名" not in markdown
    assert "\n### 伪造章节" not in markdown
    assert "\n- 伪造列表" not in markdown
    assert "\n> ## 不是标题" in markdown
    assert "\n> - 不是列表" in markdown


def test_render_notes_markdown_marks_offline_exports():
    markdown = render_notes_markdown([], offline=True)

    assert markdown.startswith("# E-书痕 笔记\n\n> 离线导出，可能不完整。")


def test_notes_markdown_filename_uses_supplied_date():
    assert notes_markdown_filename(date(2026, 9, 20)) == "E-书痕-笔记-2026-09-20.md"
