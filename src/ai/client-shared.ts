import * as vscode from "vscode";

export type AIClientType = "openai" | "anthropic" | "copilot";

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCompletionOptions {
  messages: ChatMessage[];
  tools: unknown[];
  logger?: vscode.OutputChannel;
  cancellationToken?: vscode.CancellationToken;
}

export interface AIConfig {
  client: AIClientType;
  endpoint: string;
  apiKey: string;
  model: string;
  copilotModel: string;
}

export function getAIConfig(): AIConfig {
  const config = vscode.workspace.getConfiguration("codeWalkthrough.ai");
  return {
    client: normalizeClientType(config.get<string>("client")),
    endpoint: config.get<string>("apiEndpoint") ?? "https://api.openai.com/v1",
    apiKey: config.get<string>("apiKey") ?? "",
    model: config.get<string>("model") ?? "gpt-4o",
    copilotModel: config.get<string>("copilotModel") ?? "",
  };
}

export function isAIConfigured(): boolean {
  const config = getAIConfig();
  if (config.client === "copilot") {
    return true;
  }

  const isLocalhost =
    config.endpoint.includes("localhost") ||
    config.endpoint.includes("127.0.0.1");
  return isLocalhost || config.apiKey.length > 0;
}

function normalizeClientType(value: string | undefined): AIClientType {
  switch (value) {
    case "anthropic":
      return "anthropic";
    case "copilot":
      return "copilot";
    default:
      return "openai";
  }
}

export function buildApiUrl(endpoint: string, pathName: string): URL {
  const normalizedEndpoint = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
  const normalizedPath = pathName.startsWith("/") ? pathName : `/${pathName}`;
  return new URL(`${normalizedEndpoint}${normalizedPath}`);
}

export function parseErrorMessage(rawBody: string, fallback: string): string {
  try {
    const parsed = JSON.parse(rawBody) as {
      error?: { message?: string };
    };
    return parsed.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}