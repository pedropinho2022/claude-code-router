import assert from "node:assert/strict";
import test from "node:test";
import {
  isInvalidThinkingSignatureError,
  stripThinkingBlocksFromMessagesBody
} from "@ccr/core/gateway/features/thinking-signature-retry.ts";
import { createDefaultAppConfig } from "@ccr/core/config/default-config.ts";
import { fetchUpstreamWithFallback } from "@ccr/core/gateway/upstream/executor.ts";

const signatureError = JSON.stringify({
  error: { message: "messages.1.content.0: Invalid `signature` in `thinking` block", type: "invalid_request_error" },
  type: "error"
});

function messagesBody(extra = {}) {
  return Buffer.from(JSON.stringify({
    max_tokens: 100,
    messages: [
      { content: "oi", role: "user" },
      { content: [{ signature: "foreign", thinking: "hmm", type: "thinking" }, { text: "olá", type: "text" }], role: "assistant" },
      { content: [{ data: "xx", type: "redacted_thinking" }], role: "assistant" },
      { content: "e agora?", role: "user" }
    ],
    model: "claude-sonnet-5-5",
    ...extra
  }));
}

test("signature errors are recognised only for HTTP 400 thinking-signature messages", () => {
  assert.equal(isInvalidThinkingSignatureError(400, signatureError), true);
  assert.equal(isInvalidThinkingSignatureError(429, signatureError), false);
  assert.equal(isInvalidThinkingSignatureError(400, '{"error":{"message":"max_tokens too large"}}'), false);
});

test("thinking blocks are stripped and emptied messages dropped", () => {
  const stripped = JSON.parse(stripThinkingBlocksFromMessagesBody(messagesBody()).toString("utf8"));
  assert.deepEqual(stripped.messages, [
    { content: "oi", role: "user" },
    { content: [{ text: "olá", type: "text" }], role: "assistant" },
    { content: "e agora?", role: "user" }
  ]);
  assert.equal(stripThinkingBlocksFromMessagesBody(Buffer.from('{"messages":[{"role":"user","content":"x"}]}')), undefined);
  assert.equal(stripThinkingBlocksFromMessagesBody(Buffer.from("not json")), undefined);
});

test("extended thinking is disabled when the last assistant turn called a tool", () => {
  const body = Buffer.from(JSON.stringify({
    messages: [
      { content: "go", role: "user" },
      { content: [{ signature: "x", thinking: "t", type: "thinking" }, { id: "t1", input: {}, name: "ls", type: "tool_use" }], role: "assistant" },
      { content: [{ content: "ok", tool_use_id: "t1", type: "tool_result" }], role: "user" }
    ],
    thinking: { budget_tokens: 1024, type: "enabled" }
  }));
  const stripped = JSON.parse(stripThinkingBlocksFromMessagesBody(body).toString("utf8"));
  assert.equal("thinking" in stripped, false);
  assert.equal(stripped.messages[1].content.length, 1);
});

test("the upstream executor retries once without thinking blocks after a signature 400", async () => {
  const originalFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return sent.length === 1
      ? new Response(signatureError, { headers: { "content-type": "application/json" }, status: 400 })
      : new Response('{"ok":true}', { headers: { "content-type": "application/json" }, status: 200 });
  };
  try {
    const result = await fetchUpstreamWithFallback({
      body: messagesBody(),
      config: createDefaultAppConfig(),
      coreAuthToken: "core-token",
      fallback: { mode: "retry", models: [], retryCount: 0 },
      headers: {},
      method: "POST",
      path: "/v1/messages",
      routedModel: "claude-sonnet-5-5",
      upstreamUrl: "http://127.0.0.1:3456/v1/messages"
    });
    assert.equal(result.response.status, 200);
    assert.equal(sent.length, 2);
    assert.ok(JSON.stringify(sent[0]).includes('"thinking"'));
    assert.ok(!JSON.stringify(sent[1]).includes('"thinking"'));
    assert.ok(!JSON.stringify(sent[1]).includes("redacted_thinking"));
    assert.ok(!JSON.stringify(result.attempt.body.toString("utf8")).includes("redacted_thinking"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("other 400 responses are returned untouched without a retry", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('{"error":{"message":"bad request"}}', { status: 400 });
  };
  try {
    const result = await fetchUpstreamWithFallback({
      body: messagesBody(),
      config: createDefaultAppConfig(),
      coreAuthToken: "core-token",
      fallback: { mode: "retry", models: [], retryCount: 0 },
      headers: {},
      method: "POST",
      path: "/v1/messages",
      routedModel: "claude-sonnet-5-5",
      upstreamUrl: "http://127.0.0.1:3456/v1/messages"
    });
    assert.equal(result.response.status, 400);
    assert.equal(calls, 1);
    assert.match(await result.response.text(), /bad request/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
