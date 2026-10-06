import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import {
  captureGatewayChildOutput,
  gatewayConfigAcceptanceTimeoutMs,
  gatewayStartupTimeoutMs,
  waitForManagedCoreGatewayReady
} from "@ccr/core/gateway/core-runtime/supervisor.ts";

test("gateway config acceptance timeout defaults to 30s when env is unset", () => {
  assert.equal(gatewayConfigAcceptanceTimeoutMs({}), 30_000);
});

test("gateway config acceptance timeout honors CCR_GATEWAY_CONFIG_TIMEOUT_MS", () => {
  assert.equal(
    gatewayConfigAcceptanceTimeoutMs({ CCR_GATEWAY_CONFIG_TIMEOUT_MS: "60000" }),
    60_000
  );
});

test("gateway config acceptance timeout trims whitespace and truncates fractions", () => {
  assert.equal(
    gatewayConfigAcceptanceTimeoutMs({ CCR_GATEWAY_CONFIG_TIMEOUT_MS: "  12345.9  " }),
    12_345
  );
});

test("gateway config acceptance timeout rejects invalid or too-small overrides", () => {
  for (const raw of ["", "   ", "abc", "0", "-5000", "999", "NaN", "Infinity"]) {
    assert.equal(
      gatewayConfigAcceptanceTimeoutMs({ CCR_GATEWAY_CONFIG_TIMEOUT_MS: raw }),
      30_000,
      `expected default for ${JSON.stringify(raw)}`
    );
  }
});
test("gateway startup timeout defaults to 15s and honors CCR_GATEWAY_STARTUP_TIMEOUT_MS", () => {
  assert.equal(gatewayStartupTimeoutMs({}), 15_000);
  assert.equal(gatewayStartupTimeoutMs({ CCR_GATEWAY_STARTUP_TIMEOUT_MS: " 45000.7 " }), 45_000);
  for (const raw of ["", "abc", "0", "-1", "999", "Infinity"]) {
    assert.equal(gatewayStartupTimeoutMs({ CCR_GATEWAY_STARTUP_TIMEOUT_MS: raw }), 15_000, JSON.stringify(raw));
  }
});

test("gateway startup timeout error includes the output of the child that never became healthy", async (t) => {
  const child = spawn(process.execPath, ["-e", "console.error('listen EADDRINUSE: address already in use 127.0.0.1:3457'); setInterval(() => {}, 1000)"], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => child.kill());
  captureGatewayChildOutput(child);
  await new Promise((resolve) => child.stderr.once("data", resolve));
  const previous = process.env.CCR_GATEWAY_STARTUP_TIMEOUT_MS;
  process.env.CCR_GATEWAY_STARTUP_TIMEOUT_MS = "1000";
  t.after(() => {
    if (previous === undefined) delete process.env.CCR_GATEWAY_STARTUP_TIMEOUT_MS;
    else process.env.CCR_GATEWAY_STARTUP_TIMEOUT_MS = previous;
  });

  await assert.rejects(
    waitForManagedCoreGatewayReady("http://127.0.0.1:9", "runtime-1", child),
    (error) => /did not become healthy within 1000ms/.test(error.message) &&
      /stderr:\nlisten EADDRINUSE/.test(error.message)
  );
});
