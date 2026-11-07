# AI Agent System Instructions

## Project Maintenance Rules

When interacting with this repository, strictly adhere to the following rules regarding commits, releases and documentation:

1. **Commits (Conventional Commits, enforced)**:
   - Every commit message **MUST** follow [Conventional Commits](https://www.conventionalcommits.org): `<type>(<optional scope>): <subject>`, e.g. `feat(llm): add Mistral provider`, `fix(orchestrator): respect budget on retry`.
   - Allowed types: `feat`, `fix`, `perf`, `refactor`, `docs`, `style`, `test`, `build`, `ci`, `chore`, `revert`. Use the package or app name as the scope when a change is confined to one (`llm`, `git`, `web`, `api`, `orchestrator`, `project-index`, …).
   - Write the subject for users and operators: commit messages become the release notes. `fix(review): keep the report when one specialist fails` beats `fix: handle error`.
   - Rules come from `commitlint.config.js` (`@commitlint/config-conventional`): lowercase type, non-empty subject, no trailing period, header ≤ 100 characters.
   - Enforced locally by the husky `commit-msg` hook (installed automatically by `npm install`) and in CI by `.github/workflows/commitlint.yml`, which lints every commit in a PR **and the PR title** (squash merges use the title as the commit message).
   - Never bypass the hook with `--no-verify`.
   - Branch names follow `<type>/<short-name>`, e.g. `feat/github-publisher`, `fix/budget-guard`, `docs/landing-page`.

2. **Releasing (automated, never manual)**:
   - Releases are fully automated by semantic-release (`.github/workflows/release.yml`) on every push to `main`. After `npm run lint` and `npm test` pass, it computes the next version from the commits since the last tag, tags `vX.Y.Z`, and publishes a GitHub Release with notes generated from the commits. Nothing is committed back to `main` (it is PR-protected), so the `version` in `/package.json` stays stale on purpose; the tag is the source of truth and CI stamps it into the desktop build.
   - Version impact: `fix:` / `perf:` → patch, `feat:` → minor, `!` after the type (`feat!:`) or a `BREAKING CHANGE:` footer → major. All other types produce no release.
   - **Do NOT** bump versions, edit `/CHANGELOG.md`, or create/delete `v*` tags by hand. `/CHANGELOG.md` is frozen history (hand-written entries); newer release notes live in GitHub Releases. Do not delete the `v0.3.2` baseline tag; it anchors version history.
   - A bad release is fixed forward with a new `fix:` commit, never by rewriting tags or history.
   - The landing page and README link to GitHub Releases for the current version; no manual version edits are needed in `/docs/index.html` or `/README.md`.

3. **Documentation Sync (Bilingual)**:
   - If your changes introduce new features (e.g., adding a new AI provider, changing the UI workflow, etc.), you **MUST** update both `/README.md` and `/docs/index.html` to reflect these changes.
   - Both `/README.md` and `/docs/index.html` are strictly bilingual (**English** and **Persian/Farsi**). You must explain the feature in both languages when updating them.
   - Write the Persian in a simple, conversational tone (short sentences, everyday words), not formal or literal translations of the English.

4. **GitHub Pages (`/docs/index.html`)**:
   - The `/docs/index.html` file acts as the standalone presentation/landing page for GitHub Pages.
   - Keep it visually polished (using Tailwind via CDN) and ensure the English section uses `dir="ltr"` and the Persian section uses `dir="rtl"`.
