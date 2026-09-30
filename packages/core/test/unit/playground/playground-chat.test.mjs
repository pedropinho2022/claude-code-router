import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultAppConfig } from "@ccr/core/config/default-config.ts";
import { configuredApiKeys } from "@ccr/core/gateway/auth/api-key-authorizer.ts";
import { localGatewayBaseUrl, sendPlaygroundChat } from "@ccr/core/playground/chat.ts";

function playgroundConfig() {
  const config = createDefaultAppConfig();
  config.gateway.host = "0.0.0.0";
  config.gateway.port = 45678;
  config.APIKEYS = [{ createdAt: new Date().toISOString(), id: "playground", key: "sk-ccr-playground" }];
  return config;
}

test("playground sends the whole chat to the local gateway with a CCR API key", async () => {
  const calls = [];
  const config = playgroundConfig();
  // Keys persisted by other tests in the shared test home come first.
  const expectedKey = (await configuredApiKeys(config))[0]?.key;
  const result = await sendPlaygroundChat(config, {
    messages: [
      { content: "Oi", role: "user" },
      { content: "Olá!", role: "assistant" },
      { content: "   ", role: "user" },
      { content: "Quanto é 2+2?", role: "user" }
    ],
    model: "Antigravity/gemini-3.7-flash-medium",
    system: " Seja breve. "
  }, async (url, init) => {
    calls.push({ body: JSON.parse(init.body), headers: init.headers, url });
    return new Response(JSON.stringify({
      content: [{ thinking: "somar", type: "thinking" }, { text: "4", type: "text" }],
      model: "Antigravity/gemini-3.7-flash-medium",
      stop_reason: "end_turn",
      usage: { input_tokens: 12, output_tokens: 1 }
    }), {
      headers: { "content-type": "application/json", "x-ccr-route-reason": "rule:test" },
      status: 200
    });
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:45678/v1/messages");
  assert.equal(calls[0].headers["x-api-key"], expectedKey);
  assert.equal(calls[0].headers.authorization, `Bearer ${expectedKey}`);
  assert.deepEqual(calls[0].body, {
    max_tokens: 4096,
    messages: [
      { content: "Oi", role: "user" },
      { content: "Olá!", role: "assistant" },
      { content: "Quanto é 2+2?", role: "user" }
    ],
    model: "Antigravity/gemini-3.7-flash-medium",
    stream: false,
    system: "Seja breve."
  });
  assert.equal(result.text, "4");
  assert.equal(result.thinking, "somar");
  assert.equal(result.inputTokens, 12);
  assert.equal(result.outputTokens, 1);
  assert.equal(result.routeReason, "rule:test");
});

test("playground surfaces gateway errors and validates input", async () => {
  const config = playgroundConfig();
  await assert.rejects(
    sendPlaygroundChat(config, { messages: [{ content: "oi", role: "user" }], model: "X/y" }, async () =>
      new Response(JSON.stringify({ error: { message: "quota exhausted" } }), { status: 429 })),
    /HTTP 429: quota exhausted/
  );
  await assert.rejects(sendPlaygroundChat(config, { messages: [{ content: "oi", role: "user" }], model: " " }), /Select a model/);
  await assert.rejects(
    sendPlaygroundChat(config, { messages: [{ content: "oi", role: "assistant" }], model: "X/y" }),
    /must end with a user message/
  );
  assert.equal(localGatewayBaseUrl({ gateway: { host: "::", port: 1 } }), "http://[::1]:1");
});
