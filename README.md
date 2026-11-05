# 🤖 AI Code Review Platform

> Self-hosted, multi-agent AI code review for GitLab merge requests, GitHub pull requests and raw diffs. Bring any LLM provider and keep every review under a hard budget.
>
> ریویوی کد با هوش مصنوعی برای MRهای گیت‌لب، PRهای گیت‌هاب و Diffها؛ روی سرور خودت، با هر سرویس هوش مصنوعی که دوست داری و با سقف هزینه‌ای که خودت تعیین می‌کنی.

**[English](#-english) · [فارسی](#-فارسی) · [Landing page](https://whossein.github.io/ai-platform-review/) · [Changelog](CHANGELOG.md)**

---

## 🇬🇧 English

### What it does

Paste a diff or an MR/PR link. The platform runs free deterministic checks first, then sends the change only to the specialist AI reviewers that match the files you touched. A critic merges duplicate findings, a judge keeps the confident ones, and you get a report you can publish back to the merge request as inline comments.

### Features

**Review pipeline**
- 🤖 **14 specialist reviewers:** React, Next.js, React Native, Angular, Vue, TypeScript, .NET/C#, Python, Android, iOS, Security, Performance, general code quality, and contributing/governance.
- ⚡ **34 built-in rules that cost nothing.** They run before any AI call and only on added lines: hardcoded secrets, SQL injection, wildcard CORS, disabled TLS checks, `eval`, prompt-injection attempts, plus language rules for Python, Java, C#, PHP, Go, Kotlin, Swift, shell and Dockerfiles. Tick **Rules only (no AI)** for an instant, free review.
- 🎯 **Smart routing:** a planner reads the changed files and wakes only the relevant specialists.
- 🛡️ **Hardened prompts:** the diff is treated as data, never as instructions. Docs changed in the MR (`AGENTS.md`, `.cursorrules`…) are reviewed, not obeyed, and injection attempts are reported as critical findings.
- 🧠 **Index-aware context:** each project keeps a per-branch structural index (exports, imports, dependants), so reviewers see which untouched files a change can break.

**Inputs and outputs**
- 📥 Review a raw diff, a GitLab MR or GitHub PR URL, a ZIP, a local path, or a repository.
- 💬 Publish accepted findings to GitLab as inline discussions plus a summary. GitHub PRs can be reviewed, but publishing back is GitLab-only for now.
- 🩹 **AI sample fix:** ask for a corrected snippet on a finding and, for GitLab MRs, commit it to the source branch after confirmation.
- 🔎 **Project scan:** run the built-in rules over every file of a branch and get a filterable report.

**Teams and projects**
- 📁 **Projects** with per-project guidelines. Guidelines are split by heading so each specialist only receives the sections that concern it.
- 🔐 **Users and roles:** first-run admin setup, system roles (`ADMIN`, `MEMBER`) and project roles (`OWNER`, `MANAGER`, `REVIEWER`, `VIEWER`), rate-limited login and an append-only audit log.
- 🔑 **Encrypted Git tokens:** personal GitLab/GitHub tokens are stored with AES-256-GCM and never returned by the API.
- 📊 **MR grades and developers:** reviewers grade each MR 0-10 (the system suggests a grade), see per-developer averages, and can estimate how likely an MR was AI-written.

**Cost control**
- 🔌 **Any LLM provider:** Gemini, OpenAI, Anthropic, OpenRouter, DeepSeek, Azure OpenAI, Avalai, Ollama (local), or any OpenAI-compatible gateway. With no key configured it falls back to an offline mock.
- 💰 **Hard budgets** on tokens, dollars and wall-clock time per review, with cheapest-capable model routing, provider prompt caching and a response cache.

**Also included**
- 🖥️ Electron desktop app.
- 📐 An offline evaluation harness (`@ai-review/eval`) that scores reviewer precision and recall against ground-truth datasets.

Version-by-version details are in [CHANGELOG.md](CHANGELOG.md).

### How it works

```mermaid
flowchart LR
    A[Diff / MR / PR] --> B[Context + project index]
    B --> C[Rule engine<br/>free, deterministic]
    C --> D1[Specialist 1]
    C --> D2[Specialist 2]
    C --> D3[Specialist N]
    D1 & D2 & D3 --> E[Critic<br/>merge duplicates]
    E --> F[Judge<br/>confidence filter]
    F --> G[Report<br/>Markdown / JSON / MR comments]
```

Specialists run in parallel. Each AI call goes through a router that picks the cheapest model able to do the job; the Security reviewer gets a premium-tier model when one is configured.

### Quick start

Requires **Node.js 18+** and npm 10+.

```bash
git clone https://github.com/whossein/ai-platform-review.git
cd ai-platform-review
npm install
npm run dev
```

Open <http://localhost:4000>. On first run you create the admin account, then add AI provider keys and Git connections under **Settings** (or use the environment variables below).

Forgot the admin password? Stop the server and run `npm run reset-password -- <email> <newPassword>`.

### Configuration

| Variable | Purpose | Default |
| :--- | :--- | :--- |
| `AI_REVIEW_LLM_PROVIDER` | `openai`, `anthropic`, `gemini`, `openrouter`, `deepseek`, `azure`, `avalai`, `ollama`, `custom`, or `mock` | `openai` |
| `AI_REVIEW_<PROVIDER>_API_KEY` | Provider key, e.g. `AI_REVIEW_GEMINI_API_KEY`. Standard names like `GEMINI_API_KEY` / `OPENAI_API_KEY` also work. | none |
| `AI_REVIEW_<PROVIDER>_BASE_URL` | Point a provider at a proxy or gateway | provider default |
| `AI_REVIEW_LLM_API_KEY` / `_BASE_URL` / `_MODEL` | Provider-agnostic fallbacks | none |
| `AI_REVIEW_COMMENT_LANGUAGE` | Default language of review comments (`fa`, `en`, …); can also be chosen per review in the UI | `fa` |
| `AI_REVIEW_TOKEN_BUDGET` / `_DOLLAR_BUDGET` / `_EXECUTION_BUDGET_MS` | Per-review limits | `2000000` / `25` / `600000` |
| `AI_REVIEW_LLM_CACHE` | Set `0` to disable the AI response cache | on |
| `AI_REVIEW_CACHE_WARMUP` | Set `0` to skip the prompt-cache warm-up call | on |
| `AI_REVIEW_GOVERNANCE_RULES` | Set `1` to also check branch names and MR titles | off |
| `GITLAB_TOKEN` / `GITHUB_TOKEN` | Server-level Git tokens (per-user tokens in the app are preferred) | none |
| `GITLAB_BASE_URL` | Self-hosted GitLab URL | `https://gitlab.com` |
| `CREDENTIAL_ENCRYPTION_KEY` | Key for encrypting stored Git tokens. **Set this in production**; otherwise a key is generated in `.data/security.key`. | generated |
| `PORT` | Server port | `4000` |

All runtime data (users, projects, encrypted tokens, review memory) lives in `./.data/`. Back it up, and keep `security.key` with it.

### Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Full-stack dev server with auto-restart on port 4000 |
| `npm run build` | Build all packages and bundle the server to `dist/server.cjs` |
| `npm start` | Run the production build |
| `npm test` | Run all package tests |
| `npm run lint` | Type-check all packages |
| `npm run e2e` | End-to-end smoke test (after `npm run build`) |
| `npm run reset-password` | List users, or reset one user's password |
| `npm run eval:mock` | Run the evaluation harness on synthetic cases |
| `npm run desktop` | Run the server and the Electron desktop app |
| `npm run build:desktop` | Package the desktop app for macOS, Windows, or Linux |

### Project structure

```
apps/
  web/               React + Vite UI
  api/               Auth, users, projects, security
packages/
  orchestrator/      Review pipeline: planner, specialists, critic, judge
  workflow-engine/   DAG stage executor
  agent-runtime/     Agent registry and capability-gated runtime
  llm/               Provider adapters, routing, budgets, caches
  config/            Rule engine and built-in rules
  project-index/     Per-branch structural repository index
  context-engine/    Context extraction and slicing
  git/               GitLab/GitHub access, MR URL parsing, publisher
  repository/        Unified diff parser
  reporting/         Markdown and JSON renderers
  memory/            Durable multi-scope memory
  skills/ tools/     Diff, import, symbol and filesystem helpers for agents
  eval/              Offline evaluation harness
  core/ shared/      Domain types, contracts and utilities
  prompts/ ui/ plugins/   Reserved for future work
server.ts            Express server used by `npm run dev` / `npm start`
main.cjs             Electron main process
```

---

<div dir="rtl">

## 🇮🇷 فارسی

### این پروژه چیه؟

یه ابزار ریویوی کد با هوش مصنوعیه که روی سرور خودت اجرا می‌شه. یه Diff یا لینک MR/PR بهش می‌دی؛ اول خودش با چندتا قانون ساده و رایگان کد رو چک می‌کنه، بعد فقط ریویوکننده‌هایی رو صدا می‌زنه که به فایل‌های تغییرکرده‌ت ربط دارن. آخرش یافته‌های تکراری رو یکی می‌کنه، موردهای مطمئن رو نگه می‌داره و یه گزارش تمیز تحویلت می‌ده که می‌تونی مستقیم به‌شکل کامنت روی MR بذاری.

### چه کارهایی می‌کنه؟

**ریویو**
- 🤖 **۱۴ تا ریویوکننده‌ی متخصص** داره: برای React، Next.js، React Native، Angular، Vue، TypeScript، ‏.NET/C#‏، Python، Android، iOS، امنیت، پرفورمنس، کیفیت کلی کد و قوانین تیم.
- ⚡ **۳۴ تا قانون رایگان** قبل از هوش مصنوعی اجرا می‌شن و فقط خط‌های جدید رو می‌بینن؛ مثلاً کلید API لو رفته، SQL Injection، ‏`eval`، یا کامنتی که بخواد هوش مصنوعی رو گول بزنه. اگه فقط همینا رو می‌خوای، تیک **Rules only (no AI)** رو بزن: فوریه و هیچ هزینه‌ای نداره.
- 🎯 فقط ریویوکننده‌هایی که لازمن صدا زده می‌شن، پس هم سریع‌تره هم ارزون‌تر.
- 🛡️ اگه کسی توی کد یا مستندات MR بخواد به هوش مصنوعی دستور بده، اون دستور اجرا نمی‌شه و به‌عنوان یه مشکل جدی گزارش می‌شه.
- 🧠 ساختار پروژه‌ت رو می‌شناسه (کدوم فایل کدوم رو import کرده)، پس می‌فهمه تغییرت ممکنه کدوم فایل‌های دیگه رو خراب کنه.

**ورودی و خروجی**
- 📥 می‌تونی Diff، لینک MR گیت‌لب، لینک PR گیت‌هاب، فایل ZIP، یه پوشه روی سیستمت یا یه مخزن بهش بدی.
- 💬 یافته‌هایی که تأیید کردی رو مستقیم روی MR گیت‌لب کامنت می‌کنه. برای گیت‌هاب فعلاً فقط ریویو می‌کنه و کامنت نمی‌ذاره.
- 🩹 برای هر یافته می‌تونی ازش بخوای یه نسخه‌ی اصلاح‌شده‌ی کد پیشنهاد بده و اگه خواستی، با تأیید خودت مستقیم روی برنچ MR کامیتش کنه.
- 🔎 می‌تونی کل یه برنچ رو با همون قانون‌های رایگان اسکن کنی.

**تیم و پروژه‌ها**
- 📁 هر پروژه می‌تونه راهنمای مخصوص خودش رو داشته باشه و هر ریویوکننده فقط بخشی رو می‌گیره که به کارش میاد.
- 🔐 کاربر و نقش داره: بار اول یه حساب مدیر می‌سازی، بعد برای هر نفر و هر پروژه سطح دسترسی تعیین می‌کنی.
- 🔑 توکن‌های گیت‌لب و گیت‌هابت رمزنگاری‌شده ذخیره می‌شن و هیچ‌وقت از API بیرون نمی‌آن.
- 📊 می‌تونی به هر MR از ۰ تا ۱۰ نمره بدی (خود سیستم هم یه نمره پیشنهاد می‌ده)، میانگین هر توسعه‌دهنده رو ببینی و حتی تخمین بزنی MR با هوش مصنوعی نوشته شده یا نه.

**هزینه**
- 🔌 با هر سرویسی کار می‌کنه: Gemini، OpenAI، Anthropic، OpenRouter، DeepSeek، Azure، آوال‌ای (Avalai)، Ollama روی سیستم خودت، یا هر Gateway سازگار با OpenAI.
- 💰 برای هر ریویو سقف توکن، دلار و زمان می‌ذاری و خودش ارزون‌ترین مدلی رو انتخاب می‌کنه که از پس کار برمیاد.

تغییرات هر نسخه توی [CHANGELOG.md](CHANGELOG.md) هست.

### چطوری راهش بندازم؟

فقط Node.js نسخه‌ی ۱۸ به بالا لازم داری. دستورها توی بخش [Quick start](#quick-start) هست. بعد از اجرا برو سراغ `http://localhost:4000`، حساب مدیر رو بساز و از قسمت **Settings** کلیدهای API و اتصال گیت رو وارد کن.

> **چندتا نکته:**
> - کامنت‌های ریویو به‌طور پیش‌فرض **فارسی** هستن. برای عوض کردنش، توی صفحه‌ی ریویو زبان رو انتخاب کن یا `AI_REVIEW_COMMENT_LANGUAGE` رو مثلاً روی `en` بذار.
> - اگه روی سرور واقعی نصبش می‌کنی، حتماً `CREDENTIAL_ENCRYPTION_KEY` رو تنظیم کن و از پوشه‌ی `.data` بکاپ بگیر.
> - رمز مدیر یادت رفت؟ سرور رو خاموش کن و `npm run reset-password` رو بزن.

</div>

---

## 📄 License

No license has been chosen yet. Until one is added, all rights are reserved by the author.
