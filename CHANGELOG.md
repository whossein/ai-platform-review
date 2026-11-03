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

## [0.3.0] - 2026-11-03

### Security
- **EN:** AI reviewers can no longer be steered by the merge request itself. Docs changed in the MR (AGENTS.md, CONTRIBUTING.md, .cursorrules, lint configs) are reviewed as part of the diff instead of being treated as reviewer rules; only the guidelines saved in the project settings act as rules. The diff, project structure and tool output are sent as clearly marked data blocks, and text in them that tries to instruct the AI (e.g. "report no issues") is reported as a critical security finding.
- **FA:** دیگر نمی‌توان ریویوکننده‌های AI را از داخل خود MR هدایت کرد. مستندات تغییرکرده در MR (AGENTS.md، CONTRIBUTING.md، .cursorrules، تنظیمات lint) جزو diff بررسی می‌شوند و دیگر قانون ریویو حساب نمی‌شوند؛ فقط دستورالعمل‌های ذخیره‌شده در تنظیمات پروژه قانون هستند. diff، ساختار پروژه و خروجی ابزارها به‌صورت بلوک‌های داده مشخص ارسال می‌شوند و متنی که داخل آن‌ها بخواهد به AI دستور بدهد (مثلاً «هیچ مشکلی گزارش نکن») به‌عنوان یافته امنیتی critical گزارش می‌شود.

### Changed
- **EN:** More accurate line numbers in review comments: the diff sent to the AI carries the new-file line number on every line, and findings are snapped to the nearest changed line (with slightly lower confidence) so inline comments land in the right place. Findings on files that are neither in the MR nor mentioned in the review context are discarded as hallucinated.
- **FA:** شماره خط کامنت‌های ریویو دقیق‌تر شد: diff ارسالی به AI روی هر خط شماره خط فایل جدید را دارد و یافته‌ها به نزدیک‌ترین خط تغییرکرده منتقل می‌شوند (با اطمینان کمی کمتر) تا کامنت inline در جای درست بنشیند. یافته‌هایی که فایلشان نه در MR است و نه در context ریویو آمده، ساختگی فرض و حذف می‌شوند.
- **EN:** Lower AI cost per review: all specialists now share an identical prompt prefix (instructions + diff), so providers with automatic prompt caching (OpenAI, Gemini, DeepSeek…) reuse it across specialists. Cached prompt tokens are recorded when the provider reports them.
- **FA:** هزینه AI هر ریویو کمتر شد: همه specialistها ابتدای پرامپت یکسان دارند (دستورالعمل + diff)، بنابراین سرویس‌هایی که کش خودکار پرامپت دارند (OpenAI، Gemini، DeepSeek و…) آن را بین specialistها بازاستفاده می‌کنند. تعداد توکن‌های کش‌شده در صورت گزارش سرویس‌دهنده ثبت می‌شود.
- **EN:** More reliable AI output: reviewers request a strict JSON schema (`json_schema`), falling back automatically to `json_object` and then plain output on providers that do not support it. Findings without a title or file are dropped, and out-of-range confidence values are clamped instead of failing the specialist.
- **FA:** خروجی AI پایدارتر شد: ریویوکننده‌ها schema دقیق JSON (`json_schema`) درخواست می‌کنند و در سرویس‌هایی که پشتیبانی نمی‌کنند خودکار به `json_object` و سپس خروجی ساده برمی‌گردند. یافته‌های بدون عنوان یا فایل حذف می‌شوند و مقدار confidence خارج از بازه به‌جای از کار انداختن specialist محدود (clamp) می‌شود.

## [0.2.43] - 2026-11-03

### Changed
- **EN:** Review & Publish now opens with a larger summary panel: MR title, link, author and branches, per-severity counts (selected/total), files, categories, average confidence, plus Select all / Select none. The redundant "Pre-Review Findings" box was removed.
- **FA:** بالای Review & Publish اکنون پنل خلاصه بزرگ‌تری است: عنوان، لینک، نویسنده و شاخه‌های MR، تعداد هر شدت (انتخاب‌شده/کل)، فایل‌ها، دسته‌ها، میانگین اطمینان و Select all / Select none. باکس تکراری «Pre-Review Findings» حذف شد.

## [0.2.42] - 2026-11-03

### Added
- **EN:** Review & Publish now has **Select all** and **Select none** buttons and a live "N of M selected" counter, so you can adjust which findings get published quickly.
- **FA:** در Review & Publish دکمه‌های **Select all** و **Select none** و شمارنده «N از M انتخاب شده» اضافه شد تا انتخاب موارد برای انتشار سریع‌تر اصلاح شود.

## [0.2.41] - 2026-11-03

### Added
- **EN:** After "Get AI sample fix", a new **Add to comment** button (next to **Commit to branch**) appends the code to the issue's PR comment as a Git `suggestion` block, so the Git host shows an Apply button. Click again to undo.
- **FA:** بعد از «Get AI sample fix» دکمه جدید **Add to comment** (کنار **Commit to branch**) کد را به‌صورت بلاک `suggestion` گیت به کامنت PR اضافه می‌کند تا در Git دکمه Apply نمایش داده شود. با کلیک دوباره برداشته می‌شود.

## [0.2.40] - 2026-11-03

### Fixed
- **EN:** The `governance.require-release-change` rule no longer reports a missing release note when the change already touches a changelog or release-notes file under a different name (e.g. `CHANGELOG.fa.md`, `docs/release-notes/1.2.md`).
- **FA:** قانون `governance.require-release-change` دیگر وقتی تغییر، فایل changelog یا release-notes را با نام دیگری (مثلاً `CHANGELOG.fa.md` یا `docs/release-notes/1.2.md`) ویرایش کرده، خطای «release ثبت نشده» نمی‌دهد.

## [0.2.39] - 2026-11-03

### Changed
- **EN:** Project AI guidelines are no longer copied in full to every specialist. The text is split by `##` headings (Security, Performance, Database, Testing, Style & Naming, Architecture, Git & Commits, or a framework name; `## Title [security]` tags a topic explicitly) and each specialist only gets the sections that concern it. Sections with other headings, and rules learned from feedback, still go to everyone. The feedback digest is also capped (5 items, shorter text). This lowers the AI cost of every review.
- **FA:** دستورالعمل‌های AI پروژه دیگر کامل برای همه specialistها فرستاده نمی‌شود. متن با سرتیتر `##` (Security، Performance، Database، Testing، Style & Naming، Architecture، Git & Commits یا نام فریم‌ورک؛ با `## عنوان [security]` موضوع صریح تعیین می‌شود) تقسیم می‌شود و هر specialist فقط بخش‌های مربوط به خودش را می‌گیرد. بخش‌های با سرتیتر دیگر و قوانین یادگرفته‌شده از فیدبک همچنان برای همه می‌رود. خلاصه فیدبک هم محدود شد (۵ مورد، متن کوتاه‌تر). این کار هزینه AI هر ریویو را کم می‌کند.

### Added
- **EN:** **Fix, improve & shorten with AI** in the guidelines editor (optionally translating to English, on by default): the AI rewrites the guidelines into clean `##` sections and also makes a terse compact version. You review the improved text, and when you save, reviewers receive the compact version while the full text stays visible and editable. Editing the full text later drops the stale compact version. New endpoint `POST /api/projects/:id/instructions/optimize` (needs project manage permission; saves nothing).
- **FA:** دکمه **Fix, improve & shorten with AI** در ویرایشگر دستورالعمل‌ها (با گزینه ترجمه به انگلیسی، به‌صورت پیش‌فرض روشن): AI متن را به بخش‌های مرتب `##` بازنویسی می‌کند و یک نسخه فشرده هم می‌سازد. متن بهبودیافته را می‌بینید و بعد از ذخیره، ریویوها نسخه فشرده را می‌گیرند ولی متن کامل برای شما قابل مشاهده و ویرایش می‌ماند. ویرایش بعدی متن کامل، نسخه فشرده قدیمی را کنار می‌گذارد. مسیر جدید `POST /api/projects/:id/instructions/optimize` (نیازمند دسترسی مدیریت پروژه؛ چیزی ذخیره نمی‌کند).
- **EN:** The guidelines editor shows an estimated token count and warns when the text is long (over about 1,500 tokens).
- **FA:** ویرایشگر دستورالعمل‌ها تعداد توکن تقریبی را نشان می‌دهد و برای متن طولانی (بیش از حدود ۱۵۰۰ توکن) هشدار می‌دهد.

### Fixed
- **EN:** The AI guidelines optimizer no longer rewrites rules created from reviewer feedback ("Do not report …"). They are filed under the topic of their category (e.g. authorization → Security, governance → Git & Commits) so only the relevant specialist receives them, instead of being merged into General. With "Translate to English" on, their title and reason are translated too (category and rule ids stay unchanged); if the AI returns them malformed, the originals are kept. Without translation they stay word-for-word. In the compact version sent to reviewers, repeated boilerplate in these rules ("in this project", "this is an intentional project convention") is dropped to save tokens. Running the optimizer again on already-optimized text no longer duplicates these rules or leaves empty headings.
- **FA:** بهینه‌ساز دستورالعمل‌های AI دیگر قوانین ساخته‌شده از فیدبک ("Do not report …") را بازنویسی نمی‌کند. این قوانین زیر موضوع دسته‌شان (مثلاً authorization ← Security، governance ← Git & Commits) قرار می‌گیرند تا فقط specialist مربوط آن‌ها را بگیرد، نه اینکه در General ادغام شوند. با روشن بودن «Translate to English» عنوان و دلیل آن‌ها هم به انگلیسی ترجمه می‌شود (دسته و شناسه قانون ثابت می‌ماند)؛ اگر AI خروجی ناقص بدهد، متن اصلی حفظ می‌شود. بدون ترجمه، کلمه‌به‌کلمه می‌مانند. در نسخه فشرده‌ای که به ریویوها می‌رود، عبارت‌های تکراری این قوانین («in this project» و «this is an intentional project convention») برای صرفه‌جویی در توکن حذف می‌شود. اجرای دوباره بهینه‌ساز روی متنِ قبلاً بهینه‌شده دیگر این قوانین را تکراری نمی‌کند و سرتیتر خالی باقی نمی‌گذارد.

## [0.2.38] - 2026-11-03

### Changed
- **EN:** Removed the project **Identity & Deduplication** tab; it only repeated the repository URL and host already shown in the project header. Old `/identity` deep links fall back to the default tab.
- **FA:** تب **Identity & Deduplication** پروژه حذف شد؛ چون فقط آدرس و هاست مخزن را تکرار می‌کرد که از قبل در بالای صفحه پروژه نمایش داده می‌شود. لینک‌های قدیمی `/identity` به تب پیش‌فرض می‌روند.

## [0.2.37] - 2026-11-03

### Fixed
- **EN:** The project **Developers** tab now shows the reviewer's note (and who graded) under each MR grade, plus the reason behind the suggested grade. Before, only the numbers were listed.
- **FA:** تب **Developers** پروژه حالا توضیحی را که ریویوکننده هنگام نمره‌دادن نوشته (و اینکه چه کسی نمره داده) زیر نمره هر MR نشان می‌دهد، به‌همراه دلیل نمره پیشنهادی. قبلاً فقط عددها نمایش داده می‌شد.

## [0.2.36] - 2026-11-03

### Fixed
- **EN:** Reviews started from the Review page are now always linked to their MR, so the grade card shows the system-suggested grade (with its reason) and the author right after the review. Before, the link was missed when the page sent the project id along, and the card showed no suggestion.
- **FA:** ریویوهایی که از صفحه Review شروع می‌شوند حالا همیشه به MR خودشان وصل می‌شوند؛ پس کارت نمره بلافاصله بعد از ریویو نمره پیشنهادی سیستم (با دلیل) و نویسنده را نشان می‌دهد. قبلاً وقتی صفحه شناسه پروژه را هم می‌فرستاد این اتصال از دست می‌رفت و پیشنهادی نمایش داده نمی‌شد.

## [0.2.35] - 2026-11-03

### Fixed
- **EN:** The **Next.js Reviewer** is no longer suggested for plain React projects. It is now selected only on real Next.js evidence (`next/...` imports, `"use client"`/`"use server"`, `getServerSideProps`, `next.config.*`, `app/**/page|layout|route.*`, `pages/_app`), not just because a path contains `app/` or `pages/`.
- **FA:** **Next.js Reviewer** دیگر برای پروژه‌های React ساده پیشنهاد نمی‌شود. فقط با نشانه واقعی Next.js (import از `next/...`، ‏`"use client"`/`"use server"`، ‏`getServerSideProps`، ‏`next.config.*`، ‏`app/**/page|layout|route.*`، ‏`pages/_app`) انتخاب می‌شود، نه صرفاً چون مسیر شامل `app/` یا `pages/` است.

## [0.2.34] - 2026-11-03

### Fixed
- **EN:** **Re-Estimate** on the Review page no longer re-ticks specialists you unticked (e.g. the Next.js reviewer). Your manual selection is kept; only specialists that are new in the estimate are ticked.
- **FA:** دکمه **Re-Estimate** در صفحه Review دیگر متخصص‌هایی را که شما تیکشان را برداشته‌اید (مثل Next.js reviewer) دوباره تیک نمی‌زند. انتخاب دستی شما حفظ می‌شود و فقط متخصص‌های جدیدِ برآورد تیک می‌خورند.

## [0.2.33] - 2026-11-03

### Changed
- **EN:** MR task grades now use a **0 to 10** scale (was 0-100): the grade form, the suggested grade, the per-developer averages (one decimal) and the API (`PUT .../grade` expects an integer 0-10). Existing grades and suggestions are converted automatically once (divided by 10 and rounded). The review's own quality score (0-100) is unchanged.
- **FA:** نمره انجام تسک MR حالا در مقیاس **۰ تا ۱۰** است (قبلاً ۰ تا ۱۰۰): فرم نمره، نمره پیشنهادی، میانگین هر دولوپر (با یک رقم اعشار) و API (مسیر `PUT .../grade` عدد صحیح ۰ تا ۱۰ می‌خواهد). نمره‌ها و پیشنهادهای قبلی یک‌بار خودکار تبدیل می‌شوند (تقسیم بر ۱۰ و گرد). نمره کیفیت خود ریویو (۰ تا ۱۰۰) تغییری نکرده است.

## [0.2.32] - 2026-11-03

### Changed
- **EN:** The AI-usage button is now labelled "Estimate AI usage" / "Re-estimate AI usage" so it is not confused with the cost "Re-Estimate". On the Review page it now sits right under the project box below the MR URL (available before any review is run), and the grade card and button also appear for results restored from an earlier session (the project role is looked up when the result does not carry it).
- **FA:** دکمه تخمین AI حالا «Estimate AI usage» / «Re-estimate AI usage» نام دارد تا با «Re-Estimate» برآورد هزینه اشتباه نشود. در صفحه Review مستقیم زیر باکس پروژه و زیر لینک MR قرار گرفته (قبل از اجرای ریویو هم در دسترس است) و کارت نمره و دکمه برای نتیجه‌هایی که از نشست قبلی بازیابی شده‌اند هم نمایش داده می‌شود (نقش پروژه در صورت نبودن در نتیجه جداگانه گرفته می‌شود).

## [0.2.31] - 2026-11-03

### Added
- **EN:** **AI-written likelihood for an MR.** Reviewers (REVIEWER role and above) get an Estimate / Re-estimate button next to the grade card on the Review page and in the project's MR list. It returns the estimated chance (%) that the MR was written with AI, with reasons, by combining built-in rules (AI Co-Authored-By trailers, "Generated with" markers, comment density, boilerplate comments, emoji, very large changes) with an AI judge reading the diff (your configured AI provider; rules only when none is set). It runs only on click, is saved on the MR, and is independent of the review and cost estimate. It is an estimate from style signals, not proof. Endpoint: `POST /api/projects/:id/merge-requests/:mrId/ai-usage`.
- **FA:** **احتمال نوشته‌شدن MR با AI.** ریویوکننده‌ها (نقش REVIEWER به بالا) کنار کارت نمره در صفحه Review و لیست MR پروژه دکمه Estimate / Re-estimate دارند. این دکمه درصد احتمال نوشته‌شدن MR با AI را همراه دلیل برمی‌گرداند؛ ترکیبی از قوانین داخلی (تریلر Co-Authored-By ابزار AI، عبارت «Generated with»، تراکم کامنت، کامنت‌های قالبی، ایموجی، تغییر بسیار بزرگ) و یک قاضی AI که diff را می‌خواند (با ارائه‌دهنده AI تنظیم‌شده شما؛ اگر نبود فقط قوانین). فقط با کلیک اجرا می‌شود، روی MR ذخیره می‌شود و از ریویو و برآورد هزینه جداست. این برآوردی از روی سبک کد است، نه مدرک. مسیر: `POST /api/projects/:id/merge-requests/:mrId/ai-usage`.

## [0.2.30] - 2026-11-03

### Fixed
- **EN:** The MR author (name, username, avatar) is now fetched as soon as an MR/PR URL is entered on the Review page, using your Git connection token (or your stored Git credential), so it no longer stays "unknown" until a review finishes. If the lookup fails, the server log now says why (check the token and its `read_api` scope). `POST /api/projects/find-or-create` accepts an optional `env` with Git token/base URL.
- **FA:** نویسنده MR (نام، یوزرنیم، آواتار) حالا به‌محض وارد کردن لینک MR/PR در صفحه Review و با توکن اتصال Git (یا credential ذخیره‌شده) گرفته می‌شود و تا پایان ریویو «unknown» نمی‌ماند. اگر دریافت شکست بخورد، لاگ سرور دلیلش را می‌گوید (توکن و scope ‏`read_api` را بررسی کنید). مسیر `POST /api/projects/find-or-create` یک `env` اختیاری شامل توکن/آدرس Git می‌پذیرد.

## [0.2.29] - 2026-11-03

### Added
- **EN:** The Review page now shows a grade card above the results when you review an MR/PR URL: author, system-suggested grade with a short reason, and (for REVIEWER role and above) a form to set the 0-100 task grade. `POST /api/review` now also returns the refreshed `mergeRequest` (with author and suggested grade) and `projectRole`.
- **FA:** صفحه Review حالا هنگام ریویوی لینک MR/PR کارت نمره‌ای بالای نتایج نشان می‌دهد: نویسنده، نمره پیشنهادی سیستم با دلیل کوتاه، و (برای نقش REVIEWER به بالا) فرم ثبت نمره ۰ تا ۱۰۰. خروجی `POST /api/review` حالا `mergeRequest` به‌روز (با نویسنده و نمره پیشنهادی) و `projectRole` را هم برمی‌گرداند.

## [0.2.28] - 2026-11-03

### Added
- **EN:** New **Developers** tab in each project: lists MR/PR authors with MR count, graded count, average reviewer grade and average suggested grade. Expand a developer to see their MRs, grades and a Review MR shortcut. Deep link: `#/projects/<id>/developers`.
- **FA:** تب جدید **Developers (توسعه‌دهندگان)** در هر پروژه: نویسندگان MR/PR را با تعداد MR، تعداد نمره‌داده‌شده‌ها، میانگین نمره ریویوکننده و میانگین نمره پیشنهادی نشان می‌دهد. با باز کردن هر دولوپر، MRها، نمره‌ها و میان‌بر Review MR دیده می‌شود. لینک مستقیم: `#/projects/<id>/developers`.

## [0.2.27] - 2026-11-03

### Added
- **EN:** **MR task grades.** Each merge request in a project now shows its author (name and username fetched from GitLab/GitHub at review time) and a task-completion grade from 0 to 100. Reviewers (REVIEWER role and above) set the grade with an optional short note, can edit or remove it, and the system suggests a grade with a short reason from the latest review (based on accepted issue severity). A strip above the list shows each developer's MR count and average grade. Authors are kept in a developer registry separate from app login users — no account is created automatically. Endpoints: `PUT/DELETE /api/projects/:id/merge-requests/:mrId/grade`, `GET /api/projects/:id/developers`. Private repositories need a Git token for the author lookup; without one the MR simply has no author.
- **FA:** **نمره انجام تسک برای MR.** هر Merge Request در پروژه حالا نویسنده (نام و یوزرنیم که هنگام ریویو از GitLab/GitHub گرفته می‌شود) و نمره انجام تسک از ۰ تا ۱۰۰ را نشان می‌دهد. ریویوکننده (نقش REVIEWER به بالا) نمره را با توضیح کوتاه اختیاری ثبت، ویرایش یا حذف می‌کند و سیستم هم بر اساس شدت یافته‌های پذیرفته‌شده آخرین ریویو، نمره‌ای پیشنهادی همراه دلیل کوتاه می‌دهد. نواری بالای لیست، تعداد MR و میانگین نمره هر دولوپر را نشان می‌دهد. نویسندگان در یک رجیستری جدا از کاربران ورود به اپ نگه‌داری می‌شوند — حسابی به‌صورت خودکار ساخته نمی‌شود. مسیرها: `PUT/DELETE /api/projects/:id/merge-requests/:mrId/grade` و `GET /api/projects/:id/developers`. برای ریپوهای خصوصی، دریافت نویسنده به توکن Git نیاز دارد؛ بدون آن MR فقط بدون نویسنده می‌ماند.

## [0.2.26] - 2026-11-02

### Changed
- **EN:** The server now listens on port `4000` by default (was `3000`), including the Docker image (`ENV PORT=4000`, `EXPOSE 4000`). Open http://localhost:4000. `PORT` and `--port` still override it.
- **FA:** سرور اکنون به‌صورت پیش‌فرض روی پورت `4000` اجرا می‌شود (قبلاً `3000`)، از جمله در ایمیج Docker (‏`ENV PORT=4000`، `EXPOSE 4000`). آدرس http://localhost:4000 را باز کنید. متغیر `PORT` و آرگومان `--port` همچنان آن را تغییر می‌دهند.

## [0.2.25] - 2026-11-02

### Added
- **EN:** New **Scan** tab in each project: choose a branch (or tag/commit) and scan every text file with the built-in multi-language rules — no AI, no tokens, runs as a background job you can cancel. The report lists findings by severity, file and rule with filters, a JSON download and a history of past scans (latest report kept per branch). Lines flagged as secrets are never stored in the report. Endpoints: `GET/POST /api/projects/:id/scan`, `DELETE /api/projects/:id/scan/job` (start/cancel need project manager rights; reading needs view access).
- **FA:** تب جدید **Scan** در هر پروژه: یک برنچ (یا تگ/کامیت) انتخاب کنید و همه فایل‌های متنی با قوانین چندزبانه داخلی اسکن می‌شوند — بدون AI و بدون توکن، به‌صورت job پس‌زمینه قابل لغو. گزارش یافته‌ها را بر اساس شدت، فایل و قانون با فیلتر، دانلود JSON و تاریخچه اسکن‌ها نشان می‌دهد (آخرین گزارش هر برنچ نگه داشته می‌شود). خطوطی که secret تشخیص داده شده‌اند هرگز در گزارش ذخیره نمی‌شوند. مسیرها: `GET/POST /api/projects/:id/scan` و `DELETE /api/projects/:id/scan/job` (شروع/لغو نیاز به دسترسی مدیر پروژه دارد؛ مشاهده نیاز به دسترسی مشاهده).

## [0.2.24] - 2026-11-02

### Added
- **EN:** **Rules-only (no AI) review.** A new "Rules only (no AI)" checkbox on the Review page runs just the deterministic checks — no AI provider, no tokens, instant. Rules now cover many languages: Python (unsafe `pickle`/`yaml.load`, `shell=True`, bare `except`, mutable defaults, `print`), Java/Kotlin (`System.out`, MD5/SHA-1, `Runtime.exec`, `!!`), C# (`Console`, MD5/SHA-1, empty catch), PHP (`var_dump`, `unserialize`, `mysql_*`, shell functions), Go, Swift, shell (`curl | sh`, `chmod 777`), Dockerfile (`:latest`), plus disabled-TLS-verification and SQL built with f-strings/`.format`. JS/TS-only rules (`console`, `any`, `debugger`, `.only`) no longer fire on other languages. The API accepts `selectedSpecialists: []` and returns `mode: "rules-only"`.
- **FA:** **ریویو فقط با قوانین (بدون AI).** چک‌باکس جدید «Rules only (no AI)» در صفحه Review فقط بررسی‌های قطعی را اجرا می‌کند — بدون ارائه‌دهنده AI، بدون مصرف توکن و فوری. قوانین حالا زبان‌های مختلف را پوشش می‌دهند: Python (‏`pickle`/`yaml.load` ناامن، `shell=True`، `except` خالی، آرگومان پیش‌فرض تغییرپذیر، `print`)، Java/Kotlin (‏`System.out`، MD5/SHA-1، `Runtime.exec`، `!!`)، C# (‏`Console`، MD5/SHA-1، catch خالی)، PHP (‏`var_dump`، `unserialize`، `mysql_*`، توابع shell)، Go، Swift، شل (‏`curl | sh`، `chmod 777`)، Dockerfile (‏`:latest`)، و نیز خاموش‌کردن اعتبارسنجی TLS و SQL ساخته‌شده با f-string/‏`.format`. قوانین مخصوص JS/TS (‏`console`، `any`، `debugger`، `.only`) دیگر روی زبان‌های دیگر اجرا نمی‌شوند. API مقدار `selectedSpecialists: []` را می‌پذیرد و `mode: "rules-only"` برمی‌گرداند.
- **EN:** Optional governance checks (off by default): set `AI_REVIEW_GOVERNANCE_RULES=1` and reviews of GitLab MR / GitHub PR URLs also check that the source branch name (`feat/...`, `fix/...`) and the MR/PR title follow Conventional Commits. Findings are low severity and need no AI.
- **FA:** بررسی‌های اختیاری حاکمیتی (به‌صورت پیش‌فرض خاموش): با تنظیم `AI_REVIEW_GOVERNANCE_RULES=1` در ریویوی لینک MR گیت‌لب / PR گیت‌هاب، نام برنچ مبدأ (`feat/...`، `fix/...`) و عنوان MR/PR هم از نظر انطباق با Conventional Commits بررسی می‌شود. یافته‌ها شدت پایین دارند و به AI نیاز ندارند.

### Fixed
- **EN:** The built-in rule checks (no AI: secrets, `console`, `any`, SQL injection, …) now look only at lines added or changed in the diff, so existing untouched code is no longer reported. Several findings of the same rule in one file (different lines) are now kept as separate issues instead of being merged into one.
- **FA:** بررسی‌های قطعی داخلی (بدون AI: رمز/کلید، `console`، `any`، SQL injection و …) حالا فقط خطوط اضافه‌شده یا تغییرکرده در diff را بررسی می‌کنند و کد قدیمیِ دست‌نخورده گزارش نمی‌شود. چند یافته از یک قانون در یک فایل (در خطوط مختلف) دیگر در یک issue ادغام نمی‌شوند.

## [0.2.23] - 2026-11-02

### Added
- **EN:** Review & Publish cards have a Feedback section: 👍 Useful / 👎 Not useful with a reason and note. A checkbox "Add to project rules" (editable text) appends the rule to the project's instructions under "Learned from reviewer feedback:", so the AI follows it in every later review. Rejections not promoted to rules are still fed to the next reviews of that project (last 10). Only project managers can change rules; others' feedback is saved without it. New endpoint: `POST /api/projects/:id/feedback`.
- **FA:** کارت‌های Review & Publish بخش بازخورد دارند: 👍 مفید / 👎 بی‌فایده همراه با دلیل و توضیح. چک‌باکس «افزودن به قوانین پروژه» (با متن قابل ویرایش) قانون را زیر عنوان «Learned from reviewer feedback:» به دستورهای پروژه اضافه می‌کند تا AI در همه ریویوهای بعدی رعایتش کند. یافته‌های ردشده‌ای که به قانون تبدیل نشوند هم (۱۰ مورد آخر) به ریویوهای بعدی همان پروژه داده می‌شوند. فقط مدیران پروژه می‌توانند قوانین را تغییر دهند؛ بازخورد بقیه بدون آن ذخیره می‌شود. مسیر جدید: `POST /api/projects/:id/feedback`.

## [0.2.22] - 2026-11-01

### Fixed
- **EN:** "Review MR" in a project's MRs tab (and "Open saved result" in Review History) now opens the latest saved review of that MR, with a note showing when it ran, instead of an unrelated or empty result. Saved results live in this browser's review history (last 50).
- **FA:** دکمه «Review MR» در تب MRهای پروژه (و «Open saved result» در Review History) حالا آخرین ریویو ذخیره‌شده همان MR را همراه با زمان اجرایش باز می‌کند، نه نتیجه نامرتبط یا خالی. نتایج ذخیره‌شده در تاریخچه ریویو همین مرورگر هستند (۵۰ مورد آخر).

## [0.2.21] - 2026-11-01

### Added
- **EN:** Each Review & Publish card has an "Open in Git" link to the same file and line on the source branch in GitLab (or the MR changes page when the API is not reachable). `POST /api/code-context` now also returns `links`.
- **FA:** هر کارت Review & Publish یک لینک «Open in Git» دارد که همان فایل و خط را روی branch مبدأ در GitLab باز می‌کند (یا صفحه تغییرات MR اگر API در دسترس نباشد). مسیر `POST /api/code-context` حالا `links` هم برمی‌گرداند.

## [0.2.20] - 2026-11-01

### Fixed
- **EN:** Reviews now warn clearly when no AI provider is connected (only deterministic rules ran) or when AI specialists failed, instead of silently showing partial results. `POST /api/review` returns `llmConfigured` and `errors`.
- **FA:** ریویو حالا وقتی به هیچ AI وصل نیست (فقط قوانین قطعی اجرا شده‌اند) یا ارزیاب‌های AI شکست خورده‌اند، به‌جای نمایش بی‌صدای نتیجه ناقص، هشدار واضح می‌دهد. مسیر `POST /api/review` فیلدهای `llmConfigured` و `errors` را برمی‌گرداند.
- **EN:** Review & Publish code preview now explains why code is missing (e.g. no Git token, file not found) and falls back to the review's own diff.
- **FA:** پیش‌نمایش کد در Review & Publish دلیل نیامدن کد را نشان می‌دهد (مثلاً نبود توکن Git یا پیدا نشدن فایل) و به دیف خود ریویو برمی‌گردد.

## [0.2.19] - 2026-11-01

### Added
- **EN:** Review & Publish: each finding card now shows the flagged code (from the MR source branch, or from the pasted diff), the full description and confidence that go into the PR comment, and an exact preview of the comment. Persian comments render right-to-left.
- **FA:** Review & Publish: هر کارت حالا کد مشکل‌دار (از branch مبدأ MR یا از دیف واردشده)، توضیح کامل و درصد اطمینانی که در کامنت PR می‌رود و پیش‌نمایش دقیق کامنت را نشان می‌دهد. کامنت‌های فارسی راست‌چین نمایش داده می‌شوند.
- **EN:** "Get AI sample fix" button (MR URLs, GitLab): asks the configured AI for a corrected snippet, with Copy, Regenerate and "Commit to branch" (creates a real commit on the MR source branch after confirmation; refuses if the lines changed since). New endpoints: `POST /api/code-context`, `/api/suggest-code`, `/api/commit-suggestion`.
- **FA:** دکمه «دریافت کد نمونه از AI» (آدرس MR، GitLab): از AI تنظیم‌شده یک تکه کد اصلاح‌شده می‌گیرد، با امکان کپی، تولید مجدد و «کامیت روی branch» (پس از تأیید، یک کامیت واقعی روی branch مبدأ MR می‌سازد؛ اگر خطوط تغییر کرده باشند رد می‌کند). مسیرهای جدید: `POST /api/code-context`، `/api/suggest-code` و `/api/commit-suggestion`.

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
