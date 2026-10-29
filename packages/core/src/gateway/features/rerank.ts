import { isGatewayProviderEnabled, type AppConfig, type GatewayProviderConfig } from "@ccr/core/contracts/app";
import { isRecord } from "@ccr/core/gateway/internal/value";
import { parseProviderModelSelector } from "@ccr/core/routing/model-registry";
import { findProviderByPublicOrInternalName } from "@ccr/core/providers/runtime-topology";

/**
 * Rerank requests (`POST /v1/rerank`, Jina/Cohere shape: model, query,
 * documents, top_n) are not served by the core gateway, so CCR forwards them
 * itself to `<provider base URL>/rerank` — llama-server, vLLM, TEI and Infinity
 * all accept that path and body.
 */
const rerankPaths = new Set(["/v1/rerank", "/rerank", "/v1/reranking", "/reranking"]);

export type RerankUpstreamRequest = {
  body: Buffer;
  headers: Record<string, string>;
  model: string;
  provider: GatewayProviderConfig;
  routedModel: string;
  url: string;
};

export type RerankPreparation = { error: string; statusCode: number } | { request: RerankUpstreamRequest };

export function isRerankRequest(method: string, path: string): boolean {
  return method.toUpperCase() === "POST" && rerankPaths.has(path.toLowerCase().replace(/\/+$/, ""));
}

export function prepareRerankUpstreamRequest(config: AppConfig, body: Buffer | undefined): RerankPreparation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body?.toString("utf8") || "");
  } catch {
    return { error: "Rerank request body must be JSON.", statusCode: 400 };
  }
  if (!isRecord(parsed) || typeof parsed.model !== "string" || !parsed.model.trim()) {
    return { error: "Rerank request needs a \"model\" such as \"Provider/model\".", statusCode: 400 };
  }

  const target = resolveRerankTarget(config, parsed.model.trim());
  if (!target) {
    return { error: `No enabled provider serves rerank model "${parsed.model}". Use "Provider/model".`, statusCode: 404 };
  }
  const baseUrl = (target.provider.api_base_url || target.provider.baseUrl || target.provider.baseurl || "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    return { error: `Provider "${target.provider.name}" has no base URL.`, statusCode: 400 };
  }

  const apiKey = (target.provider.api_key || target.provider.apiKey || target.provider.apikey || "").trim();
  const extraHeaders = Object.fromEntries(
    Object.entries(isRecord(target.provider.extraHeaders) ? target.provider.extraHeaders : {})
      .filter(([name, value]) => name.trim() && typeof value === "string" && value !== "")
  ) as Record<string, string>;
  return {
    request: {
      body: Buffer.from(JSON.stringify({ ...parsed, model: target.model }), "utf8"),
      headers: {
        ...extraHeaders,
        accept: "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        "content-type": "application/json"
      },
      model: target.model,
      provider: target.provider,
      routedModel: `${target.provider.name}/${target.model}`,
      url: `${baseUrl}/rerank`
    }
  };
}

function resolveRerankTarget(config: AppConfig, selector: string): { model: string; provider: GatewayProviderConfig } | undefined {
  const qualified = parseProviderModelSelector(selector);
  if (qualified) {
    const provider = findProviderByPublicOrInternalName(config, qualified.provider);
    if (provider && isGatewayProviderEnabled(provider)) {
      return { model: qualified.model, provider };
    }
  }
  // A bare model id resolves only when exactly one enabled provider lists it.
  const owners = config.Providers.filter((provider) =>
    isGatewayProviderEnabled(provider) && Array.isArray(provider.models) && provider.models.includes(selector));
  return owners.length === 1 ? { model: selector, provider: owners[0] } : undefined;
}
