import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkGatewayProviderConnectivity } from "@ccr/core/providers/probe.ts";

function useClaudeConfigDir(t, accessToken) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ccr-probe-claude-"));
  writeFileSync(path.join(dir, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken } }), { mode: 0o600 });
  const previous = process.env.CLAUDE_CONFIG_DIR;
  const previousSecure = process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  delete process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
  t.after(() => {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
    if (previousSecure !== undefined) process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR = previousSecure;
    rmSync(dir, { force: true, recursive: true });
  });
}

test("connectivity probe uses the current Claude Code login instead of the token stored at import", async (t) => {
  useClaudeConfigDir(t, "sk-ant-oat01-current");
  const previousFetch = globalThis.fetch;
  const authorizations = [];
  globalThis.fetch = async (input, init) => {
    authorizations.push(new Headers(init?.headers).get("authorization"));
    return new Response(JSON.stringify({ id: "msg_1", type: "message" }), {
      headers: { "content-type": "application/json" },
      status: 200
    });
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });

  const report = await checkGatewayProviderConnectivity({
    apiKey: "ccr-local-agent-login",
    candidates: [{
      baseUrl: "http://127.0.0.1:49131",
      name: "Claude Code API",
      protocols: ["anthropic_messages"],
      source: "preset"
    }],
    forceRefresh: true,
    models: ["claude-sonnet-5"],
    providerPlugins: [{
      auth: {
        headers: {
          "anthropic-beta": "oauth-2025-04-20",
          authorization: "Bearer sk-ant-oat01-revoked-at-import"
        }
      },
      key: "ccr-local-agent-claude-code-api-claude-code-oauth",
      providerName: "Claude Code API"
    }],
    protocols: ["anthropic_messages"]
  });

  assert.ok(authorizations.length > 0);
  assert.ok(authorizations.every((value) => value === "Bearer sk-ant-oat01-current"), JSON.stringify(authorizations));
  assert.equal(report.passed.length, 1);
});
