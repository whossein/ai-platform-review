/**
 * Localized messages for the deterministic rules. Every rule id has an English
 * and a Persian text; the language follows `AI_REVIEW_COMMENT_LANGUAGE` (via
 * `resolveCommentLanguage`) so rule findings match the AI reviewers' language.
 * Anything that is not Persian reports in English.
 */

import { resolveCommentLanguage } from "@ai-review/shared";

export type RuleLanguage = "en" | "fa";

/** Dynamic values some messages embed (MR title, branch name). */
export interface RuleMessageParams {
  readonly title?: string;
  readonly branch?: string;
}

type MessageText = string | ((p: RuleMessageParams) => string);

/** Maps a resolved comment language (a name or short code) to a rule language. */
export function toRuleLanguage(language: string | undefined): RuleLanguage {
  const v = (language ?? "").trim().toLowerCase();
  return v === "fa" || v.startsWith("persian") || v.startsWith("farsi")
    ? "fa"
    : "en";
}

/** The rule-message language for an environment (Persian by default, like the AI comments). */
export function ruleLanguageFromEnv(
  env: Record<string, string | undefined> = process.env,
): RuleLanguage {
  return toRuleLanguage(resolveCommentLanguage(env));
}

export const RULE_MESSAGES: Readonly<
  Record<string, { readonly en: MessageText; readonly fa: MessageText }>
> = {
  "secret.hardcoded": {
    en: "Possible hardcoded secret; move it to an environment variable or secret store.",
    fa: "احتمالاً یک راز (کلید یا رمز) مستقیم در کد نوشته شده است؛ آن را به متغیر محیطی یا مخزن رازها منتقل کنید.",
  },
  "no-console": {
    en: "Leftover console statement; remove it or use a proper logger.",
    fa: "دستور console باقی‌مانده است؛ آن را حذف کنید یا از یک logger مناسب استفاده کنید.",
  },
  "no-debugger": {
    en: "Unexpected `debugger` statement found.",
    fa: "دستور `debugger` باقی‌مانده است؛ پیش از ادغام آن را حذف کنید.",
  },
  "no-eval": {
    en: "Avoid `eval()`/`exec()` on dynamic input. It is a major security risk and hurts performance.",
    fa: "از `eval()`/`exec()` روی ورودی پویا استفاده نکنید؛ ریسک امنیتی جدی دارد و به کارایی هم آسیب می‌زند.",
  },
  "no-exclusive-tests": {
    en: "Exclusive or skipped test found (e.g. `.only` or `.skip`). Ensure this is intentional before merging.",
    fa: "تست انحصاری یا نادیده‌گرفته‌شده (مثلاً `.only` یا `.skip`) پیدا شد؛ پیش از ادغام مطمئن شوید این کار عمدی است.",
  },
  "no-explicit-any": {
    en: "Use of `any` disables type checking; use a precise type or `unknown`.",
    fa: "استفاده از `any` بررسی نوع را غیرفعال می‌کند؛ از یک نوع دقیق یا `unknown` استفاده کنید.",
  },
  "no-todo-comment": {
    en: "Unresolved TODO/FIXME marker; track it in an issue before merging.",
    fa: "نشانگر TODO/FIXME هنوز باز است؛ پیش از ادغام آن را در یک issue پیگیری کنید.",
  },
  "no-alert": {
    en: "Blocking dialogs (alert/confirm/prompt) are not allowed by the coding standards.",
    fa: "استفاده از توابع مسدودکننده (alert/confirm/prompt) طبق استانداردهای کدنویسی مجاز نیست.",
  },
  "governance.require-release-change": {
    en: "Per this project's saved guidelines, every source change must be recorded in the changelog (CHANGELOG or release-change), but no such file was edited in this change.",
    fa: "طبق راهنمای ذخیره‌شده‌ی این پروژه، هر تغییر در سورس‌کد باید در گزارش تغییرات (CHANGELOG یا release-change) ثبت شود، اما هیچ فایلی از این نوع در این تغییرات ویرایش نشده است.",
  },
  "governance.commit-convention": {
    en: (p) =>
      `MR/PR title "${p.title ?? ""}" does not follow Conventional Commits (e.g. "feat: ..." or "fix(scope): ...").`,
    fa: (p) =>
      `عنوان MR/PR با عنوان «${p.title ?? ""}» از قالب Conventional Commits پیروی نمی‌کند (مثلاً "feat: ..." یا "fix(scope): ...").`,
  },
  "governance.branch-naming": {
    en: (p) =>
      `Branch "${p.branch ?? ""}" does not match the naming convention (e.g. feat/name or fix/issue-123).`,
    fa: (p) =>
      `نام شاخه‌ی «${p.branch ?? ""}» با قاعده‌ی نام‌گذاری همخوانی ندارد (مثلاً feat/name یا fix/issue-123).`,
  },
  "security.sql-injection": {
    en: "SQL query is built with string concatenation or interpolation; use parameterized queries / prepared statements.",
    fa: "کوئری SQL با الحاق یا درون‌یابی رشته ساخته شده است؛ از کوئری‌های پارامتری (prepared statement) استفاده کنید.",
  },
  "security.wildcard-cors": {
    en: "CORS allows every origin; restrict it to an explicit allow-list of trusted origins.",
    fa: "CORS همه‌ی مبداها را مجاز می‌کند؛ آن را به فهرست مشخصی از مبداهای مورد اعتماد محدود کنید.",
  },
  "security.prompt-injection": {
    en: "This line looks like an instruction aimed at AI reviewers (prompt injection). Remove it; review rules belong in the project's saved guidelines, not in the change.",
    fa: "این خط شبیه دستوری برای بازبین‌های هوش مصنوعی است (تزریق پرامپت). آن را حذف کنید؛ قوانین بازبینی باید در راهنمای ذخیره‌شده‌ی پروژه باشند، نه در خود تغییر.",
  },
  "security.js-command-exec": {
    en: "`child_process.exec` runs a dynamically built command through a shell, so untrusted input allows command injection. Use `execFile`/`spawn` with an argument array.",
    fa: "`child_process.exec` فرمانی را که به‌صورت پویا ساخته شده از طریق shell اجرا می‌کند و ورودی نامطمئن می‌تواند به تزریق فرمان بینجامد؛ از `execFile`/`spawn` با آرایه‌ی آرگومان‌ها استفاده کنید.",
  },
  "security.tls-verify-disabled": {
    en: "TLS certificate verification is disabled; this allows man-in-the-middle attacks.",
    fa: "اعتبارسنجی گواهی TLS غیرفعال شده است؛ این کار حمله‌ی مرد میانی را ممکن می‌کند.",
  },
  "py.unsafe-deserialization": {
    en: "Unsafe deserialization can execute arbitrary code; use json or yaml.safe_load for untrusted data.",
    fa: "بازسازی ناایمن داده‌ها می‌تواند کد دلخواه اجرا کند؛ برای داده‌ی نامطمئن از json یا yaml.safe_load استفاده کنید.",
  },
  "py.subprocess-shell": {
    en: "Running commands through a shell allows command injection; pass an argument list without shell=True.",
    fa: "اجرای فرمان از طریق shell امکان تزریق فرمان را فراهم می‌کند؛ فهرست آرگومان‌ها را بدون shell=True بدهید.",
  },
  "py.bare-except": {
    en: "Bare `except:` also swallows KeyboardInterrupt/SystemExit; catch a specific exception.",
    fa: "`except:` بدون نوع، KeyboardInterrupt/SystemExit را هم می‌بلعد؛ یک استثنای مشخص را بگیرید.",
  },
  "py.mutable-default-arg": {
    en: "Mutable default argument is shared between calls; default to None and create it inside the function.",
    fa: "آرگومان پیش‌فرض تغییرپذیر بین فراخوانی‌ها مشترک است؛ مقدار پیش‌فرض را None بگذارید و آن را داخل تابع بسازید.",
  },
  "py.no-print": {
    en: "Leftover print statement; use the logging module.",
    fa: "دستور print باقی‌مانده است؛ از ماژول logging استفاده کنید.",
  },
  "java.no-system-out": {
    en: "Leftover System.out/printStackTrace; use a logger.",
    fa: "System.out/printStackTrace باقی‌مانده است؛ از یک logger استفاده کنید.",
  },
  "java.weak-hash": {
    en: "MD5/SHA-1 are broken for security use; use SHA-256 or stronger (bcrypt/argon2 for passwords).",
    fa: "MD5/SHA-1 برای مصارف امنیتی شکسته‌اند؛ از SHA-256 یا قوی‌تر استفاده کنید (برای رمز عبور bcrypt/argon2).",
  },
  "java.runtime-exec": {
    en: "Runtime.exec with dynamic input risks command injection; validate input or use ProcessBuilder with fixed arguments.",
    fa: "Runtime.exec با ورودی پویا خطر تزریق فرمان دارد؛ ورودی را اعتبارسنجی کنید یا از ProcessBuilder با آرگومان‌های ثابت استفاده کنید.",
  },
  "jvm-cs.empty-catch": {
    en: "Empty catch block silently swallows errors; handle or log the exception.",
    fa: "بلوک catch خالی خطاها را بی‌صدا می‌بلعد؛ استثنا را مدیریت یا ثبت کنید.",
  },
  "cs.no-console": {
    en: "Leftover Console output; use ILogger.",
    fa: "خروجی Console باقی‌مانده است؛ از ILogger استفاده کنید.",
  },
  "cs.weak-hash": {
    en: "MD5/SHA-1 are broken for security use; use SHA-256 or stronger.",
    fa: "MD5/SHA-1 برای مصارف امنیتی شکسته‌اند؛ از SHA-256 یا قوی‌تر استفاده کنید.",
  },
  "php.debug-output": {
    en: "Leftover debug output; remove it before merging.",
    fa: "خروجی دیباگ باقی‌مانده است؛ پیش از ادغام آن را حذف کنید.",
  },
  "php.unsafe-function": {
    en: "Dangerous or removed PHP function (unserialize/shell exec/mysql_*); use safe alternatives (json, escapeshellarg, PDO).",
    fa: "تابع خطرناک یا حذف‌شده‌ی PHP (unserialize/shell exec/mysql_*)؛ از جایگزین‌های ایمن (json، escapeshellarg، PDO) استفاده کنید.",
  },
  "go.no-print": {
    en: "Leftover fmt.Print; use a structured logger.",
    fa: "fmt.Print باقی‌مانده است؛ از یک logger ساخت‌یافته استفاده کنید.",
  },
  "kt.not-null-assertion": {
    en: "`!!` throws NullPointerException; handle null with ?: or safe calls.",
    fa: "`!!` باعث NullPointerException می‌شود؛ null را با ?: یا فراخوانی ایمن مدیریت کنید.",
  },
  "swift.force-unwrap": {
    en: "Forced `try!`/`as!` crashes at runtime on failure; use do/catch or conditional casts.",
    fa: "`try!`/`as!` اجباری در صورت شکست در زمان اجرا کرش می‌کند؛ از do/catch یا تبدیل شرطی استفاده کنید.",
  },
  "sh.curl-pipe-shell": {
    en: "Piping a download into a shell runs unverified code; download, verify a checksum, then execute.",
    fa: "هدایت مستقیم دانلود به shell کد تأییدنشده اجرا می‌کند؛ ابتدا دانلود کنید، checksum را بررسی کنید و بعد اجرا کنید.",
  },
  "sh.chmod-777": {
    en: "World-writable permissions (777) are unsafe; grant the minimum required mode.",
    fa: "دسترسی نوشتن برای همه (777) ناامن است؛ فقط حداقل دسترسی لازم را بدهید.",
  },
  "docker.latest-tag": {
    en: "Base image uses the `latest` tag; pin a specific version or digest for reproducible builds.",
    fa: "تصویر پایه از تگ `latest` استفاده می‌کند؛ برای ساخت‌های تکرارپذیر یک نسخه یا digest مشخص را ثابت کنید.",
  },
};

/**
 * The message for a rule in the given language (English when omitted or not
 * Persian). Unknown ids return the id so a missing entry is visible, not blank.
 */
export function ruleMessage(
  ruleId: string,
  language?: string,
  params: RuleMessageParams = {},
): string {
  const entry = RULE_MESSAGES[ruleId];
  if (!entry) return ruleId;
  const text = entry[toRuleLanguage(language)];
  return typeof text === "function" ? text(params) : text;
}
