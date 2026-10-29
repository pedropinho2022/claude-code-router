import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createDefaultAppConfig } from "@ccr/core/config/default-config.ts";
import { ClaudeCodeRouterPlugin } from "@ccr/core/gateway/claude-code-router-plugin.ts";
import { isRerankRequest, prepareRerankUpstreamRequest } from "@ccr/core/gateway/features/rerank.ts";
import { GatewayHttpRequestHandler } from "@ccr/core/gateway/http/request-handler.ts";
import { resetProviderBudgetCacheForTest } from "@ccr/core/gateway/limits/provider-budget.ts";
import { GatewayRequestPipeline } from "@ccr/core/gateway/request/pipeline.ts";
import { waitForTcpListener } from "../../support/loopback-listener.mjs";

// What llama-server --reranking answers on /v1/rerank.
function llamaServerRerankResponse(model) {
  return {
    model,
    object: "list",
    results: [{ index: 1, relevance_score: 0.92 }, { index: 0, relevance_score: -3.1 }],
    usage: { prompt_tokens: 42, total_tokens: 42 }
  };
}

function rerankConfig(baseUrl, overrides = {}) {
  const config = createDefaultAppConfig();
  config.APIKEY = "gateway-key";
  config.APIKEYS = [{ createdAt: "2026-01-01T00:00:00.000Z", id: "gateway", key: "gateway-key", name: "Gateway" }];
  config.Providers = [{
    api_base_url: baseUrl,
    api_key: "llama-key",
    extraHeaders: { "x-tenant": "lab" },
    models: ["bge-reranker-v2-m3"],
    name: "Local Llama",
    type: "openai_chat_completions",
    ...overrides
  }];
  config.gateway.enabled = true;
  return config;
}

test("rerank paths and model selectors resolve to the provider's /rerank endpoint", () => {
  assert.equal(isRerankRequest("POST", "/v1/rerank"), true);
  assert.equal(isRerankRequest("post", "/rerank/"), true);
  assert.equal(isRerankRequest("GET", "/v1/rerank"), false);
  assert.equal(isRerankRequest("POST", "/v1/embeddings"), false);

  const config = rerankConfig("http://127.0.0.1:8080/v1/");
  const body = (model) => Buffer.from(JSON.stringify({ documents: ["a", "b"], model, query: "q", top_n: 1 }));
  const qualified = prepareRerankUpstreamRequest(config, body("Local Llama/bge-reranker-v2-m3")).request;
  assert.equal(qualified.url, "http://127.0.0.1:8080/v1/rerank");
  assert.equal(qualified.routedModel, "Local Llama/bge-reranker-v2-m3");
  assert.equal(qualified.headers.authorization, "Bearer llama-key");
  assert.equal(qualified.headers["x-tenant"], "lab");
  assert.deepEqual(JSON.parse(qualified.body), { documents: ["a", "b"], model: "bge-reranker-v2-m3", query: "q", top_n: 1 });
  assert.equal(prepareRerankUpstreamRequest(config, body("bge-reranker-v2-m3")).request.provider.name, "Local Llama");

  assert.equal(prepareRerankUpstreamRequest(config, body("Nope/x")).statusCode, 404);
  assert.equal(prepareRerankUpstreamRequest(config, Buffer.from("{")).statusCode, 400);
  assert.equal(prepareRerankUpstreamRequest(config, Buffer.from("{}")).statusCode, 400);
});

test("POST /v1/rerank is forwarded to llama-server and honors spend limits", async (t) => {
  const upstreamCalls = [];
  const upstream = createServer((request, response) => {
    let text = "";
    request.on("data", (chunk) => { text += chunk; });
    request.on("end", () => {
      upstreamCalls.push({ body: JSON.parse(text), headers: request.headers, url: request.url });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(llamaServerRerankResponse(JSON.parse(text).model)));
    });
  });
  const config = rerankConfig("http://127.0.0.1:1/v1");
  const plugin = new ClaudeCodeRouterPlugin(config);
  const status = { coreEndpoint: "http://127.0.0.1:1", endpoint: "http://127.0.0.1:0", state: "running" };
  const pipeline = new GatewayRequestPipeline({
    getBrowserWebSearchMcpIntegration: () => undefined,
    getConfig: () => config,
    getCoreAuthToken: () => "test-core-token",
    getPlugin: () => plugin,
    getStatus: () => status
  });
  const handler = new GatewayHttpRequestHandler({
    getBrowserAutomationMcpIntegration: () => undefined,
    getConfig: () => config,
    getPlugin: () => plugin,
    getRuntimeConfigControlStatus: () => ({ revision: "a".repeat(64) }),
    getStatus: () => status,
    handleBillingUsageSync: unsupported,
    handleRawTraceSync: unsupported,
    proxyRequest: (request, response, path, apiKey) => pipeline.proxyRequest(request, response, path, apiKey),
    requestRuntimeConfigReload: () => undefined,
    replayContextArchive: async () => ({ ok: false, statusCode: 404, message: "not configured" })
  });
  const server = createServer((request, response) => {
    void handler.handleRequest(request, response).catch((error) => {
      if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: String(error?.message ?? error) } }));
    });
  });
  t.after(async () => {
    resetProviderBudgetCacheForTest();
    await Promise.all([close(server), close(upstream)]);
  });
  try {
    await Promise.all([listen(upstream), listen(server)]);
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") {
      t.skip(`Local HTTP listen is unavailable: ${error.message}`);
      return;
    }
    throw error;
  }
  await Promise.all([waitForTcpListener(upstream), waitForTcpListener(server)]);
  config.Providers[0].api_base_url = `http://127.0.0.1:${upstream.address().port}/v1`;
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const rerank = () => fetch(`${endpoint}/v1/rerank`, {
    body: JSON.stringify({ documents: ["gatos", "cachorros"], model: "Local Llama/bge-reranker-v2-m3", query: "cão", top_n: 2 }),
    headers: { authorization: "Bearer gateway-key", "content-type": "application/json" },
    method: "POST"
  });

  resetProviderBudgetCacheForTest(async () => ({ costUsd: 0 }));
  const ok = await rerank();
  const okText = await ok.text();
  assert.equal(ok.status, 200, okText);
  assert.equal(JSON.parse(okText).results[0].index, 1);
  assert.equal(ok.headers.get("x-ccr-routed-model"), "Local Llama/bge-reranker-v2-m3");
  assert.equal(upstreamCalls.length, 1);
  assert.equal(upstreamCalls[0].url, "/v1/rerank");
  assert.equal(upstreamCalls[0].body.model, "bge-reranker-v2-m3");
  assert.equal(upstreamCalls[0].headers.authorization, "Bearer llama-key");
  assert.equal(upstreamCalls[0].headers["x-tenant"], "lab");

  const unauthorized = await fetch(`${endpoint}/v1/rerank`, { body: "{}", headers: { "content-type": "application/json" }, method: "POST" });
  assert.equal(unauthorized.status, 401);

  config.Providers[0].account = {
    connectors: [{ type: "local-estimate", windows: [{ block: true, id: "m", label: "Monthly", limit: 5, unit: "USD", window: "monthly" }] }],
    enabled: true
  };
  resetProviderBudgetCacheForTest(async () => ({ costUsd: 6 }));
  const blocked = await rerank();
  assert.equal(blocked.status, 402);
  assert.equal((await blocked.json()).error.type, "budget_exceeded");
  assert.equal(upstreamCalls.length, 1, "a spent provider must not be called");
});

async function unsupported() {
  throw new Error("unsupported");
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve) => (server.listening ? server.close(() => resolve()) : resolve()));
}
