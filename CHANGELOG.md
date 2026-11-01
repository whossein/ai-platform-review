# Changelog / تاریخچه تغییرات

All notable changes to the AI Code Review Platform. Newest first. Every entry is bilingual (**EN** / **FA**).
Rules for adding entries are in [AGENTS.md](AGENTS.md); `npm run changelog:check` verifies the current version is documented.

تمام تغییرات مهم پروژه، جدیدترین در بالا. هر ورودی دو‌زبانه است (**EN** / **FA**).

<!--
Entry template (copy to the top, below this comment):

## [x.y.z] - YYYY-MM-DD

### Added | Changed | Fixed | Security
- **EN:** ...
- **FA:** ...
-->

## [0.2.18] - 2026-11-01

### Added
- **EN:** Release notes system: this changelog is the single bilingual history, shown in the landing page's Release Notes section. `npm run changelog:check` fails when the current version has no entry (or lacks an EN/FA line) or when the docs version differs. `AGENTS.md` requires AI agents to update it with every feature or notable fix.
- **FA:** سیستم یادداشت‌های انتشار: این فایل تنها تاریخچه دو‌زبانه است و در بخش Release Notes صفحه معرفی هم نمایش داده می‌شود. دستور `npm run changelog:check` در نبود ورودی نسخه فعلی (یا نبود خط EN/FA) یا ناهماهنگی نسخه در docs خطا می‌دهد. فایل `AGENTS.md` ایجنت‌های AI را موظف می‌کند با هر فیچر یا اصلاح مهم آن را به‌روز کنند.

## [0.2.17] - 2026-11-01

### Security
- **EN:** The structural-index token override now uses only the token that belongs to the project's own Git host, so a GitLab token can no longer be sent to GitHub (and vice versa). `POST /api/test-git-connection` rejects loopback, link-local and cloud-metadata hosts (SSRF guard).
- **FA:** توکن مورد استفاده برای ایندکس حالا فقط توکنِ مربوط به host خود پروژه است؛ دیگر توکن GitLab به GitHub (و برعکس) ارسال نمی‌شود. مسیر `POST /api/test-git-connection` آدرس‌های loopback، link-local و metadata ابری را رد می‌کند (جلوگیری از SSRF).

### Changed
- **EN:** The head-SHA and default-branch caches used by auto-indexing are now size-capped (500 entries).
- **FA:** کش‌های SHA سرِ branch و branch پیش‌فرض که در ایندکس خودکار استفاده می‌شوند، حالا سقف ۵۰۰ ورودی دارند.

## [0.2.16] - 2026-11-01

### Added
- **EN:** Index history: every finished indexing job (succeeded, failed, cancelled) is kept per project (last 50) with branch, commit, files, symbols, reused files and duration. `GET /api/projects/:id/index/history`.
- **FA:** تاریخچه ایندکس: هر Job پایان‌یافته (موفق، ناموفق، لغوشده) برای هر پروژه (۵۰ مورد آخر) با branch، commit، فایل‌ها، سمبل‌ها، فایل‌های بازاستفاده‌شده و مدت‌زمان نگهداری می‌شود.

## [0.2.15] - 2026-11-01

### Added
- **EN:** The index refreshes when the target branch head moves (at most every 5 minutes; 24h fallback). Review context overlays the diff on the index: new, renamed and deleted files, newly added imports, unresolved relative imports, and untouched files that still import a deleted or moved file.
- **FA:** با جابه‌جا شدن سرِ branch مقصد، ایندکس دوباره ساخته می‌شود (حداکثر هر ۵ دقیقه). زمینه ریویو، دیف را روی ایندکس می‌نشاند: فایل‌های جدید، تغییرنام‌یافته و حذف‌شده، importهای تازه، importهای نسبیِ حل‌نشده و فایل‌های دست‌نخورده‌ای که هنوز فایل حذف/جابه‌جاشده را import می‌کنند.

## [0.2.14] - 2026-11-01

### Added
- **EN:** Per-branch index: each branch keeps its own index and reviews use the MR/PR target branch (falling back to the default branch, then the latest index). Auto-indexing uses the Git token from Settings.
- **FA:** ایندکس جداگانه برای هر branch: ریویو از ایندکس branch مقصد MR/PR استفاده می‌کند (در نبود آن branch پیش‌فرض و سپس آخرین ایندکس). ایندکس خودکار از توکن Git در تنظیمات استفاده می‌کند.

## [0.2.13] - 2026-11-01

### Added
- **EN:** Deep links: the URL tracks the tab, project and project sub-tab (`#/projects/<id>/index`) with back/forward support.
- **FA:** لینک مستقیم: آدرس صفحه تب، پروژه و زیرتب پروژه را دنبال می‌کند (`#/projects/<id>/index`) و back/forward کار می‌کند.

### Fixed
- **EN:** The Index tab uses the matching Git connection from Settings, fixing `404 Project Not Found` when no token is stored in Profile.
- **FA:** تب Index از اتصال Git مناسب در تنظیمات استفاده می‌کند؛ خطای `404 Project Not Found` هنگام نبودِ توکن در پروفایل برطرف شد.

## [0.2.12] - 2026-11-01

### Added
- **EN:** Multiple Git connections (name, base URL, token) in Settings, matched automatically by MR/PR host, plus a **Test Connection** button (`POST /api/test-git-connection`). Existing single tokens migrate automatically.
- **FA:** پشتیبانی از چند اتصال Git (نام، آدرس پایه، توکن) در تنظیمات که بر اساس host مربوط به MR/PR خودکار انتخاب می‌شود، به‌همراه دکمه **Test Connection**. توکن‌های قبلی خودکار منتقل می‌شوند.

## [0.2.11] - 2026-11-01

### Fixed
- **EN:** The Index tab no longer blanks the screen when the API returns a non-JSON page; a React error boundary isolates crashes to one view; `npm run dev` uses `tsx watch` so server changes restart automatically.
- **FA:** تب Index هنگام دریافت پاسخ غیر JSON دیگر صفحه را خالی نمی‌کند؛ Error Boundary از کرش کل برنامه جلوگیری می‌کند؛ `npm run dev` با `tsx watch` اجرا می‌شود.

## [0.2.10] - 2026-11-01

### Added
- **EN:** Branch picker for indexing: loads branches from GitHub/GitLab (`GET /api/projects/:id/index/branches`), pre-fills the default branch, still accepts any branch, tag or SHA.
- **FA:** انتخاب branch برای ایندکس: branchها از GitHub/GitLab خوانده می‌شوند، branch پیش‌فرض از قبل پر می‌شود و وارد کردن دستیِ هر branch، tag یا SHA همچنان ممکن است.

## [0.2.9] - 2026-11-01

### Added
- **EN:** Local password recovery CLI: `npm run reset-password` lists users, `npm run reset-password -- <email> <newPassword>` resets a password and signs the user out everywhere.
- **FA:** ابزار بازیابی رمز عبور محلی: `npm run reset-password` کاربران را فهرست می‌کند و با ایمیل و رمز جدید، رمز را بازنشانی و کاربر را از همه جا خارج می‌کند.

## [0.2.8] - 2026-11-01

### Added
- **EN:** Index-aware reviews: reviewers get each changed file's exports, imports and dependants, with dependants outside the change flagged. Background auto-indexing for unindexed or stale (>24h) projects. Real model pricing for budgets and cost metrics, cache hit/miss metrics, and `npm run e2e` smoke test.
- **FA:** ریویو آگاه از ایندکس: برای هر فایل تغییرکرده exportها، importها و وابسته‌ها به ایجنت‌ها داده می‌شود و وابسته‌های خارج از تغییر مشخص می‌شوند. ایندکس خودکار پس‌زمینه برای پروژه‌های ایندکس‌نشده یا قدیمی (بیش از ۲۴ ساعت). قیمت واقعی مدل‌ها برای بودجه و هزینه، و تست `npm run e2e`.

### Fixed
- **EN:** A `.../merge_requests/latest` URL that cannot be resolved now fails with a clear error instead of reviewing a fabricated diff.
- **FA:** آدرس `.../merge_requests/latest` که قابل تشخیص نباشد، به‌جای ریویوی دیف ساختگی، خطای واضح می‌دهد.

## [0.2.7] - 2026-11-01

### Fixed
- **EN:** Submitting a new MR/PR URL as a non-admin registers the project and makes that user its OWNER (previously 403 and an orphaned project). The Git token is chosen by repository host, so self-hosted GitLab domains work. "Most imported" no longer lists zero-importer files.
- **FA:** ثبت آدرس MR/PR جدید توسط کاربر غیرادمین، پروژه را ثبت می‌کند و او را OWNER می‌کند (قبلاً 403 می‌داد). توکن Git بر اساس host مخزن انتخاب می‌شود تا GitLab خودمیزبان کار کند. فایل‌های بدون importer دیگر در «پر‌ایمپورت‌ترین‌ها» نمی‌آیند.

## [0.2.6] - 2026-11-01

### Added
- **EN:** Project Index tab in the app and `GET/POST /api/projects/:id/index` (`DELETE .../index/job` cancels): live progress, language breakdown, workspace packages, most imported files.
- **FA:** تب Index در اپ و مسیرهای `GET/POST /api/projects/:id/index` (لغو با `DELETE .../index/job`): پیشرفت زنده، توزیع زبان‌ها، پکیج‌های workspace و پر‌ایمپورت‌ترین فایل‌ها.

## [0.2.5] - 2026-11-01

### Added
- **EN:** New SQL-injection and wildcard-CORS rules; `eval`/`debugger` rules registered in the default set.
- **FA:** قوانین جدید SQL Injection و CORS با wildcard؛ قوانین `eval` و `debugger` در مجموعه پیش‌فرض ثبت شدند.

### Fixed
- **EN:** Server honors `PORT` (fixes `npm run desktop`); the settings budget limit is sent to the backend as `AI_REVIEW_DOLLAR_BUDGET`.
- **FA:** سرور متغیر `PORT` را رعایت می‌کند (رفع `npm run desktop`)؛ سقف بودجه تنظیمات به‌صورت `AI_REVIEW_DOLLAR_BUDGET` به بک‌اند ارسال می‌شود.

## [0.2.4] - 2026-11-01

### Security
- **EN:** All project, review, estimate, publish, model-listing and apply-local endpoints require authentication; `apply-local` only edits inside the given repository root; `.data/` is no longer tracked by git.
- **FA:** همه مسیرهای پروژه، ریویو، برآورد، انتشار، لیست مدل و apply-local نیاز به احراز هویت دارند؛ `apply-local` فقط داخل ریشه مخزن ویرایش می‌کند؛ پوشه `.data/` دیگر در git نیست.

## [0.2.3] - 2026-11-01

### Added
- **EN:** Structural project index (`@ai-review/project-index`): GitLab/GitHub/local sources, TS/JS AST extraction, workspace and path-alias import graph, incremental reuse, atomic snapshots with retention.
- **FA:** ایندکس ساختاری پروژه (`@ai-review/project-index`): منابع GitLab/GitHub/محلی، استخراج AST برای TS/JS، گراف import با workspace و path alias، بازاستفاده افزایشی و snapshot اتمیک.

## [0.2.2] - 2026-11-01

### Added
- **EN:** Benchmark dataset and evaluation harness (`@ai-review/eval`, `npm run eval:mock`) with Hungarian matching and precision/recall/F1 metrics (offline tooling).
- **FA:** مجموعه داده و ابزار ارزیابی (`@ai-review/eval`، `npm run eval:mock`) با تطبیق مجارستانی و معیارهای precision/recall/F1 (ابزار آفلاین).

## [0.2.0] - 2026-11-01

### Added
- **EN:** User authentication and RBAC: PBKDF2 hashing, sessions, rate limiting, first-run admin setup, project roles, encrypted Git credentials and a security audit trail.
- **FA:** احراز هویت و کنترل دسترسی: هش PBKDF2، نشست‌ها، محدودیت نرخ، ساخت ادمین در اولین اجرا، نقش‌های پروژه، توکن‌های Git رمزنگاری‌شده و ردپای ممیزی امنیتی.

## Earlier / قبل‌تر

Project registry with custom AI instructions, persistent multi-scope memory, custom LLM providers (AvalAI and others), Docker scaffolding.
رجیستری پروژه با دستورالعمل سفارشی AI، حافظه چندسطحی ماندگار، پروایدرهای LLM سفارشی (از جمله AvalAI) و Docker.
