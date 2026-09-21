from notes import normalize_note_tags


def test_normalize_note_tags_preserves_first_occurrence():
    assert normalize_note_tags([" 哲学 ", "", "哲学", "阅读", " 阅读 "]) == [
        "哲学",
        "阅读",
    ]
