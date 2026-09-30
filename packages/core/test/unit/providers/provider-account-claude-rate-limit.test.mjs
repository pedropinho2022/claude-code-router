import assert from "node:assert/strict";
import test from "node:test";
import { claudeCodeProviderAccountConfig } from "@ccr/core/agents/local-providers/claude-code.ts";
import { testProviderAccountConnector } from "@ccr/core/providers/account-service.ts";
import {
  parseClaudeRateLimitHeaders,
  recordClaudeRateLimitHeaders,
  resetClaudeRateLimitSnapshotsForTest
} from "@ccr/core/providers/claude-rate-limit.ts";

const usageEndpoint = "https://api.anthropic.com/api/oauth/usage";
const messagesEndpoint = "https://api.anthropic.com/v1/messages";
const missingScopeBody = JSON.stringify({
  error: { message: "OAuth token does not meet scope requirement user:profile", type: "permission_error" },
  type: "error"
});

function rateLimitHeaders() {
  return {
    "anthropic-ratelimit-unified-5h-reset": "1790821800",
    "anthropic-ratelimit-unified-5h-utilization": "0.0",
    "anthropic-ratelimit-unified-7d-reset": "1790960400",
    "anthropic-ratelimit-unified-7d-utilization": "0.32",
    "anthropic-ratelimit-unified-status": "allowed",
    "content-type": "application/json"
  };
}

function stubFetch(t, handler) {
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const call = { init, url: String(input) };
    calls.push(call);
    return handler(call);
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
    resetClaudeRateLimitSnapshotsForTest();
  });
  return calls;
}

function testClaudeConnector() {
  return testProviderAccountConnector({
    apiKey: "sk-ant-oat01-long-lived",
    baseUrl: "https://api.anthropic.com",
    connector: claudeCodeProviderAccountConfig().connectors[0],
    providerName: "Claude Code API"
  });
}

test("Claude rate limit headers parse into fractional windows with ISO resets", () => {
  const snapshot = parseClaudeRateLimitHeaders(new Headers(rateLimitHeaders()), 1_000);
  assert.deepEqual(snapshot, {
    capturedAt: 1_000,
    fiveHour: { resetsAt: "2026-10-01T02:30:00.000Z", utilization: 0 },
    sevenDay: { resetsAt: "2026-10-02T17:00:00.000Z", utilization: 0.32 },
    status: "allowed"
  });
  assert.equal(parseClaudeRateLimitHeaders(new Headers({ "content-type": "application/json" })), undefined);
});

test("Claude quota falls back to a 1-token probe when the token lacks user:profile", async (t) => {
  resetClaudeRateLimitSnapshotsForTest();
  const calls = stubFetch(t, ({ url }) => url === usageEndpoint
    ? new Response(missingScopeBody, { headers: { "content-type": "application/json" }, status: 403 })
    : new Response("{}", { headers: rateLimitHeaders(), status: 200 }));

  const result = await testClaudeConnector();

  assert.deepEqual(calls.map((call) => call.url), [usageEndpoint, messagesEndpoint]);
  const probe = calls[1];
  assert.equal(probe.init.method, "POST");
  assert.equal(probe.init.headers.authorization, "Bearer sk-ant-oat01-long-lived");
  assert.equal(probe.init.headers["anthropic-beta"], "oauth-2025-04-20");
  assert.equal(JSON.parse(probe.init.body).max_tokens, 1);
  const fiveHour = result.meters.find((meter) => meter.id === "claude_five_hour_quota");
  const sevenDay = result.meters.find((meter) => meter.id === "claude_seven_day_quota");
  assert.equal(fiveHour?.remaining, 100);
  assert.equal(sevenDay?.used, 32);
  assert.equal(sevenDay?.remaining, 68);
  assert.equal(sevenDay?.resetAt, "2026-10-02T17:00:00.000Z");
});

test("Claude quota prefers the rate limit seen on a recent gateway response over a probe", async (t) => {
  resetClaudeRateLimitSnapshotsForTest();
  recordClaudeRateLimitHeaders(new Headers(rateLimitHeaders()), () => "Claude Code API");
  const calls = stubFetch(t, ({ url }) => {
    assert.equal(url, usageEndpoint, "no probe request expected");
    return new Response(missingScopeBody, { headers: { "content-type": "application/json" }, status: 403 });
  });

  const result = await testClaudeConnector();

  assert.equal(calls.length, 1);
  assert.equal(result.meters.find((meter) => meter.id === "claude_seven_day_quota")?.used, 32);
});

test("Claude quota keeps other account endpoint errors", async (t) => {
  resetClaudeRateLimitSnapshotsForTest();
  const calls = stubFetch(t, () => new Response(JSON.stringify({ error: { message: "invalid token" } }), {
    headers: { "content-type": "application/json" },
    status: 401
  }));

  await assert.rejects(testClaudeConnector(), /HTTP 401/);
  assert.equal(calls.length, 1);
});
