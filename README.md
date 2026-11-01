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
- 🐞 **Fixes (v0.2.5)**: Server honors the `PORT` env var (fixes `npm run desktop`), the settings budget limit is now sent to the backend as `AI_REVIEW_DOLLAR_BUDGET`, and the `eval`/`debugger` rules plus new SQL-injection and wildcard-CORS rules are registered in the default rule set.
- 📜 **Security Audit Trail**: Append-only logging (capped at the latest 10,000 entries) of authentication, user mutations, membership adjustments, credential lifecycle events, and review activities with sensitive data sanitization.
- 🛡️ **API Hardening (v0.2.4)**: All project, review, estimate, publish, model-listing and apply-local endpoints now require authentication; `apply-local` only edits files inside the given repository root (path traversal and escaping symlinks are rejected); `.data/` runtime storage is no longer tracked by git.
- 📊 **Benchmark Dataset & Evaluation Harness (v0.2.2)**: Empirical evaluation harness (`@ai-review/eval`) featuring ground-truth schemas, Kuhn-Munkres (Hungarian) maximum-weight bipartite matching with $O((m+n)^3)$ equality-subgraph tie-breaking, strict (`>`) dual-match quarantine, and unbiased precision, recall, F1, AFTR, FDPC, UAR, and filteredRecallLoss metrics. _Status: offline CLI/test tooling (`npm run eval:mock`), not part of the running app._
- 🧭 **Structural Project Index (`@ai-review/project-index` — v0.2.3)**: Multi-source repository indexing across GitLab REST v4, GitHub Trees/Blobs API, and local checkouts with `.gitignore` filtering, TypeScript/JS AST extraction, monorepo workspace & `tsconfig` path-alias dependency graphs, incremental `gitBlobSha`/`contentHash` reuse, atomic snapshot storage with retention, and rate-limit-aware cancellable jobs. _Status: standalone library with tests; not yet wired into the API or UI._
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
- 🧭 **ایندکس ساختاری مخازن پروژه (`@ai-review/project-index` — نسخه ۰.۲.۳)**: موتور ایندکسینگ ساختاری پروژه‌ها با پشتیبانی از GitLab، GitHub و مسیرهای Local، فیلترهای `.gitignore` و حجم فایل، استخراج AST برای TypeScript/JS، ساخت گراف وابستگی و معکوس با پشتیبانی از Workspaces و `tsconfig` paths، بازاستفاده افزایشی بر پایه `gitBlobSha` و `contentHash` بدون دانلود مجدد، ذخیره‌سازی اتمیک اسنپ‌شات‌ها و مدیریت Job با قابلیت لغو و رعایت محدودیت نرخ (`429 Retry-After`). _وضعیت: کتابخانه مستقل همراه با تست؛ هنوز به API و رابط کاربری متصل نشده است._
- 🧠 **حافظه پایدار چندلایه‌ای (Phase 5)**: ذخیره‌سازی بادوام و مقاوم در برابر خاموشی برای نگهداری یادگیری‌ها، تاریخچه مخازن و تنظیمات در اسکوپ‌های مجزا.
- 🎯 **مسیریابی هوشمند**: بررسی نوع فایل‌های تغییر یافته و ارجاع آن‌ها فقط به متخصص مربوطه برای کاهش هزینه و افزایش سرعت.
- 🔌 **پشتیبانی از انواع هوش مصنوعی**: پشتیبانی کامل از **Gemini، OpenAI، Anthropic، OpenRouter، سیستم ایرانی Avalai، DeepSeek، و Ollama (برای پردازش آفلاین/رایگان)**.
- 🎛️ **مدیریت پیشرفته سرویس‌دهنده‌ها**: قابلیت روشن/خاموش کردن، تعیین هوش مصنوعی پیش‌فرض، دریافت مستقیم لیست مدل‌ها و کنترل سقف بودجه (Budget Limit).
- 📁 **رجیستری پروژه‌ها و دستورات سیستمی هوش مصنوعی**: موجودیت سطح اول پروژه با شناسه یکتای `gitHost + repositoryPath`، امکان ثبت دستی و ایجاد خودکار، تعیین دستورالعمل‌ها و کانتکست سیستمی اختصاصی برای هر پروژه (انتقال مستقیم به پرامپت ایجنت‌های هوش مصنوعی).
- 🔐 **احراز هویت و مدیریت کاربران (نسخه ۰.۲.۰)**: چرخه کامل مدیریت کاربران با هش ایمن گذرواژه به روش PBKDF2 (SHA-512)، توکن‌های سشن ۲۵۶ بیتی با امکان لغو، محدودکننده نرخ ورود (Rate Limiter) و صفحه راه‌اندازی اولیه اولین ادمین سیستم (First-Run Wizard).
- 🛡️ **سطوح دسترسی سازمانی و چندلایه‌ای (RBAC)**: نقش‌های سیستمی (`ADMIN` و `MEMBER`) و نقش‌های اختصاصی سطح پروژه (`OWNER`، `MANAGER`، `REVIEWER`، `VIEWER`) با اعتبارسنجی قطعی در سمت سرور و محافظت از حذف آخرین ادمین سیستم.
- 🔑 **ذخیره‌سازی رمزنگاری‌شده دسترسی‌های گیت**: اتصال Personal Access Token برای GitHub و GitLab با رمزنگاری پیشرفته متقارن AES-256-GCM در دیسک، نمایش ماسک‌شده و تضمین عدم افشا در خروجی APIها و لاگ‌ها.
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
│   ├── project-index/     # [Active] Structural repository indexer, import graph, & snapshot store
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
