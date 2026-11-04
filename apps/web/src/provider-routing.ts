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
    });
  }
  if (!tiers.has("mid")) {
    notices.push({
      kind: "warning",
      text: `No enabled provider has the mid tier, so most reviewers will use the default provider (${defName}).`,
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
      });
    }
  }

  notices.push({
    kind: "info",
    text: "The other enabled providers act as failover when a provider fails, so the review diff may be sent to them.",
  });
  return notices;
}
