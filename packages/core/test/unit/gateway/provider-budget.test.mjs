import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultAppConfig } from "@ccr/core/config/default-config.ts";
import {
  providerBudgetBlock,
  providerBudgetBlockMessage,
  providerBudgetWindows,
  resetProviderBudgetCacheForTest
} from "@ccr/core/gateway/limits/provider-budget.ts";
import { localEstimateMeterForTest } from "@ccr/core/providers/account-service.ts";
import { fetchUpstreamWithFallback } from "@ccr/core/gateway/upstream/executor.ts";

function budgetProvider(overrides = {}) {
  return {
    account: {
      connectors: [
        { auth: "provider-api-key", type: "standard" },
        { type: "local-estimate", windows: [{ block: true, id: "monthly-usd", label: "Monthly budget", limit: 200, unit: "USD", window: "monthly" }] }
      ],
      enabled: true
    },
    api_base_url: "https://api.anthropic.com",
    api_key: "sk-ant-api03-test",
    models: ["claude-sonnet-5-5"],
    name: "Budget Anthropic",
    type: "anthropic_messages",
    ...overrides
  };
}

function totals(costUsd) {
  const calls = [];
  const read = async (since, filter) => {
    calls.push({ filter, since });
    return { costUsd };
  };
  return { calls, read };
}

test("only enabled USD windows with block=true are spend limits", () => {
  assert.equal(providerBudgetWindows(budgetProvider()).length, 1);
  assert.equal(providerBudgetWindows(budgetProvider({ account: { ...budgetProvider().account, enabled: false } })).length, 0);
  const notBlocking = budgetProvider();
  notBlocking.account.connectors[1].windows[0].block = false;
  assert.equal(providerBudgetWindows(notBlocking).length, 0);
  const tokens = budgetProvider();
  tokens.account.connectors[1].windows[0].unit = "tokens";
  assert.equal(providerBudgetWindows(tokens).length, 0);
});

test("requests are blocked once the window spend reaches the limit", async () => {
  resetProviderBudgetCacheForTest();
  const now = new Date("2026-10-19T12:00:00Z");
  const under = totals(150.25);
  resetProviderBudgetCacheForTest(under.read);
  assert.equal(await providerBudgetBlock(budgetProvider(), now), undefined);
  assert.equal(under.calls[0].filter.provider, "Budget Anthropic");
  assert.equal(under.calls[0].since.getDate(), 1);

  resetProviderBudgetCacheForTest(totals(200.5).read);
  const block = await providerBudgetBlock(budgetProvider(), now);
  assert.equal(block.limitUsd, 200);
  assert.equal(block.usedUsd, 200.5);
  assert.match(providerBudgetBlockMessage(block), /\$200\.50 of \$200\.00 \(Monthly budget\)/);
  assert.equal(await providerBudgetBlock(undefined, now), undefined);
});

test("spend reads are cached briefly", async () => {
  const source = totals(1);
  resetProviderBudgetCacheForTest(source.read);
  const now = new Date("2026-10-19T12:00:00Z");
  await providerBudgetBlock(budgetProvider(), now);
  await providerBudgetBlock(budgetProvider(), new Date(now.getTime() + 1000));
  assert.equal(source.calls.length, 1);
  await providerBudgetBlock(budgetProvider(), new Date(now.getTime() + 10_000));
  assert.equal(source.calls.length, 2);
});

async function runExecutor(config, fallback = { mode: "retry", models: [], retryCount: 0 }) {
  return await fetchUpstreamWithFallback({
    body: Buffer.from(JSON.stringify({ max_tokens: 1, messages: [{ content: "hi", role: "user" }], model: "Budget Anthropic/claude-sonnet-5-5" })),
    config,
    coreAuthToken: "core-token",
    fallback,
    headers: {},
    method: "POST",
    path: "/v1/messages",
    routedModel: "Budget Anthropic/claude-sonnet-5-5",
    upstreamUrl: "http://127.0.0.1:3456/v1/messages"
  });
}

test("the executor answers 402 without calling the upstream when the budget is spent", async (t) => {
  const previousFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async () => {
    fetched += 1;
    return new Response("{}", { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
    resetProviderBudgetCacheForTest();
  });
  const config = createDefaultAppConfig();
  config.Providers = [budgetProvider()];

  resetProviderBudgetCacheForTest(totals(10).read);
  assert.equal((await runExecutor(config)).response.status, 200);
  assert.equal(fetched, 1);

  resetProviderBudgetCacheForTest(totals(250).read);
  const blocked = await runExecutor(config);
  assert.equal(blocked.response.status, 402);
  assert.equal(fetched, 1, "the spent provider must not be called");
  const body = await blocked.response.json();
  assert.equal(body.error.type, "budget_exceeded");
  assert.match(body.error.message, /\$250\.00 of \$200\.00/);
});

test("a USD local-estimate window renders as a quota meter in dollars", async () => {
  const meter = await localEstimateMeterForTest(
    budgetProvider({ name: "Budget Meter Provider Without Usage" }),
    { block: true, id: "monthly-usd", label: "Monthly budget", limit: 200, unit: "USD", window: "monthly" }
  );
  assert.equal(meter.unit, "USD");
  assert.equal(meter.kind, "quota");
  assert.equal(meter.limit, 200);
  assert.equal(meter.used, 0);
  assert.equal(meter.remaining, 200);
});
