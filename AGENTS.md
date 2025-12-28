# Repository Guidelines

## Project Structure & Module Organization
This is a static site. Core files live in the repo root:
- `index.html` for markup and layout.
- `styles.css` for styling.
- `app.js` for client-side behavior and data loading.
- `spatis.json` for stop data used by the app.
Assets are stored in `photos/` and icons/PWA files live in `icons/` plus `manifest.webmanifest`.

## Build, Test, and Development Commands
There is no build step. Serve the root directory with any static server:
- `python3 -m http.server 8080` — run a local server on port 8080.
- `open http://localhost:8080` — open the site in a browser.

## Coding Style & Naming Conventions
- Indentation: 2 spaces in `app.js` and `styles.css`.
- JavaScript: use `camelCase` for variables/functions; constants use `UPPER_SNAKE_CASE`.
- Keep DOM queries centralized and prefer small helper functions (see `save()` and `setTab()` patterns in `app.js`).
- CSS: group related rules and keep selectors specific to page sections (e.g., `.bottomNav`, `.tabPane`).

## Testing Guidelines
No automated tests are present. Validate changes manually:
- Load the page locally.
- Click through navigation tabs.
- Verify map, feed, and media upload flows still render correctly.

## Commit & Pull Request Guidelines
Recent commit history uses short, direct messages like `Update app.js` or `Update styles.css`. Follow this pattern unless a more descriptive message is needed.
Commit most changes as you go to reduce the risk of losing work.
After your normal commits, run `scripts/update-commit-ref.sh` to update the footer hash, commit it, and push.
For PRs, include:
- A concise summary of changes.
- Screenshots or a short screen recording for UI changes.
- Any relevant data or config changes called out explicitly.

## Configuration & Security Notes
The site uses a Supabase client in `app.js`. Treat keys as public and do not add any private secrets to the repo. If endpoints or storage buckets change, update both the constants and any dependent UI messaging.
