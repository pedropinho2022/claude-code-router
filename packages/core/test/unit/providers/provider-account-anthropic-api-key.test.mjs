import assert from "node:assert/strict";
import test from "node:test";
import { standardProviderAccountConnectorForTest } from "@ccr/core/providers/account-service.ts";
import { anthropicProviderPreset } from "@ccr/core/providers/presets/anthropic/index.ts";
import {
  parseAnthropicApiRateLimitHeaders,
  recordClaudeRateLimitHeaders,
  resetClaudeRateLimitSnapshotsForTest
} from "@ccr/core/providers/claude-rate-limit.ts";

function apiRateLimitHeaders() {
  return {
    "anthropic-ratelimit-input-tokens-limit": "50000",
    "anthropic-ratelimit-input-tokens-remaining": "49000",
    "anthropic-ratelimit-input-tokens-reset": "2026-10-19T12:00:30Z",
    "anthropic-ratelimit-requests-limit": "50",
    "anthropic-ratelimit-requests-remaining": "49",
    "anthropic-ratelimit-requests-reset": "2026-10-19T12:00:10Z",
    "anthropic-ratelimit-tokens-limit": "60000",
    "anthropic-ratelimit-tokens-remaining": "59000",
    "anthropic-ratelimit-tokens-reset": "2026-10-19T12:00:30Z",
    "content-type": "application/json"
  };
}

function stubFetch(t, handler) {
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ init, url: String(input) });
    return handler(calls.at(-1));
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
    resetClaudeRateLimitSnapshotsForTest();
  });
  return calls;
}

function testApiKeyConnector(extra = {}) {
  return standardProviderAccountConnectorForTest({
    api_base_url: "https://api.anthropic.com",
    api_key: "sk-ant-api03-test",
    models: ["claude-sonnet-5-5"],
    name: "Anthropic",
    ...extra
  });
}

test("the Anthropic preset enables account balance", () => {
  assert.equal(anthropicProviderPreset.account.enabled, true);
});

test("Anthropic API rate limit headers parse into per-minute windows", () => {
  const snapshot = parseAnthropicApiRateLimitHeaders(new Headers(apiRateLimitHeaders()), 5);
  assert.deepEqual(snapshot.windows.map((window) => [window.id, window.limit, window.remaining, window.resetsAt]), [
    ["requests", 50, 49, "2026-10-19T12:00:10.000Z"],
    ["tokens", 60000, 59000, "2026-10-19T12:00:30.000Z"],
    ["input-tokens", 50000, 49000, "2026-10-19T12:00:30.000Z"]
  ]);
  assert.equal(parseAnthropicApiRateLimitHeaders(new Headers({ "content-type": "application/json" })), undefined);
});

test("an API key account balance is probed with one token and honors extra headers", async (t) => {
  resetClaudeRateLimitSnapshotsForTest();
  const calls = stubFetch(t, () => new Response("{}", { headers: apiRateLimitHeaders(), status: 200 }));

  const result = await testApiKeyConnector({ extraHeaders: { "anthropic-workspace-id": "wrkspc_test" } });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[0].init.headers["x-api-key"], "sk-ant-api03-test");
  assert.equal(calls[0].init.headers["anthropic-workspace-id"], "wrkspc_test");
  assert.equal(JSON.parse(calls[0].init.body).max_tokens, 1);
  assert.doesNotMatch(calls[0].init.body, /Claude Code/);
  const requests = result.meters.find((meter) => meter.id === "requests");
  assert.equal(requests.used, 1);
  assert.equal(requests.remaining, 49);
  assert.equal(requests.unit, "requests");
  assert.equal(result.meters.find((meter) => meter.id === "tokens").limit, 60000);
});

test("an API key account balance prefers limits seen on recent gateway responses", async (t) => {
  resetClaudeRateLimitSnapshotsForTest();
  recordClaudeRateLimitHeaders(new Headers(apiRateLimitHeaders()), () => "Anthropic");
  const calls = stubFetch(t, () => {
    throw new Error("no probe expected");
  });

  const result = await testApiKeyConnector();

  assert.equal(calls.length, 0);
  assert.equal(result.meters.find((meter) => meter.id === "requests").remaining, 49);
});
