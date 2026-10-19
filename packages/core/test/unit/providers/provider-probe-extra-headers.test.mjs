import assert from "node:assert/strict";
import test from "node:test";
import { checkGatewayProviderConnectivity, probeGatewayProvider } from "@ccr/core/providers/probe.ts";

const workspaceError = JSON.stringify({
  error: {
    message: "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header.",
    type: "invalid_request_error"
  },
  type: "error"
});

// A key not scoped to a workspace: every request needs `anthropic-workspace-id`.
function stubAnthropicRequiringWorkspace(t) {
  const previousFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    seen.push({ path: url.pathname, workspace: headers.get("anthropic-workspace-id"), apiKey: headers.get("x-api-key") });
    if (headers.get("anthropic-workspace-id") !== "wrkspc_test") {
      return new Response(workspaceError, { headers: { "content-type": "application/json" }, status: 400 });
    }
    if (url.pathname === "/v1/models") {
      return new Response(JSON.stringify({
        data: [
          { display_name: "Claude Sonnet 5.5", id: "claude-sonnet-5-5", type: "model" },
          { display_name: "Claude Opus 5.5", id: "claude-opus-5-5", type: "model" }
        ],
        has_more: false
      }), { headers: { "content-type": "application/json" }, status: 200 });
    }
    return new Response(JSON.stringify({ content: [{ text: "ok", type: "text" }], id: "msg_1", role: "assistant", type: "message" }), {
      headers: { "content-type": "application/json" },
      status: 200
    });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });
  return seen;
}

test("model discovery sends the provider's extra headers (workspace-scoped Anthropic keys)", async (t) => {
  const seen = stubAnthropicRequiringWorkspace(t);
  const base = {
    apiKey: "sk-ant-api03-test",
    baseUrl: "https://api.anthropic.com",
    forceRefresh: true,
    mode: "models",
    protocols: ["anthropic_messages"]
  };

  const withoutHeader = await probeGatewayProvider(base);
  assert.deepEqual(withoutHeader.models, []);

  const withHeader = await probeGatewayProvider({ ...base, extraHeaders: { "anthropic-workspace-id": "wrkspc_test" } });
  assert.deepEqual(withHeader.models, ["claude-sonnet-5-5", "claude-opus-5-5"]);
  const modelCall = seen.find((call) => call.path === "/v1/models" && call.workspace === "wrkspc_test");
  assert.equal(modelCall?.apiKey, "sk-ant-api03-test");
});

test("connectivity check sends the provider's extra headers", async (t) => {
  const seen = stubAnthropicRequiringWorkspace(t);
  const request = {
    apiKey: "sk-ant-api03-test",
    candidates: [{ baseUrl: "https://api.anthropic.com", protocols: ["anthropic_messages"], source: "preset" }],
    forceRefresh: true,
    models: ["claude-sonnet-5-5"],
    protocols: ["anthropic_messages"]
  };

  // HTTP 400 counts as "the endpoint speaks this protocol", so the check itself
  // cannot tell the two apart; what matters is what actually goes upstream.
  await checkGatewayProviderConnectivity(request);
  assert.ok(seen.every((call) => call.workspace === null));

  seen.length = 0;
  const report = await checkGatewayProviderConnectivity({ ...request, extraHeaders: { "anthropic-workspace-id": "wrkspc_test" } });
  assert.equal(report.passed.length, 1);
  assert.ok(seen.length > 0);
  assert.ok(seen.every((call) => call.path === "/v1/messages" && call.workspace === "wrkspc_test"), JSON.stringify(seen));
});
