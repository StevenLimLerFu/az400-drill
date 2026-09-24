# AZ-400 Exam Drill

An installable, offline-capable practice app for the AZ-400 (Microsoft DevOps Engineer Expert) exam.
Plain HTML, CSS and JavaScript: no build step, no dependencies, no server code.

- Phone layout under 900 px wide; tablet and desktop layout (question list, question, explanation side by side) from 1000 px.
- Practice mode (explanation after each answer) and Exam mode (score at the end).
- Missed questions, answered count and accuracy are saved on the device (localStorage).
- Load your own question file (JSON). It is saved on the device until you remove it.
- Light and dark themes follow the system setting. Keyboard shortcuts on Mac: 1–9 or A–L to choose, Enter to check or continue, arrow keys to move.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | App page |
| `styles.css` | All styling, light and dark |
| `app.js` | App logic and rendering (see `FUNCTIONS.md`) |
| `questions.js` | 17 built-in questions (original content) |
| `sw.js` | Service worker: offline cache |
| `manifest.webmanifest` | Install metadata (name, icons, colours) |
| `sample-questions.json` | Example of the import format |
| `icons/` | App icons |

## Try it on this computer

```bash
npx --yes serve D:/AL/az400-drill -l 8400
```

Then open http://localhost:8400. Offline support works on `localhost` and on HTTPS only.

## Put it online (needed to install on your phone)

Android and Mac can install the app only from an HTTPS address. Any static host works. Three free options:

1. **Azure Static Web Apps** (a useful AZ-400 exercise): push this folder to a GitHub or Azure Repos repo, create a Static Web App in the Azure portal, set *App location* to `/` and leave *Output location* empty. The portal sets up the build pipeline for you.
2. **GitHub Pages**: push this folder to a repo, then turn on Settings → Pages → Deploy from branch → `main` / root.
3. **Netlify Drop**: drag the folder onto https://app.netlify.com/drop.

## Install

- **Android (Chrome):** open the address, then tap **Install app** on the home screen of the app, or menu ⋮ → **Install app** / **Add to Home screen**.
- **Mac (Chrome or Edge):** click the install icon at the right of the address bar, or use the app's **Install app** button.
- **Mac (Safari 17+):** File → **Add to Dock**.
- **iPhone / iPad (Safari):** Share → **Add to Home Screen**.

After the first visit the app works with no connection.

## Updating

Change the files, then bump `CACHE_VERSION` in `sw.js` (for example `'v2'`) and redeploy.
Installed copies pick up the new version the next time they open while online, and show it on the launch after that.

## Question file format

A JSON array. Each item:

```json
{
  "question": "Which keyword …?",
  "options": ["A text", "B text", "C text", "D text"],
  "answer": 1,
  "explanation": "Optional. Shown after answering.",
  "domain": "Optional. Used for the domain filter.",
  "code": "Optional. Shown as a code block."
}
```

- `answer` is a 0-based index, or a list such as `[0, 2]` for "choose two" questions.
- 2 to 12 options per question, up to 5,000 questions, file up to 5 MB.
- Only load questions you have the right to use. Exam "dump" content breaks the Microsoft exam agreement.
