import type { GatewayProviderConfig, ProviderAccountLocalEstimateConnectorConfig, ProviderAccountLocalWindowConfig } from "@ccr/core/contracts/app";
import { getUsageTotalsSince } from "@ccr/core/usage/store";
import { localEstimateResetAt, localEstimateWindowStart } from "@ccr/core/usage/budget-window";

/**
 * Spend limits: a local-estimate account window with `unit: "USD"` and
 * `block: true` rejects requests to its provider once the estimated spend of
 * the window (from CCR's own usage log) reaches the limit.
 */
export type ProviderBudgetBlock = {
  limitUsd: number;
  provider: string;
  resetAt: string;
  usedUsd: number;
  windowId: string;
  windowLabel: string;
};

// Usage is read from SQLite; one query per window every few seconds is enough
// because spend is only recorded after each response finishes anyway.
const spendCacheTtlMs = 5_000;
let readUsageTotals: typeof getUsageTotalsSince = getUsageTotalsSince;
const spendCache = new Map<string, { expiresAt: number; usedUsd: number }>();

export function providerBudgetWindows(provider: GatewayProviderConfig): ProviderAccountLocalWindowConfig[] {
  if (!provider.account?.enabled) {
    return [];
  }
  return (provider.account.connectors ?? [])
    .filter((connector): connector is ProviderAccountLocalEstimateConnectorConfig => connector.type === "local-estimate")
    .flatMap((connector) => connector.windows ?? [])
    .filter((window) => window.unit === "USD" && window.block === true && Number(window.limit) > 0 && Boolean(window.id));
}

export async function providerBudgetBlock(
  provider: GatewayProviderConfig | undefined,
  now = new Date()
): Promise<ProviderBudgetBlock | undefined> {
  if (!provider) {
    return undefined;
  }
  for (const window of providerBudgetWindows(provider)) {
    const usedUsd = await windowSpendUsd(provider.name, window, now);
    if (usedUsd >= window.limit) {
      return {
        limitUsd: window.limit,
        provider: provider.name,
        resetAt: localEstimateResetAt(window.window, now).toISOString(),
        usedUsd,
        windowId: window.id,
        windowLabel: window.label || window.id
      };
    }
  }
  return undefined;
}

export function providerBudgetBlockMessage(block: ProviderBudgetBlock): string {
  return `Spend limit reached for provider "${block.provider}": $${block.usedUsd.toFixed(2)} of $${block.limitUsd.toFixed(2)} (${block.windowLabel}). ` +
    `Requests resume after ${block.resetAt} or when the limit is raised.`;
}

export function providerBudgetBlockResponse(block: ProviderBudgetBlock): Response {
  return new Response(JSON.stringify({
    error: {
      code: "budget_exceeded",
      message: providerBudgetBlockMessage(block),
      type: "budget_exceeded"
    },
    type: "error"
  }), {
    headers: { "content-type": "application/json", "x-ccr-budget-exceeded": block.windowId },
    status: 402
  });
}

export function resetProviderBudgetCacheForTest(reader: typeof getUsageTotalsSince = getUsageTotalsSince): void {
  spendCache.clear();
  readUsageTotals = reader;
}

async function windowSpendUsd(
  provider: string,
  window: ProviderAccountLocalWindowConfig,
  now: Date
): Promise<number> {
  const key = `${provider}\u0000${window.id}\u0000${window.window}`;
  const cached = spendCache.get(key);
  if (cached && cached.expiresAt > now.getTime()) {
    return cached.usedUsd;
  }
  const totals = await readUsageTotals(localEstimateWindowStart(window.window, now), { provider });
  const usedUsd = totals.costUsd;
  spendCache.set(key, { expiresAt: now.getTime() + spendCacheTtlMs, usedUsd });
  return usedUsd;
}
