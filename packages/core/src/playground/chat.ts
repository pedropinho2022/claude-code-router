import type { AppConfig, PlaygroundChatRequest, PlaygroundChatResult } from "@ccr/core/contracts/app";
import { configuredApiKeys } from "@ccr/core/gateway/auth/api-key-authorizer";
import { ccrRouteReasonHeader, ccrRoutedModelHeader } from "@ccr/core/gateway/core-runtime/router-plugin-contract";

const defaultMaxTokens = 4096;
const maxMessages = 200;
const requestTimeoutMs = 10 * 60 * 1000;

// Sends a plain chat (no tools, no agent harness) through the local gateway, so
// the request goes through the same routing, rules and fallbacks as any client.
export async function sendPlaygroundChat(
  config: AppConfig,
  request: PlaygroundChatRequest,
  fetchImpl: typeof fetch = fetch
): Promise<PlaygroundChatResult> {
  const model = request.model?.trim();
  if (!model) {
    throw new Error("Select a model.");
  }
  const messages = normalizeMessages(request.messages);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    throw new Error("The conversation must end with a user message.");
  }
  const apiKey = await playgroundApiKey(config);
  const system = request.system?.trim();
  const startedAt = Date.now();
  const response = await fetchImpl(`${localGatewayBaseUrl(config)}/v1/messages`, {
    body: JSON.stringify({
      max_tokens: normalizeMaxTokens(request.maxTokens),
      messages,
      model,
      stream: false,
      ...(system ? { system } : {})
    }),
    headers: {
      accept: "application/json",
      "anthropic-version": "2023-06-01",
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "x-api-key": apiKey
    },
    method: "POST",
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
  const text = await response.text();
  const payload = parseJson(text);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${errorMessage(payload) ?? (text.slice(0, 500) || response.statusText)}`);
  }
  const content = isRecord(payload) && Array.isArray(payload.content) ? payload.content.filter(isRecord) : [];
  const usage = isRecord(payload) && isRecord(payload.usage) ? payload.usage : {};
  const thinking = joinBlocks(content, "thinking", "thinking");
  return {
    durationMs: Date.now() - startedAt,
    inputTokens: numberValue(usage.input_tokens),
    model: isRecord(payload) ? stringValue(payload.model) : undefined,
    outputTokens: numberValue(usage.output_tokens),
    routeReason: response.headers.get(ccrRouteReasonHeader) ?? undefined,
    routedModel: response.headers.get(ccrRoutedModelHeader) ?? undefined,
    stopReason: isRecord(payload) ? stringValue(payload.stop_reason) : undefined,
    text: joinBlocks(content, "text", "text"),
    ...(thinking ? { thinking } : {})
  };
}

export function localGatewayBaseUrl(config: Pick<AppConfig, "gateway">): string {
  const configured = config.gateway?.host?.trim() || "127.0.0.1";
  const host = configured === "0.0.0.0" ? "127.0.0.1" : configured === "::" || configured === "[::]" ? "::1" : configured;
  const formattedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${formattedHost}:${config.gateway?.port ?? 3456}`;
}

async function playgroundApiKey(config: AppConfig): Promise<string> {
  const now = Date.now();
  const apiKey = (await configuredApiKeys(config)).find((item) => {
    const expiresAt = item.expiresAt ? Date.parse(item.expiresAt) : Number.NaN;
    return !Number.isFinite(expiresAt) || expiresAt > now;
  });
  if (!apiKey?.key) {
    throw new Error("Create a CCR API key under API Keys to use the playground.");
  }
  return apiKey.key;
}

function normalizeMessages(value: unknown): PlaygroundChatRequest["messages"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((message): message is PlaygroundChatRequest["messages"][number] =>
      isRecord(message) &&
      (message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string" &&
      message.content.trim().length > 0)
    .slice(-maxMessages)
    .map((message) => ({ content: message.content, role: message.role }));
}

function normalizeMaxTokens(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 128_000) : defaultMaxTokens;
}

function joinBlocks(content: Record<string, unknown>[], type: string, field: string): string {
  return content
    .filter((block) => block.type === type && typeof block[field] === "string")
    .map((block) => block[field] as string)
    .join("\n\n")
    .trim();
}

function errorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const error = isRecord(payload.error) ? payload.error : undefined;
  return stringValue(error?.message) ?? stringValue(payload.message);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
