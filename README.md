# 🤖 AI Code Review Platform

**[English & Persian Documentation]**

The **AI Code Review Platform** is an agentic, scalable, and multi-provider code review application designed to automatically detect security vulnerabilities, performance regressions, logical bugs, architectural antipatterns, and style violations across Git diffs and codebases.

**🔗 [View Official Landing Page](https://whossein.github.io/ai-platform-review-gemini-2/)**

---

## 🌍 About the Project (English)

The **AI Code Review Platform** is a powerful, multi-agent automated code review system. It acts as an intelligent pair programmer, seamlessly integrating with your git workflow (GitLab, local diffs, etc.) to analyze code changes, detect bugs, and suggest improvements.

### ✨ Key Features

- 🤖 **13 Specialized Review Personas**: Focused agents tailored for React, TypeScript, Next.js, Angular, Vue, .NET/C#, Python, Android (Kotlin/Java), iOS (Swift), React Native, Security, Performance, and General Code Quality.
- ⚡ **Pre-LLM Deterministic Rule Engine**: Zero-cost regex and pattern analysis (run before any LLM call) that detects hardcoded secrets, string-built SQL (SQL injection), wildcard CORS, `eval`, `debugger`, `console` calls, `any` types, TODO comments and leftover `.only`/`.skip` tests.
- 🎯 **Smart Routing & Planner**: Evaluates diffs and changed file extensions to invoke only relevant specialists, minimizing latency and LLM token usage.
- 🔌 **Provider-Agnostic LLM Engine**: Native support for **Google Gemini, OpenAI, Anthropic, OpenRouter, Avalai, DeepSeek, Ollama (Local AI), Azure**, and custom OpenAI-compatible proxies.
- 📁 **Project Registry & Custom AI System Instructions**: First-class Project entities uniquely identified by `gitHost + repositoryPath`. Supports custom per-project AI System Instructions and architectural guidelines injected directly into model prompts during reviews.
- 🔐 **User Management, Authentication & RBAC (v0.2.0)**: Complete user lifecycle with secure PBKDF2 password hashing, session tokens, fixed-window rate limiting with temporary blocks, and first-run initial admin setup wizard.
- 🛡️ **Multi-Tier Authorization & Project Access**: System roles (`ADMIN`, `MEMBER`) and project-level roles (`OWNER`, `MANAGER`, `REVIEWER`, `VIEWER`). Full backend enforcement of access control and last-admin protection.
- 🔑 **Encrypted User Git Credentials**: AES-256-GCM encrypted Personal Access Tokens (PATs) for GitHub and GitLab associated directly with individual users, masked in UI and never leaked in API payloads or logs.
- 🕘 **Index history (v0.2.16)**: every finished indexing job (succeeded/failed/cancelled) is kept per project (last 50) with branch, commit, files, symbols, reused files and duration; see **Index history** in the Index tab (`GET /api/projects/:id/index/history`).
- 🔄 **Fresher index + diff overlay (v0.2.15)**: the index is refreshed when the target branch head moves (max every 5 min; 24h fallback if the head cannot be read), and review context overlays the diff on the index — new/renamed/deleted files, newly added imports, unresolved relative imports, and untouched files still importing a deleted or moved file.
- 🌿 **Per-branch index for reviews (v0.2.14)**: every branch keeps its own index (`refs.json`); reviews use the index of the MR/PR target branch, falling back to the default branch and then the latest index, and indexing a feature branch no longer changes other reviews. Auto-indexing now also uses the Git token from Settings.
- 🔗 **Deep links + Index token fix (v0.2.13)**: the URL now tracks the tab, project and project sub-tab (`#/projects/<id>/index`, back/forward supported); the Index tab uses the matching Git connection from Settings, fixing `404 Project Not Found` when no token is stored in Profile; Index inputs now match the app styling.
- 🔑 **Multiple Git connections + Test Connection (v0.2.12)**: Settings → Git Provider Settings now supports any number of GitLab/GitHub connections (name, base URL, token); the one matching the MR/PR host is used automatically, and a **Test Connection** button verifies each token (`POST /api/test-git-connection`). Existing single tokens migrate automatically.
- 🐞 **Fixes (v0.2.11)**: the Index tab no longer blanks the screen when the API returns a non-JSON page (e.g. a dev server that was not restarted after an update): the client now reports a clear error, a React error boundary keeps a crash inside one view from taking down the whole app, and `npm run dev` now uses `tsx watch` so server changes restart automatically.
- 🌿 **Branch picker for indexing (v0.2.10)**: the Index tab now loads the repository's branches from GitHub/GitLab (`GET /api/projects/:id/index/branches`), pre-fills the default branch and offers a searchable list; typing any branch, tag or SHA still works if the host cannot be reached. There is no cron-style scheduler yet: indexing starts manually or automatically when a review runs on an unindexed/stale (>24h) project.
- 🔑 **Local password recovery (v0.2.9)**: `npm run reset-password` lists users; `npm run reset-password -- <email> <newPassword>` resets a password and signs that user out everywhere. It is a local CLI (no HTTP endpoint, so nothing to disable in production). Stop the server first.
- 🧠 **Index-aware reviews (v0.2.8)**: Reviews of a registered project now include, for every changed file, its exports, imports and the files that depend on it (from the project index), flagging dependants outside the change. A background index job starts automatically for unindexed projects or when the index is older than 24h (10-minute back-off after a failure). Model prices now come from the configured providers so dollar budgets and cost metrics are real, cache hit/miss metrics are reported, a `.../merge_requests/latest` URL that cannot be resolved now fails with a clear error instead of reviewing a fabricated diff, and `npm run e2e` runs an end-to-end smoke test (after `npm run build`).
- 🐞 **Fixes (v0.2.7)**: Submitting a new MR/PR URL as a non-admin user now registers the project and makes that user its OWNER (previously the review was denied with 403 and the project was orphaned); the saved Git token is chosen by the repository host, so self-hosted GitLab domains that do not contain "gitlab" work; the Index tab no longer lists files with zero importers as "most imported".
- 🧭 **Project Index in the app (v0.2.6)**: project-index is now wired into the API and web UI (see the Structural Project Index entry); local filesystem paths are never accepted from API requests.
- 🐞 **Fixes (v0.2.5)**: Server honors the `PORT` env var (fixes `npm run desktop`), the settings budget limit is now sent to the backend as `AI_REVIEW_DOLLAR_BUDGET`, and the `eval`/`debugger` rules plus new SQL-injection and wildcard-CORS rules are registered in the default rule set.
- 📜 **Security Audit Trail**: Append-only logging (capped at the latest 10,000 entries) of authentication, user mutations, membership adjustments, credential lifecycle events, and review activities with sensitive data sanitization.
- 🛡️ **API Hardening (v0.2.4)**: All project, review, estimate, publish, model-listing and apply-local endpoints now require authentication; `apply-local` only edits files inside the given repository root (path traversal and escaping symlinks are rejected); `.data/` runtime storage is no longer tracked by git.
- 📊 **Benchmark Dataset & Evaluation Harness (v0.2.2)**: Empirical evaluation harness (`@ai-review/eval`) featuring ground-truth schemas, Kuhn-Munkres (Hungarian) maximum-weight bipartite matching with $O((m+n)^3)$ equality-subgraph tie-breaking, strict (`>`) dual-match quarantine, and unbiased precision, recall, F1, AFTR, FDPC, UAR, and filteredRecallLoss metrics. _Status: offline CLI/test tooling (`npm run eval:mock`), not part of the running app._
- 🧭 **Structural Project Index (`@ai-review/project-index` — v0.2.3)**: Multi-source repository indexing across GitLab REST v4, GitHub Trees/Blobs API, and local checkouts with `.gitignore` filtering, TypeScript/JS AST extraction, monorepo workspace & `tsconfig` path-alias dependency graphs, incremental `gitBlobSha`/`contentHash` reuse, atomic snapshot storage with retention, and rate-limit-aware cancellable jobs. Available in the app via the project **Index** tab and `GET/POST /api/projects/:id/index` (`DELETE .../index/job` cancels); indexing uses the requesting user's encrypted Git token and requires `project:manage` to start, `project:view` to read.
- 🧠 **Durable Multi-Scope Memory**: Crash-safe persistent memory partitioned by scope (`session`, `review`, `repository`, `organization`, `global`) surviving server restarts.
- 🦊 **GitLab Integration**: Fetches MR diffs and publishes inline discussions and review summaries directly via GitLab REST API v4. GitHub PR URLs can be fetched for review, but publishing comments back is GitLab-only for now.
- 🖥️ **Interactive Web & Desktop UI**: Multi-mode review input (diff, PR/MR URL, ZIP, local path, repository), historical review archive, per-request budget limit, and Electron desktop packaging. (Live streaming of pipeline stages via SSE is planned, not yet implemented.)

---

## 🇮🇷 درباره پروژه (فارسی)

**پلتفرم بررسی هوشمند کد (AI Code Review)** یک سیستم خودکار و چندعامله (Multi-Agent) است که مانند یک برنامه‌نویس ارشد در کنار شما قرار می‌گیرد. این پلتفرم با تحلیل کدهای جدید (از طریق GitLab یا فایل‌های Local)، باگ‌ها را شناسایی کرده و راهکارهای بهینه‌سازی پیشنهاد می‌دهد.

### ✨ ویژگی‌های کلیدی

- 🤖 **۱۳ ارزیاب متخصص**: شامل ایجنت‌های تخصصی برای React، TypeScript، Python، Android، امنیت (Security)، پرفورمنس و ...
- ⚡ **موتور بررسی قطعی (بدون هزینه)**: شناسایی فوری و بدون مصرف توکن: کلیدهای لو رفته، SQL Injection (ساخت کوئری با الحاق رشته)، CORS با wildcard، `eval`، `debugger`، `console`، نوع `any`، کامنت‌های TODO و تست‌های `.only`/`.skip`.
- 📊 **سامانه ارزیابی قطعی و بنچ‌مارک (نسخه ۰.۲.۲)**: پکیج تخصصی (`@ai-review/eval`) با معماری تطبیق وزن‌دار دوبخشی (الگوریتم مجارستانی و شکست تساوی $O((m+n)^3)$ روی زیرگراف برابری)، قرنطینه دوگانه اکید (`>`) برای پیشگیری از تایید کاذب خطاها، و محاسبه دقیق سنجه‌های آماری و اقتصادی (Precision, Recall, F1, AFTR, FDPC, UAR, filteredRecallLoss). _وضعیت: ابزار آفلاین (CLI و تست) و بخشی از اپلیکیشن در حال اجرا نیست._
- 🧭 **ایندکس ساختاری مخازن پروژه (`@ai-review/project-index` — نسخه ۰.۲.۳)**: موتور ایندکسینگ ساختاری پروژه‌ها با پشتیبانی از GitLab، GitHub و مسیرهای Local، فیلترهای `.gitignore` و حجم فایل، استخراج AST برای TypeScript/JS، ساخت گراف وابستگی و معکوس با پشتیبانی از Workspaces و `tsconfig` paths، بازاستفاده افزایشی بر پایه `gitBlobSha` و `contentHash` بدون دانلود مجدد، ذخیره‌سازی اتمیک اسنپ‌شات‌ها و مدیریت Job با قابلیت لغو و رعایت محدودیت نرخ (`429 Retry-After`). اکنون از تب **Index** در صفحه پروژه و endpointهای `GET/POST /api/projects/:id/index` (و `DELETE .../index/job` برای لغو) قابل استفاده است؛ ایندکس با توکن رمزنگاری‌شده Git کاربر درخواست‌دهنده انجام می‌شود، شروع آن نیازمند `project:manage` و مشاهده آن نیازمند `project:view` است.
- 🧠 **حافظه پایدار چندلایه‌ای (Phase 5)**: ذخیره‌سازی بادوام و مقاوم در برابر خاموشی برای نگهداری یادگیری‌ها، تاریخچه مخازن و تنظیمات در اسکوپ‌های مجزا.
- 🎯 **مسیریابی هوشمند**: بررسی نوع فایل‌های تغییر یافته و ارجاع آن‌ها فقط به متخصص مربوطه برای کاهش هزینه و افزایش سرعت.
- 🔌 **پشتیبانی از انواع هوش مصنوعی**: پشتیبانی کامل از **Gemini، OpenAI، Anthropic، OpenRouter، سیستم ایرانی Avalai، DeepSeek، و Ollama (برای پردازش آفلاین/رایگان)**.
- 🎛️ **مدیریت پیشرفته سرویس‌دهنده‌ها**: قابلیت روشن/خاموش کردن، تعیین هوش مصنوعی پیش‌فرض، دریافت مستقیم لیست مدل‌ها و کنترل سقف بودجه (Budget Limit).
- 📁 **رجیستری پروژه‌ها و دستورات سیستمی هوش مصنوعی**: موجودیت سطح اول پروژه با شناسه یکتای `gitHost + repositoryPath`، امکان ثبت دستی و ایجاد خودکار، تعیین دستورالعمل‌ها و کانتکست سیستمی اختصاصی برای هر پروژه (انتقال مستقیم به پرامپت ایجنت‌های هوش مصنوعی).
- 🔐 **احراز هویت و مدیریت کاربران (نسخه ۰.۲.۰)**: چرخه کامل مدیریت کاربران با هش ایمن گذرواژه به روش PBKDF2 (SHA-512)، توکن‌های سشن ۲۵۶ بیتی با امکان لغو، محدودکننده نرخ ورود (Rate Limiter) و صفحه راه‌اندازی اولیه اولین ادمین سیستم (First-Run Wizard).
- 🛡️ **سطوح دسترسی سازمانی و چندلایه‌ای (RBAC)**: نقش‌های سیستمی (`ADMIN` و `MEMBER`) و نقش‌های اختصاصی سطح پروژه (`OWNER`، `MANAGER`، `REVIEWER`، `VIEWER`) با اعتبارسنجی قطعی در سمت سرور و محافظت از حذف آخرین ادمین سیستم.
- 🔑 **ذخیره‌سازی رمزنگاری‌شده دسترسی‌های گیت**: اتصال Personal Access Token برای GitHub و GitLab با رمزنگاری پیشرفته متقارن AES-256-GCM در دیسک، نمایش ماسک‌شده و تضمین عدم افشا در خروجی APIها و لاگ‌ها.
- 🐞 **اصلاحات (نسخه ۰.۲.۱۱)**: تب Index دیگر هنگام دریافت پاسخ غیر JSON از API (مثلاً سرور توسعه‌ای که بعد از به‌روزرسانی ری‌استارت نشده) صفحه را سیاه نمی‌کند: کلاینت خطای واضح می‌دهد، یک Error Boundary در React مانع از خراب‌شدن کل اپ با کرش یک بخش می‌شود و `npm run dev` اکنون از `tsx watch` استفاده می‌کند تا تغییرات سرور خودکار ری‌استارت شوند.
- 🌿 **انتخاب برنچ برای ایندکس (نسخه ۰.۲.۱۰)**: تب Index اکنون لیست برنچ‌های مخزن را از GitHub/GitLab می‌گیرد (`GET /api/projects/:id/index/branches`)، برنچ پیش‌فرض را از قبل پر می‌کند و لیست قابل جستجو نشان می‌دهد؛ اگر اتصال به هاست ممکن نباشد همچنان می‌توان برنچ، تگ یا SHA را تایپ کرد. هنوز زمان‌بند (cron) نداریم: ایندکس دستی شروع می‌شود یا وقتی ریویو روی پروژه‌ی بدون ایندکس یا قدیمی‌تر از ۲۴ ساعت اجرا شود، خودکار.
- 🔑 **بازیابی رمز عبور محلی (نسخه ۰.۲.۹)**: دستور `npm run reset-password` کاربران را لیست می‌کند و `npm run reset-password -- <email> <newPassword>` رمز را عوض کرده و همه‌ی نشست‌های آن کاربر را خارج می‌کند. این یک CLI محلی است (بدون endpoint HTTP، پس برای پروداکشن چیزی برای غیرفعال‌کردن نیست). قبل از اجرا سرور را متوقف کنید.
- 🧠 **ریویو آگاه از ایندکس (نسخه ۰.۲.۸)**: ریویو پروژه‌های ثبت‌شده اکنون برای هر فایل تغییرکرده، exportها، importها و فایل‌های وابسته به آن را (از ایندکس پروژه) به ایجنت‌ها می‌دهد و وابسته‌های خارج از تغییر را مشخص می‌کند. برای پروژه‌های بدون ایندکس یا با ایندکس قدیمی‌تر از ۲۴ ساعت، ایندکس به‌صورت خودکار در پس‌زمینه اجرا می‌شود (بعد از شکست ۱۰ دقیقه صبر می‌کند). قیمت مدل‌ها از پروایدرهای تنظیم‌شده خوانده می‌شود تا سقف بودجه و هزینه‌ها واقعی باشند، متریک‌های cache گزارش می‌شوند، لینک `.../merge_requests/latest` که حل نشود به‌جای ریویوی یک دیف ساختگی خطای واضح می‌دهد، و `npm run e2e` یک تست سرتاسری اجرا می‌کند (بعد از `npm run build`).
- 🕘 **تاریخچه ایندکس (نسخه ۰.۲.۱۶)**: هر Job ایندکس پایان‌یافته (موفق/ناموفق/لغوشده) برای هر پروژه (۵۰ مورد آخر) با برنچ، commit، تعداد فایل و سیمبل، فایل‌های بازاستفاده‌شده و مدت زمان ذخیره می‌شود؛ بخش **Index history** در تب Index (`GET /api/projects/:id/index/history`).
- 🔄 **ایندکس تازه‌تر + اعمال دیف روی ایندکس (نسخه ۰.۲.۱۵)**: ایندکس با تغییر commit سر برنچ مقصد به‌روز می‌شود (حداکثر هر ۵ دقیقه؛ در صورت ناتوانی در خواندن آن، fallback ۲۴ ساعته) و کانتکست ریویو دیف را روی ایندکس اعمال می‌کند: فایل‌های جدید/تغییرنام‌یافته/حذف‌شده، importهای تازه، importهای نسبی بدون مقصد و فایل‌های دست‌نخورده‌ای که هنوز فایل حذف‌شده یا جابه‌جاشده را import می‌کنند.
- 🌿 **ایندکس مجزا برای هر برنچ در ریویو (نسخه ۰.۲.۱۴)**: هر برنچ ایندکس مخصوص خود را دارد؛ ریویو از ایندکس برنچ مقصد MR/PR استفاده می‌کند (در صورت نبود، برنچ پیش‌فرض و سپس آخرین ایندکس) و ایندکس‌کردن یک فیچر‌برنچ روی ریویوهای دیگر اثر نمی‌گذارد. ایندکس خودکار هم از توکن Git تنظیمات استفاده می‌کند.
- 🔗 **لینک مستقیم + رفع خطای توکن Index (نسخه ۰.۲.۱۳)**: آدرس اکنون تب، پروژه و زیرتب پروژه را دنبال می‌کند (`#/projects/<id>/index`، با پشتیبانی back/forward)؛ تب Index از اتصال Git مطابق در Settings استفاده می‌کند و خطای `404 Project Not Found` را رفع می‌کند؛ ظاهر اینپوت‌های Index هم با بقیه برنامه یکی شد.
- 🔑 **چند اتصال Git + تست اتصال (نسخه ۰.۲.۱۲)**: در تنظیمات → Git Provider Settings می‌توانید چندین اتصال GitLab/GitHub (نام، آدرس پایه، توکن) تعریف کنید؛ اتصال مطابق با host لینک MR/PR خودکار انتخاب می‌شود و دکمه **Test Connection** اعتبار هر توکن را بررسی می‌کند (`POST /api/test-git-connection`). توکن‌های تکی قبلی خودکار منتقل می‌شوند.
- 🐞 **اصلاحات (نسخه ۰.۲.۷)**: ثبت لینک MR/PR جدید توسط کاربر غیرادمین اکنون پروژه را ثبت کرده و او را OWNER می‌کند (قبلاً ریویو با خطای ۴۰۳ رد می‌شد و پروژه بدون مالک می‌ماند)؛ توکن ذخیره‌شده Git بر اساس host مخزن انتخاب می‌شود تا GitLabهای self-hosted با دامنه‌ای که «gitlab» ندارد هم کار کنند؛ تب Index دیگر فایل‌های بدون importer را «پرایمپورت‌ترین» نشان نمی‌دهد.
- 🧭 **ایندکس پروژه در اپلیکیشن (نسخه ۰.۲.۶)**: project-index به API و رابط وب متصل شد (به بخش ایندکس ساختاری مراجعه کنید)؛ مسیر محلی فایل‌سیستم هرگز از درخواست‌های API پذیرفته نمی‌شود.
- 🐞 **اصلاحات (نسخه ۰.۲.۵)**: سرور متغیر `PORT` را می‌خواند (رفع مشکل `npm run desktop`)، سقف بودجه تنظیمات به‌صورت `AI_REVIEW_DOLLAR_BUDGET` به بک‌اند ارسال می‌شود و قوانین `eval`/`debugger` به‌همراه قوانین جدید SQL Injection و CORS با wildcard در مجموعه پیش‌فرض ثبت شدند.
- 📜 **ثبت رویدادهای امنیتی (Audit Logs)**: رهگیری و ثبت (فقط‌افزودنی، حداکثر ۱۰٬۰۰۰ رکورد آخر) وقایع حیاتی سیستم اعم از ورود/خروج، تغییر نقش‌ها، مدیریت پروژه‌ها، ثبت یا حذف توکن‌ها با فیلترسازی و حذف خودکار اطلاعات حساس.
- 🛡️ **سخت‌سازی API (نسخه ۰.۲.۴)**: همه endpointهای پروژه، ریویو، برآورد، انتشار، لیست مدل‌ها و apply-local اکنون نیازمند ورود کاربر هستند؛ `apply-local` فقط فایل‌های داخل ریشه مخزن را تغییر می‌دهد (path traversal و symlink خارج از ریشه رد می‌شود)؛ پوشه `.data/` دیگر در git ردیابی نمی‌شود.
- 🦊 **یکپارچگی با گیت‌لب (GitLab)**: امکان دریافت مستقیم Merge Request ها و ثبت خودکار کامنت روی کدهای تغییر یافته در GitLab. دریافت دیف PR در GitHub پشتیبانی می‌شود، اما ثبت کامنت فعلاً فقط برای GitLab است.
- 🖥️ **رابط کاربری تعاملی (وب و دسکتاپ)**: ورودی چندحالته (diff، لینک PR/MR، ZIP، مسیر محلی، مخزن)، تاریخچه ریویوها، سقف بودجه برای هر درخواست و نسخه دسکتاپ (Electron). (نمایش زنده مراحل با SSE برنامه‌ریزی شده و هنوز پیاده‌سازی نشده است.)

---

## 🏗️ Architecture & Package Status

```
├── apps/
│   ├── web/               # [Active] React + Tailwind CSS + Vite frontend
│   └── api/               # [Active] Standalone Express API definitions
├── packages/
│   ├── project-index/     # [Active] Structural repository indexer, import graph, & snapshot store (wired to API + UI)
│   ├── eval/              # [Active] Benchmark dataset & Kuhn-Munkres evaluation harness
│   ├── orchestrator/      # [Active] Multi-agent pipeline coordinator, planner, & critic
│   ├── config/            # [Active] Deterministic rule registry & engine
│   ├── context-engine/    # [Active] TypeScript AST extraction & context slicing
│   ├── core/              # [Active] Domain types, result types, & interface definitions
│   ├── git/               # [Active] GitLab provider, URL parser, & review publisher
│   ├── llm/               # [Active] Multi-provider OpenAI-compatible LLM client & cache
│   ├── memory/            # [Active] Multi-scope memory store (in-memory + persistent file backend)
│   ├── repository/        # [Active] Unified diff parser & local file resolver
│   ├── reporting/         # [Active] Markdown & JSON review renderers
│   ├── shared/            # [Active] Environment loaders, hashing, & telemetry utilities
│   ├── workflow-engine/   # [Abstraction] Graph/DAG execution engine (compiled)
│   ├── agent-runtime/     # [Abstraction] Capability gating runtime (compiled)
│   ├── prompts/           # [Stub] Reserved for externalized prompt templates
│   ├── skills/            # [Active] Diff/import/symbol skills used by the orchestrator pipeline
│   ├── tools/             # [Active] Tool registry, filesystem & AST tools used by the pipeline
│   ├── ui/                # [Stub] Reserved for cross-framework UI components
│   └── plugins/           # [Draft] Architecture documentation for plugin ecosystem
├── server.ts              # Full-stack API & development web server
├── main.cjs               # Electron desktop main process entry
└── turbo.json             # Turborepo task pipeline configuration
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: `v18.0.0` or higher
- **npm** (v10+) or **bun**

### 1. Installation

Clone the repository and install dependencies:

```bash
git clone <repository-url>
cd ai-review-platform
npm install
```

### 2. Environment Configuration

Copy `.env.example` to `.env` and set your API keys (can also be done directly in the UI Settings):

```bash
cp .env.example .env
```

### 3. Running Development Server

Start the full-stack server (Express API + Vite React Frontend on port `3000`):

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🛠️ Available Scripts

| Command                 | Description                                                                           |
| :---------------------- | :------------------------------------------------------------------------------------ |
| `npm run dev`           | Starts the unified full-stack server in development mode (`tsx server.ts`)            |
| `npm run build`         | Builds all packages with Turborepo and compiles the server bundle (`dist/server.cjs`) |
| `npm run start`         | Launches the compiled production server (`node dist/server.cjs`)                      |
| `npm run eval`          | Runs unit test suite for the deterministic evaluation harness (`@ai-review/eval`)     |
| `npm run eval:mock`     | Executes the benchmark evaluation CLI harness on synthetic test cases                 |
| `npm run clean`         | Cleans build caches and generated artifacts                                           |
| `npm run desktop`       | Launches the full-stack server and the Electron desktop application                   |
| `npm run build:desktop` | Packages the desktop application for macOS, Windows, or Linux                         |

---

## 📄 License

Private repository maintained for automated AI code review workflows. Version **0.2.2**.
