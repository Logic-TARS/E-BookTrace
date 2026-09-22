# Task 6 Report: 边缘唤起按钮与阅读器打磨

## Status: DONE

## What I implemented, step by step

### Step 1: Wired the reveal buttons and hover-to-reveal chrome

In `frontend/app.js`:

1. **Added missing timer variables**: `readerChromeHoverCloseTimer`, `readerNotesHoverCloseTimer`
2. **Added missing DOM reference**: `btnRevealNotes: $('#btn-reveal-notes')`
3. **Added chrome hover functions**: `cancelReaderChromeHoverClose()`, `openReaderChromeOnHover()`, `scheduleReaderChromeHoverClose()` (these were referenced by the existing `revealReaderChromeTemporarily` and `bindEvents` but not defined)
4. **Added notes hover functions**: `cancelReaderNotesHoverClose()`, `openReaderNotesOnHover()`, `scheduleReaderNotesHoverClose()`
5. **Updated `revealReaderChromeTemporarily`**: cancel hover close + only schedule hide on mobile layout (matching v2)
6. **Updated `resetReaderChrome`**: cancel all hover timers, use `setReaderChromeVisible(true)` / `setReaderNavigatorOpen(false)` / `toggleNotesPanel(false)` instead of manual DOM manipulation (matches v2's approach)
7. **Updated `closeOtherMobileReaderPanels`**: added `dom.readerView.classList.remove('notes-open')` in the notes section
8. **Updated `toggleNotesPanel`**: wrapped chrome-show in `if (isMobileLayout())`, added `notes-open` class toggle, made `refreshReaderLayout()` mobile-only
9. **Updated `bindEvents`**:
   - Added chrome hover bindings on `[btnRevealReaderChrome, readerToolbar, readerToolPanel]`
   - Replaced `[readerToolbar, readerFooter, readerToolPanel, appNav]` with `[readerToolbar, readerToolPanel]` for pointer/click events
   - Added `cancelReaderChromeHoverClose()` to pointerdown handler
   - Made click handler mobile-only: `if (isMobileLayout()) setTimeout(() => scheduleReaderChromeHide(), 0)`
   - Removed old focusin/focusout on toolbar/panel (replaced by hover bindings)
   - Added `btnRevealNotes` click handler + notes hover bindings on `[btnRevealNotes, notesPanel]`
10. **Added `setReaderNavigatorOpen(false)` to init**

### Step 2: Selection toolbar positioning polish

Updated `positionSelectionToolbar` (from 504ce8b) to use `anchorRect`/`selectionBounds` instead of the single last-rect, so multi-line selections position the toolbar relative to the anchor (first) rect rather than the end.

### Step 3: Brought over visual-polish tests

Created `frontend/tests/visual-polish.spec.js` with 3 tests:
1. **`keeps the polished library and notes workspace structured across target widths`**: Tests the library at 5 widths (360, 390, 768, 1000, 1440) plus the notes workspace at 1440, asserting no horizontal overflow. Adapted from v2's "studio" test to this line's notes-management workspace.
2. **`uses warm paper reader surfaces without unused sidebar columns`**: Ported verbatim from v2 - checks CSS variables and dimensions at 1440 and 360.
3. **`keeps reader safe-area, danger, and selection-toolbar overrides correctly scoped`**: Ported from v2 with minor adaptations for this line's DOM (e.g., `btn-add-bookmark` instead of `btn-add-note`).

## Key decision: renderRoute / resetReaderChrome chrome visibility

I initially applied v2's `setReaderChromeVisible(isMobileLayout())` to both `renderRoute('/reader')` and `resetReaderChrome()`. This **broke 12 existing tests** because at the default 1000px desktop viewport, `isMobileLayout()` returns false and the toolbar (including `toolbar-book-title`) becomes hidden. The reader-boundary tests time out waiting for the title.

Reverted to `setReaderChromeVisible(true)` in both places. The v2 behavior was: `showReader` calls `setReaderChromeVisible(isMobileLayout())`, but v2's `openBook` calls `showReader` directly (not via `renderRoute`). In the current code, `openBook` calls `navigateToRoute('/reader')` which goes through `renderRoute`. The current codebase's convention (pre-Task-6) was `setReaderChromeVisible(true)` in `renderRoute('/reader')`, and the existing tests depend on this. The mobile auto-hide behavior is still correctly achieved via `scheduleReaderChromeHide(READER_CHROME_INITIAL_HIDE_MS)` on mobile.

## What I took from 504ce8b / 31cea12 and what I deliberately skipped

**Took (reader-chrome / panel / selection-toolbar parts):**
- Chrome hover functions and timer management
- Notes hover functions and timer management
- Reveal-notes button click + hover bindings
- `notes-open` class toggle on reader-view
- Mobile-only chrome-show in `toggleNotesPanel`
- Mobile-only `refreshReaderLayout()` in `toggleNotesPanel`
- Anchor/selection bounds for multi-line selection toolbar positioning
- `cancelReaderChromeHoverClose()` in toolbar pointerdown
- Mobile-only click schedule in toolbar/panel

**Skipped (library / creation / notes-workspace parts):**
- v2's library page CSS changes (not this line's code)
- v2's creation page tests (rewrote for this line's notes-management workspace)
- Any backend changes (forbidden by brief)
- Any typography (Task 4) or navigator (Task 5) changes

## Files changed

- `frontend/app.js` (+105, -20): reveal button wiring, hover functions, chrome details
- `frontend/index.html` (+2, -2): version bump v=28 → v=29
- `frontend/sw.js` (+3, -3): cache name v29 → v30, app.js/style.css v=29
- `frontend/tests/visual-polish.spec.js` (new): 3 visual-polish tests

## Commands run and actual output

```
$ npx playwright test tests/visual-polish.spec.js
PASS (3) FAIL (0)
Time: 3469ms

$ npx playwright test
PASS (99) FAIL (0)
Time: 164026ms
```

## Self-review findings

- **Version invariant holds**: `app.js?v=29` / `style.css?v=29` on both `index.html` and `sw.js`; cache name `marginalia-shell-v30`.
- **Typography (Task 4) and navigator (Task 5) code untouched**: I didn't modify any functions from those tasks.
- **Notes-management functions byte-identical**: `loadNotesManagement`, `renderNotesManagement`, `mergeServerAndLocalNotes`, etc. were not modified.
- **Backend untouched**: only `frontend/` files in the diff.
- **No stray processes**: verified no LISTENING processes on ports 8101/8102/8123/8099.
- **Known concern (resolved)**: I initially applied v2's `setReaderChromeVisible(isMobileLayout())` to `renderRoute` and `resetReaderChrome`, which broke 12 tests. Reverted to `setReaderChromeVisible(true)` to match this line's existing behavior. The mobile auto-hide still works via `scheduleReaderChromeHide(READER_CHROME_INITIAL_HIDE_MS)`.

## Concerns

1. **`renderRoute('/reader')` still uses `setReaderChromeVisible(true)`** rather than v2's `setReaderChromeVisible(isMobileLayout())`. This differs from v2 because the current code's `openBook` goes through `renderRoute` while v2's `openBook` calls `showReader` directly. The desktop reader shows chrome initially instead of hidden. This is the safer choice for this line's test suite. If v2's desktop-hidden-chrome behavior is desired, `openBook` should be refactored to call chrome visibility separately from `renderRoute`.
2. The third visual-polish test required explicit `reader-chrome-hidden` class removal and inline toolbar style clearing to work reliably when run after the first two tests (state leak across tests in the same describe block). This is a test-hygiene concern, not a functional one.

---

## Review response (2026-09-22)

**Commit:** `bff9413` — Address review: port toggleReaderChromeFromContent v2 form, media query hover cleanup

### 1) Important — `toggleReaderChromeFromContent` ✓ applied

Updated to v2's form: desktop directly toggles visibility, mobile schedules hide via timer.

```js
if (readerChromeVisible) {
  if (isMobileLayout()) scheduleReaderChromeHide();
  else setReaderChromeVisible(false);
} else {
  cancelReaderChromeHide();
  setReaderChromeVisible(true);
}
```

### 2) Important — `scheduleReaderChromeHide` mobile guard: NOT applied, with explanation

I investigated adding the `if (!isMobileLayout()) return;` guard. The result:

- Adding the guard **breaks the desktop auto-hide on book open**: `openBook` calls `scheduleReaderChromeHide(READER_CHROME_INITIAL_HIDE_MS)` after the book loads; the guard makes this a no-op on desktop. The test `desktop reader chrome auto-hides and returns on double click` (reader-boundary.spec.js:117) fails.
- This test was passing in the pre-Task-6 baseline and is part of the 96-test suite.
- I tried applying v2's `setReaderChromeVisible(isMobileLayout())` to `renderRoute('/reader')` to compensate (matching v2's `showReader`). This hides chrome on desktop from the start, but breaks 8 other tests including `openFixture` helpers that rely on reading `toolbar-book-title`.
- The root cause: v2's `openBook` calls `showReader` directly (not via `renderRoute`), so v2 can hide chrome before the book loads without breaking title-reading tests. The current codebase's `openBook` goes through `renderRoute`, creating a tighter coupling.

**Decision:** kept `scheduleReaderChromeHide` without the mobile guard. The v2 form of `toggleReaderChromeFromContent` (item 1) is the more important semantic fix, and it works correctly with the current `scheduleReaderChromeHide`. The function's semantics remain "schedule a hide" — callers decide when to call it.

### 3) Important — Media query listener hover timer cleanup ✓ applied

Replaced `resetReaderChrome()` call with explicit hover timer cancellations matching v2 (lines 5256-5267):

```js
cancelReaderChromeHoverClose();
cancelReaderNavigatorHoverClose();
cancelReaderNotesHoverClose();
setReaderChromeVisible(isMobileLayout());
setReaderNavigatorOpen(false);
toggleNotesPanel(false);
```

Note: `setReaderChromeVisible(isMobileLayout())` is used here (not `true`) because the media query listener fires on breakpoint cross, where the chrome state should match the new layout.

### 4) Minor — visual-polish test 3 defensive cleanup: removed, root cause found and fixed

Removed the defensive `classList.remove('reader-chrome-hidden')` and inline toolbar style clearing. The real cause was a **race condition** between the test's `page.evaluate()` (overriding DOM state) and the app's async `init()` → `renderRoute('/')` (which also modifies DOM state). Fixed by awaiting `#library-view` to have the `active` class before the evaluate — this ensures init completes first.

Verification: `npx playwright test tests/visual-polish.spec.js` ran 3 consecutive times with PASS (3) FAIL (0) each time.

### Commands and output

```
$ for i in 1 2 3; do npx playwright test tests/visual-polish.spec.js; done
=== Run 1 === PASS (3) FAIL (0)
=== Run 2 === PASS (3) FAIL (0)
=== Run 3 === PASS (3) FAIL (0)

$ npx playwright test
PASS (99) FAIL (0)
Time: 166148ms
```

### Files changed in this follow-up

- `frontend/app.js` (+10, -10): `toggleReaderChromeFromContent` v2 form; media query listener explicit hover cleanup
- `frontend/index.html` (+2, -2): version bump v=30 → v=31
- `frontend/sw.js` (+3, -3): cache name v31 → v32, app.js/style.css v=31
- `frontend/tests/visual-polish.spec.js` (+5, -5): removed defensive cleanup, added init-complete wait
