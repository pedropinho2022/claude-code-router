// Claude subscription quota (5h / 7d) read from the `anthropic-ratelimit-unified-*`
// response headers. Tokens without the `user:profile` scope (e.g. the long-lived
// `claude setup-token`) cannot read /api/oauth/usage, but every inference response
// still carries these headers.

const headerPrefix = "anthropic-ratelimit-unified-";

export type ClaudeRateLimitWindow = {
  resetsAt?: string;
  utilization: number;
};

export type ClaudeRateLimitSnapshot = {
  capturedAt: number;
  fiveHour?: ClaudeRateLimitWindow;
  sevenDay?: ClaudeRateLimitWindow;
  status?: string;
};

const snapshots = new Map<string, ClaudeRateLimitSnapshot>();

export function parseClaudeRateLimitHeaders(headers: Headers, now = Date.now()): ClaudeRateLimitSnapshot | undefined {
  const fiveHour = readWindow(headers, "5h");
  const sevenDay = readWindow(headers, "7d");
  if (!fiveHour && !sevenDay) {
    return undefined;
  }
  const status = headers.get(`${headerPrefix}status`)?.trim() || undefined;
  return { capturedAt: now, fiveHour, sevenDay, status };
}

// The provider name is resolved lazily: every gateway response passes through
// here, and only Anthropic subscription responses carry these headers.
export function recordClaudeRateLimitHeaders(headers: Headers, providerName: () => string | undefined): void {
  const snapshot = parseClaudeRateLimitHeaders(headers);
  const key = snapshot ? providerKey(providerName()) : undefined;
  if (snapshot && key) {
    snapshots.set(key, snapshot);
  }
}

export function recordClaudeRateLimitSnapshot(providerName: string | undefined, snapshot: ClaudeRateLimitSnapshot): void {
  const key = providerKey(providerName);
  if (key) {
    snapshots.set(key, snapshot);
  }
}

export function latestClaudeRateLimitSnapshot(providerName: string | undefined, maxAgeMs: number, now = Date.now()): ClaudeRateLimitSnapshot | undefined {
  const key = providerKey(providerName);
  const snapshot = key ? snapshots.get(key) : undefined;
  return snapshot && now - snapshot.capturedAt <= maxAgeMs ? snapshot : undefined;
}

export function resetClaudeRateLimitSnapshotsForTest(): void {
  snapshots.clear();
}

// Same shape as /api/oauth/usage, so the existing Claude Code account mapping
// (`$.five_hour.utilization`, `$.five_hour.resets_at`, ...) reads it unchanged.
export function claudeUsagePayloadFromRateLimit(snapshot: ClaudeRateLimitSnapshot): Record<string, unknown> {
  return {
    ...(snapshot.fiveHour ? { five_hour: usageWindow(snapshot.fiveHour) } : {}),
    ...(snapshot.sevenDay ? { seven_day: usageWindow(snapshot.sevenDay) } : {})
  };
}

function usageWindow(window: ClaudeRateLimitWindow): Record<string, unknown> {
  return {
    utilization: Math.round(window.utilization * 10_000) / 100,
    ...(window.resetsAt ? { resets_at: window.resetsAt } : {})
  };
}

function readWindow(headers: Headers, name: "5h" | "7d"): ClaudeRateLimitWindow | undefined {
  const rawUtilization = headers.get(`${headerPrefix}${name}-utilization`)?.trim();
  const utilization = Number(rawUtilization);
  if (!rawUtilization || !Number.isFinite(utilization)) {
    return undefined;
  }
  const reset = Number(headers.get(`${headerPrefix}${name}-reset`));
  return {
    resetsAt: Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : undefined,
    utilization: Math.min(1, Math.max(0, utilization))
  };
}

function providerKey(providerName: string | undefined): string | undefined {
  const key = providerName?.trim().toLowerCase();
  return key || undefined;
}
