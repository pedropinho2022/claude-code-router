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
const apiSnapshots = new Map<string, AnthropicApiRateLimitSnapshot>();

// Per-minute limits of an Anthropic API key (not a subscription): every response
// carries `anthropic-ratelimit-{requests,tokens,input-tokens,output-tokens}-*`.
const apiRateLimitDefinitions = [
  { id: "requests", label: "Requests per minute", prefix: "requests", unit: "requests" },
  { id: "tokens", label: "Tokens per minute", prefix: "tokens", unit: "tokens" },
  { id: "input-tokens", label: "Input tokens per minute", prefix: "input-tokens", unit: "tokens" },
  { id: "output-tokens", label: "Output tokens per minute", prefix: "output-tokens", unit: "tokens" }
] as const;

export type AnthropicApiRateLimitWindow = {
  id: string;
  label: string;
  limit: number;
  remaining: number;
  resetsAt?: string;
  unit: "requests" | "tokens";
};

export type AnthropicApiRateLimitSnapshot = {
  capturedAt: number;
  windows: AnthropicApiRateLimitWindow[];
};

export function parseAnthropicApiRateLimitHeaders(headers: Headers, now = Date.now()): AnthropicApiRateLimitSnapshot | undefined {
  const windows: AnthropicApiRateLimitWindow[] = [];
  for (const definition of apiRateLimitDefinitions) {
    const limit = Number(headers.get(`anthropic-ratelimit-${definition.prefix}-limit`));
    const rawRemaining = headers.get(`anthropic-ratelimit-${definition.prefix}-remaining`);
    const remaining = Number(rawRemaining);
    if (!Number.isFinite(limit) || limit <= 0 || rawRemaining === null || rawRemaining.trim() === "" || !Number.isFinite(remaining)) {
      continue;
    }
    const reset = headers.get(`anthropic-ratelimit-${definition.prefix}-reset`)?.trim();
    const resetTime = reset ? Date.parse(reset) : Number.NaN;
    windows.push({
      id: definition.id,
      label: definition.label,
      limit,
      remaining: Math.min(limit, Math.max(0, remaining)),
      resetsAt: Number.isFinite(resetTime) ? new Date(resetTime).toISOString() : undefined,
      unit: definition.unit
    });
  }
  return windows.length > 0 ? { capturedAt: now, windows } : undefined;
}

export function recordAnthropicApiRateLimitSnapshot(providerName: string | undefined, snapshot: AnthropicApiRateLimitSnapshot): void {
  const key = providerKey(providerName);
  if (key) {
    apiSnapshots.set(key, snapshot);
  }
}

export function latestAnthropicApiRateLimitSnapshot(providerName: string | undefined, maxAgeMs: number, now = Date.now()): AnthropicApiRateLimitSnapshot | undefined {
  const key = providerKey(providerName);
  const snapshot = key ? apiSnapshots.get(key) : undefined;
  return snapshot && now - snapshot.capturedAt <= maxAgeMs ? snapshot : undefined;
}

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
  const apiSnapshot = parseAnthropicApiRateLimitHeaders(headers);
  const key = snapshot || apiSnapshot ? providerKey(providerName()) : undefined;
  if (snapshot && key) {
    snapshots.set(key, snapshot);
  }
  if (apiSnapshot && key) {
    apiSnapshots.set(key, apiSnapshot);
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
  apiSnapshots.clear();
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
