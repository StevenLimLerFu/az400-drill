# FUNCTIONS.md: AZ-400 Exam Drill

The source of truth for how the app behaves. Covers `app.js` (all functions sit inside one IIFE, and nothing is exported to `window`) and `sw.js` (service worker event handlers).
`questions.js` holds only data (`window.BUILTIN_QUESTIONS`) and has no functions.

## Module constants and state (`app.js`)

| Name | Value / meaning |
| --- | --- |
| `STORE_KEY` | `az400-drill-v1`: localStorage key for progress `{missed, answered, correct, useCustom}` |
| `BANK_KEY` | `az400-drill-bank-v1`: localStorage key for the imported question bank (normalized array) |
| `LETTERS` | `ABCDEFGHIJKL`: option letters; also caps options at 12 per question |
| `TARGET` | `70`: pass target, in percent, on the results screen |
| `MAX_FILE_BYTES` | 5 MB import limit |
| `MAX_QUESTIONS` | 5,000 questions per import |
| `MS_ASSESSMENT_URL` | Microsoft Learn's free AZ-400 practice assessment (`assessmentId=56`) |
| `MS_ASSESSMENT_LIST_URL` | Microsoft Learn's list of all practice assessments |
| `BUILTIN` | `window.BUILTIN_QUESTIONS` after `normalize(…, 'builtin')`; `[]` if invalid (logged to console) |
| `S` | Single app state object: `screen` (`home`\|`quiz`\|`result`), `mode` (`practice`\|`exam`), `domain`, `custom`, `useCustom`, `fileMsg`, `fileErr`, `session` (array of questions), `i` (current index), `picks` (`{id: number[]}`), `checked` (`{id: true}`), `review`, `missed` (ids), `answered`, `correct` |
| `installEvent` | Deferred `beforeinstallprompt` event, or `null` |
| `scrollToExplanation` | One-shot flag: after the next render, scroll the inline explanation into view |

Normalized question shape: `{ id, domain, q, code, options: string[], answer: number[], why, shuffleOptions: boolean }`.

---

## Storage

### `readJSON(key)`
- **Purpose:** Read a saved value from device storage.
- **Inputs / Outputs:** `key` string → parsed value, or `null`.
- **Behavior:** `localStorage.getItem`, then `JSON.parse`. Returns `null` for a missing key.
- **Side effects:** None.
- **Dependencies:** `window.localStorage`.
- **Error handling:** Blocked storage or invalid JSON returns `null`. Never throws.
- **Business rules:** A corrupt value is treated the same as "no saved data".

### `writeJSON(key, value)`
- **Purpose:** Save a value to device storage.
- **Inputs / Outputs:** `key`, any JSON-serializable `value` → `true` if saved, `false` if not.
- **Behavior:** `JSON.stringify`, then `localStorage.setItem`.
- **Side effects:** Writes to localStorage.
- **Dependencies:** `window.localStorage`.
- **Error handling:** A full quota or blocked storage returns `false`. Never throws.
- **Business rules:** Callers decide whether a failed save needs to be reported. Only `onFile` reports it.

### `removeKey(key)`
- **Purpose:** Delete a saved value.
- **Inputs / Outputs:** `key` → nothing.
- **Behavior:** `localStorage.removeItem`.
- **Side effects:** Removes the key from localStorage.
- **Dependencies:** `window.localStorage`.
- **Error handling:** Blocked storage errors are swallowed, since there is nothing to remove.
- **Business rules:** None.

## Pure helpers

### `toCount(n)`
- **Purpose:** Make a saved counter safe to use.
- **Inputs / Outputs:** any value → a non-negative integer.
- **Behavior:** `Number(n)`, then floored; anything that isn't finite or positive becomes `0`.
- **Side effects / Dependencies:** None.
- **Error handling:** Tampered or missing values become `0`.
- **Business rules:** When the app loads, `correct` is also capped at `answered`.

### `hash(s)`
- **Purpose:** Give imported questions stable ids.
- **Inputs / Outputs:** string → base-36 string (djb2, 32-bit unsigned).
- **Behavior:** Iterates over the character codes.
- **Side effects / Dependencies / Error handling:** None.
- **Business rules:** The same question text and options always get the same id, so the missed list survives re-importing the file.

### `shuffle(a)`
- **Purpose:** Randomize the question order for each session.
- **Inputs / Outputs:** array → a new shuffled array (the input is not changed).
- **Behavior:** Fisher–Yates shuffle using `Math.random`.
- **Side effects / Dependencies / Error handling:** None.
- **Business rules:** Also used by `withShuffledOptions` to reorder built-in options.

### `withShuffledOptions(q)`
- **Purpose:** Stop you learning answers by their position (A, B, C, D) instead of their content.
- **Inputs / Outputs:** a normalized question → the same question if `shuffleOptions` is false; otherwise a copy with options in random order and `answer` remapped to the new indexes.
- **Behavior:** Shuffles the index list `[0…n-1]`, builds the options from it, and maps each answer index to its new position.
- **Side effects:** None; the bank entry is not changed.
- **Dependencies:** `shuffle`.
- **Error handling:** None needed; the input has already been checked by `normalize`.
- **Business rules:** Only built-in questions are shuffled. Imported files keep their authored order, since they may contain options such as "All of the above" or refer to letters. The id is unchanged, so the missed list still works.

### `sameSet(a, b)`
- **Purpose:** Grade an answer.
- **Inputs / Outputs:** `a` (picks, may be undefined) and `b` (answer indexes) → boolean.
- **Behavior:** Same length, and equal after sorting.
- **Side effects / Dependencies / Error handling:** Undefined `a` returns `false`.
- **Business rules:** Multi-answer questions have no partial credit; unanswered counts as wrong.

### `uniqueDomains(list)`
- **Purpose:** List domains for the filter chips and the results breakdown.
- **Inputs / Outputs:** questions → domain strings, in the order they first appear.
- **Side effects / Dependencies / Error handling:** None.
- **Business rules:** None.

### `normalize(raw, source)`
- **Purpose:** Check that question data is valid and convert it to the internal shape.
- **Inputs / Outputs:** `raw` (parsed JSON), `source` (`'builtin'` or `'file'`) → normalized question array.
- **Behavior:** Requires an array with 1–5,000 items. For each item, reads `question` (or `q`), `options`, `answer` (a number or an array), `explanation` (or `why`), `domain` and `code`. Removes duplicate answer indexes and converts options to strings. The id is the author's `id` for built-ins; otherwise `c:` + `hash(text + options)`. A duplicate id gets `:<index>` appended.
- **Side effects / Dependencies:** `hash`, `LETTERS`, `MAX_QUESTIONS`.
- **Error handling:** Throws an `Error` with a message the user can read that names the question number: not an array, empty, too many, missing text, not 2–12 options, missing answer, or an answer index that isn't a whole number or is out of range.
- **Business rules:** Answer indexes start at 0. A missing domain becomes `Imported`. A missing explanation becomes `''` (the UI shows a fallback). `shuffleOptions` is `true` only when `source` is `'builtin'`.

## State and actions

### `getBank()`
- **Purpose:** Choose the active question bank.
- **Outputs:** `S.custom` if `S.useCustom` is set and a file is loaded; otherwise `BUILTIN`.
- **Side effects / Dependencies / Error handling:** None.
- **Business rules:** Only one bank is active at a time.

### `persist()`
- **Purpose:** Save progress.
- **Behavior:** `writeJSON(STORE_KEY, {missed, answered, correct, useCustom})`.
- **Side effects:** localStorage write.
- **Error handling:** A failed save is ignored silently; the app keeps working in memory.
- **Business rules:** Session answers are never saved; only finished-set totals and the missed list are.

### `setState(patch, opts)`
- **Purpose:** Update state and redraw.
- **Inputs:** `patch` object; `opts.top` (boolean) scrolls to the top.
- **Behavior:** `Object.assign(S, patch)`, then `render(opts.top)`.
- **Side effects:** DOM re-render.
- **Dependencies:** `render`.

### `startSession(list)`
- **Purpose:** Begin a set.
- **Inputs:** list of questions.
- **Behavior:** Does nothing if the list is empty. Otherwise switches to the quiz screen with a shuffled copy (each question passed through `withShuffledOptions`), `i = 0`, and cleared picks, checks and review flag. Option order stays fixed for the rest of the set, including review.
- **Business rules:** Used for Start (the domain pool), Review missed (the bank's missed ids) and Retry missed (this set's wrong answers).

### `pick(k)`
- **Purpose:** Select an option on the current question.
- **Inputs:** option index `k`.
- **Behavior:** Ignored when `k` is out of range, in review, or when a practice question has already been checked. A single-answer question replaces the pick. A multi-answer question toggles `k`; when the required number is already picked, the oldest pick is dropped first.
- **Side effects:** Updates `S.picks` and re-renders.
- **Business rules:** You can never pick more than the required number of answers.

### `check()`
- **Purpose:** Reveal the result in practice mode.
- **Behavior:** Needs at least one pick. Marks the question checked and sets `scrollToExplanation`.
- **Side effects:** Re-renders; the phone layout scrolls the explanation into view.
- **Business rules:** A checked answer is locked.

### `go(n)`
- **Purpose:** Move to question `n`.
- **Behavior:** Ignores `n` if it is out of range or already current; otherwise sets `S.i` and scrolls to the top.

### `finish()`
- **Purpose:** Score the set.
- **Behavior:** For each session question, removes a correct answer from `missed` and adds a wrong or unanswered one. Adds the set size to `answered` and the correct count to `correct`, then calls `persist()` and shows results.
- **Side effects:** localStorage write, re-render.
- **Business rules:** Unanswered questions count as wrong. The lifetime counters add up across sets.

### `leaveToHome()`
- **Purpose:** Go back to the start screen.
- **Behavior:** If a set with picks is in progress (quiz, not review), asks with `window.confirm` first; a cancel keeps you in place.
- **Business rules:** A set you leave is not scored.

### `resetStats()`
- **Purpose:** Clear progress on this device.
- **Behavior:** Asks with `confirm`, then sets `missed = []`, `answered = 0`, `correct = 0`, and calls `persist()` and `render()`.
- **Business rules:** Does not remove an imported question file.

### `onFile(e)`
- **Purpose:** Import a question file.
- **Inputs:** `change` event from the file input.
- **Behavior:** Takes the first file and clears the input so the same file can be chosen again. Rejects files over 5 MB. Otherwise reads the text, then `JSON.parse`, then `normalize(…, 'file')`. Saves the result to `BANK_KEY`, switches to the custom bank, resets the domain to `All`, and shows "Loaded N questions…".
- **Side effects:** localStorage write, re-render.
- **Dependencies:** `File.text()`, `normalize`, `writeJSON`, `persist`.
- **Error handling:** Invalid JSON shows "That file is not valid JSON."; a validation error shows its own message; other failures show "Could not read that file." A failed save still loads the questions for this visit and says they were not saved.
- **Business rules:** File content is only ever displayed with `textContent`, never parsed as HTML.

### `removeCustom()`
- **Purpose:** Remove the imported bank.
- **Behavior:** Asks with `confirm`, then removes `BANK_KEY`, switches back to the built-in bank and shows a message.
- **Business rules:** Missed ids from the removed file stay stored. They're harmless and come back into use if you import the same file again.

### `promptInstall()`
- **Purpose:** Show the browser's install dialog (Chrome and Edge on Android, Mac and Windows).
- **Behavior:** Uses and then clears `installEvent`, calls `prompt()`, and re-renders once the user responds.
- **Error handling:** Does nothing if there's no deferred event.

### `primaryAction(q, picks)`
- **Purpose:** Decide the label and action of the main button, shared by the UI and the Enter key.
- **Outputs:** `{label, run, disabled?}`.
- **Business rules:**
  - Review: `Next`, or `Back to results` on the last question.
  - Practice: `Check answer` (disabled with no pick), then `Next question`, or `See results` on the last question.
  - Exam: `Next`, or `Finish exam` on the last question.

## Rendering

### `append(el, kids)` / `h(tag, attrs, kids)`
- **Purpose:** Build DOM without using `innerHTML`.
- **Behavior:** `h` creates an element. `class`, `text` (textContent), `on<event>` (listener) and other attributes are applied, and `null`/`false` values are skipped. `append` flattens nested arrays and turns strings and numbers into text nodes.
- **Business rules:** All user and file text goes into text nodes, so a question file can't inject HTML or scripts.

### `icon(name, size, label)`
- **Purpose:** Inline stroke SVG icons (`back`, `check`, `cross`, `upload`, `install`).
- **Behavior:** Adds `aria-label` and `role=img` when `label` is given; otherwise the icon is `aria-hidden`.

### `isStandalone()` / `isAppleSafari()`
- **Purpose:** Decide which install help to show.
- **Behavior:** `isStandalone` checks for the `display-mode: standalone` media query or `navigator.standalone`. `isAppleSafari` checks the user-agent for Safari on Mac/iOS, excluding Chrome, Edge and Firefox variants.
- **Business rules:** Nothing about installing is shown once the app is installed.

### `eyebrow(text)` / `group(label, body)`
- **Purpose:** Small label and section wrappers used on every screen.

### `renderHome()`
- **Purpose:** The start screen.
- **Behavior:**
  - Stats: answered count, accuracy (`—` before any answers), and missed questions in the active bank.
  - Bank chips (only when a file is loaded), domain chips with counts, and the mode cards.
  - Official practice: a card linking to `MS_ASSESSMENT_URL`, and a smaller link to `MS_ASSESSMENT_LIST_URL`. Both open in a new browser window (`target=_blank`, `rel=noopener noreferrer`). Nothing from Microsoft Learn is fetched or stored by the app.
  - File import (input, message, format note, sample download link), plus Reset progress and Remove question file.
  - Install button (when there's a deferred prompt) or Safari instructions.
  - Start N questions (disabled when there are 0) and Review missed (disabled when there are 0).
- **Business rules:** If the saved domain doesn't exist in the active bank, `All` is used.

### `explanation(q, picks, variant)`
- **Purpose:** The answer verdict and explanation.
- **Behavior:** Shows Correct, Incorrect or Not answered, the correct letters (sorted A→L), and the explanation (with a fallback when there is none). The `'inline'` variant (phone, `#explanation`) is compact; the `'aside'` variant (tablet side panel) is larger.

### `renderQuiz()`
- **Purpose:** The question screen.
- **Behavior:** Sticky header (Home, counter, mode pill, progress bar); nav grid and legend (tablet only); question, code block, "Choose N." and options; the inline explanation when answers are shown; a sticky footer with Previous and the main action; the explanation panel (tablet only).
- **Business rules:** Answers are shown in review, or in practice once checked. Exam mode shows nothing until review. The correct answer is marked with a check and colour; a wrong pick is marked with a cross and colour. On tablet, nav colours only show right or wrong for questions whose answers are shown.

### `renderResult()`
- **Purpose:** The results screen.
- **Behavior:** Percentage (rounded), a pill that compares it with `TARGET`, the correct count, a bar for each domain (accent colour at or above target, amber below), Retry missed (disabled when there are none), Review answers, Home, and a list of every question that opens it in review.

### `render(toTop)`
- **Purpose:** Redraw the whole view from `S`.
- **Behavior:** Remembers which element had focus (`data-k`) and the scroll positions of `[data-scroll]` containers. Picks the screen, falling back to home when the quiz or result screen has no session data. Replaces the content of `#app` and sets `document.title`. It then restores scroll (or scrolls to the top) and focus, and scrolls to the explanation once when `scrollToExplanation` is set.
- **Business rules:** Focus is not restored to a disabled element.

## Input and platform

### `onKeydown(e)`
- **Purpose:** Keyboard use on Mac and on tablets with a keyboard.
- **Behavior:** Only on the quiz screen, with no Alt, Ctrl or Meta held, and not while typing in a field. `1`–`9` and `A`–`L` pick an option (if it exists); ←/→ move; Enter runs `primaryAction` unless focus is on a button, in which case the button handles it.

### `registerServiceWorker()`
- **Purpose:** Turn on offline use.
- **Behavior:** Registers `./sw.js` after `load`, only on HTTPS or localhost.
- **Error handling:** A failure is logged with `console.warn`; the app still works online.

### Window listeners
- `beforeinstallprompt`: stops the browser's own prompt, stores the event, and re-renders home to show the Install button.
- `appinstalled`: clears the event and re-renders home.

---

## `sw.js`

| Name | Meaning |
| --- | --- |
| `CACHE_VERSION` | Bump it on every release; it names `SHELL_CACHE` |
| `SHELL` | App files precached at install time |
| `FONT_CACHE` / `FONT_HOSTS` | Runtime cache for Google Fonts |

### `install` handler
- **Behavior:** Opens `SHELL_CACHE`, runs `addAll(SHELL)`, then `skipWaiting()`.
- **Error handling:** If any shell file fails to download, the install fails and the previous worker stays in charge (this is how service workers are designed).

### `activate` handler
- **Behavior:** Deletes caches named `az400-drill-*` other than the current shell and font caches, then `clients.claim()`.
- **Business rules:** Never touches caches that belong to other apps on the same origin.

### `fetch` handler
- **Behavior:**
  - Skips anything that isn't a GET.
  - Google Fonts: cache first, saving successful or opaque responses.
  - Other origins: not handled.
  - Navigations: network first, falling back to the cached `./index.html`.
  - Same-origin files: served from cache while the cache is refreshed in the background (`ok` responses only).
- **Error handling:** If a network refresh fails, the cached copy is used. With nothing cached and no network, the browser shows its normal network error.
- **Business rules:** Updates reach installed apps one launch late unless `CACHE_VERSION` is bumped, which forces a fresh precache.
