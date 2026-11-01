# AI Agent System Instructions

## Project Maintenance Rules

When interacting with this repository, strictly adhere to the following rules regarding documentation and versioning:

1. **Version Bumping**:
   - Whenever you implement a functional change, new feature, or fix a bug in the codebase, you **MUST** increment the version number.
   - The primary version number is tracked in `/package.json` (root).
   - Also, update the display version in `/docs/index.html` (the `<span id="app-version">` tag) and in `/README.md` if applicable.

2. **Documentation Sync (Bilingual)**:
   - If your changes introduce new features (e.g., adding a new AI provider, changing the UI workflow, etc.), you **MUST** update both `/README.md` and `/docs/index.html` to reflect these changes.
   - Both `/README.md` and `/docs/index.html` are strictly bilingual (**English** and **Persian/Farsi**). You must explain the feature in both languages when updating them.

3. **GitHub Pages (`/docs/index.html`)**:
   - The `/docs/index.html` file acts as the standalone presentation/landing page for GitHub Pages.
   - Keep it visually polished (using Tailwind via CDN) and ensure the English section uses `dir="ltr"` and the Persian section uses `dir="rtl"`.

4. **Release Notes (`/CHANGELOG.md`)**:
   - Every time you bump the version (rule 1), you **MUST** add a matching entry at the top of `/CHANGELOG.md`, under the template comment: `## [x.y.z] - YYYY-MM-DD`, grouped under `### Added | Changed | Fixed | Security`.
   - Each bullet is bilingual: one `- **EN:** ...` line and one `- **FA:** ...` line. Write what changed for users/operators (behavior, endpoints, commands), not internal refactors.
   - Mirror the newest entries in the **Release Notes** section of `/docs/index.html` (`id="release-notes"`, English `dir="ltr"` + Persian `dir="rtl"`; keep the latest ~6 versions there).
   - Before finishing, run `npm run changelog:check`; it must pass.
