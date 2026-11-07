/**
 * Pure helpers that explain, in Settings, how reviewers are routed across
 * several enabled AI providers. Mirrors CheapestFirstRouter (packages/llm):
 * an agent asks for a tier (Security = premium, Code Reviewer = cheap, others
 * = mid); the default provider wins inside its own tier, and serves everything
 * no provider of the wanted tier can take.
 */

export interface RoutingProvider {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly tier?: string | undefined;
  readonly enabled?: boolean | undefined;
}

export interface RoutingNotice {
  readonly kind: "warning" | "info";
  readonly text: string;
  /** Plain-language Persian version, shown under `text`. */
  readonly textFa: string;
}

/**
 * The server falls back to the preset's tier when an entry has none
 * (provider-catalog.ts `defaultTier`). The web app does not import that
 * catalog, so only the one non-"cheap" preset is mirrored here.
 */
const PRESET_DEFAULT_TIER: Record<string, string> = { openrouter: "mid" };

export function effectiveTier(p: RoutingProvider): string {
  return p.tier || PRESET_DEFAULT_TIER[p.provider] || "cheap";
}

export function routingNotices<T extends RoutingProvider>(
  providers: readonly T[],
  defaultId: string | undefined,
  describe: (p: T) => string = (p) => p.model || p.provider,
  presetModel: (p: T) => string = (p) => p.model,
): RoutingNotice[] {
  const enabled = providers.filter((p) => p.enabled !== false);
  if (enabled.length < 2) return [];

  // Same lookup as buildEnvOverrides: older configs store the type, not an id.
  const def =
    enabled.find((p) => p.id === defaultId || p.provider === defaultId) ??
    enabled[0]!;
  const defName = describe(def);
  const notices: RoutingNotice[] = [];

  const tiers = new Set(enabled.map(effectiveTier));
  if (!tiers.has("premium")) {
    notices.push({
      kind: "warning",
      text: `No enabled provider has the premium tier, so the Security Reviewer will use the default provider (${defName}).`,
      textFa: `هیچ مدل قوی‌ای (Tier: Premium) نداری، پس بررسی امنیتی کد هم با مدل پیش‌فرض (${defName}) انجام می‌شود. review کار می‌کند؛ ولی اگر بررسی امنیتی دقیق‌تری می‌خواهی، Tier یک مدل قوی را Premium بگذار.`,
    });
  }
  if (!tiers.has("mid")) {
    notices.push({
      kind: "warning",
      text: `No enabled provider has the mid tier, so most reviewers will use the default provider (${defName}).`,
      textFa: `هیچ مدلی با سطح متوسط (Tier: Mid) نداری، پس بیشتر بررسی‌ها با مدل پیش‌فرض (${defName}) انجام می‌شود. review کار می‌کند؛ اگر می‌خواهی این بررسی‌ها با مدل دیگری انجام شود، Tier آن مدل را Mid بگذار.`,
    });
  }

  // Same model id on two entries: the earlier (default first) one is used.
  const ordered = [def, ...enabled.filter((p) => p !== def)];
  const firstByModel = new Map<string, T>();
  for (const p of ordered) {
    const model = presetModel(p);
    if (!model) continue;
    const first = firstByModel.get(model);
    if (!first) {
      firstByModel.set(model, p);
    } else {
      notices.push({
        kind: "warning",
        text: `${describe(first)} and ${describe(p)} both use model "${model}": the earlier entry is used and the other is only a failover.`,
        textFa: `«${describe(first)}» و «${describe(p)}» هر دو یک مدل دارند. همیشه اولی استفاده می‌شود و دومی فقط وقتی به کار می‌آید که اولی خطا بدهد.`,
      });
    }
  }

  notices.push({
    kind: "info",
    text: "The other enabled providers act as failover when a provider fails, so the review diff may be sent to them.",
    textFa:
      "اگر یک provider خطا بدهد، review خودکار با provider فعال بعدی ادامه پیدا می‌کند. پس کد تو ممکن است به آن provider هم فرستاده شود. اگر این را نمی‌خواهی، آن provider را غیرفعال کن.",
  });
  return notices;
}
