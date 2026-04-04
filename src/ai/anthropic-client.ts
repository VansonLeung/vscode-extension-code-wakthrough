import * as vscode from "vscode";
import * as https from "https";
import * as http from "http";
import { Buffer } from "buffer";
import { URL } from "url";
import {
  AIConfig,
  buildApiUrl,
  ChatMessage,
  parseErrorMessage,
  ToolCall,
  ToolCompletionOptions,
} from "./client-shared";

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

type AnthropicBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicBlock[];
}

interface AnthropicResponse {
  id?: string;
  type?: string;
  stop_reason?: string | null;
  message?: {
    content?: unknown;
    tool_calls?: unknown;
  };
  content?: string | Array<
    | { type: "text"; text?: string }
    | { type: "tool_use"; id?: string; name?: string; input?: unknown }
    | { type?: string; [key: string]: unknown }
  >;
  output?: unknown;
  completion?: string;
  output_text?: string;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
  choices?: Array<{
    message?: {
      content?: unknown;
      tool_calls?: unknown;
      reasoning_content?: string | null;
    };
  }>;
}

const ANTHROPIC_VERSION = "2023-06-01";

export async function anthropicChatCompletion(
  prompt: string,
  config: AIConfig,
  onProgress?: (text: string) => void,
  cancellationToken?: vscode.CancellationToken,
  logger?: vscode.OutputChannel
): Promise<string> {
  const url = buildApiUrl(config.endpoint, "/messages");
  const requestBody = {
    model: config.model,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.3,
    max_tokens: 8192,
  };

  if (logger) {
    const maskedKey = config.apiKey ? `${config.apiKey.slice(0, 6)}...` : "(none)";
    logger.appendLine(`\n${"=".repeat(60)}`);
    logger.appendLine(`[API] Provider: Anthropic HTTP`);
    logger.appendLine(`[API] Endpoint: ${url.toString()}`);
    logger.appendLine(`[API] Model: ${config.model}`);
    logger.appendLine(`[API] API Key: ${maskedKey}`);
    logger.appendLine(`[API] Prompt length: ${prompt.length} chars`);
    logger.appendLine(`${"=".repeat(60)}`);
  }

  const response = await sendAnthropicRequest(url, requestBody, config, cancellationToken, onProgress);
  return flattenAnthropicText(response);
}

export async function anthropicChatCompletionWithTools(
  options: ToolCompletionOptions,
  config: AIConfig
): Promise<ChatMessage> {
  const url = buildApiUrl(config.endpoint, "/messages");
  const system = options.messages
    .filter((message) => message.role === "system" && message.content)
    .map((message) => message.content)
    .join("\n\n");

  const requestBody = {
    model: config.model,
    system: system || undefined,
    messages: toAnthropicMessages(options.messages),
    tools: options.tools.length > 0 ? toAnthropicTools(options.tools) : undefined,
    tool_choice: options.tools.length > 0 ? { type: "auto" } : undefined,
    temperature: 0.3,
    max_tokens: 8192,
  };

  const response = await sendAnthropicRequest(
    url,
    requestBody,
    config,
    options.cancellationToken,
    undefined,
    options.logger
  );
  return fromAnthropicResponse(response);
}

function toAnthropicMessages(messages: ChatMessage[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }

    if (message.role === "tool") {
      pushAnthropicMessage(result, "user", [
        {
          type: "tool_result",
          tool_use_id: message.tool_call_id ?? "tool-call",
          content: message.content ?? "",
        },
      ]);
      continue;
    }

    const role = message.role === "assistant" ? "assistant" : "user";
    const blocks: AnthropicBlock[] = [];

    if (message.content) {
      blocks.push({ type: "text", text: message.content });
    }

    if (message.role === "assistant" && message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        blocks.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.function.name,
          input: parseToolArguments(toolCall),
        });
      }
    }

    pushAnthropicMessage(result, role, blocks);
  }

  return result;
}

function pushAnthropicMessage(
  messages: AnthropicMessage[],
  role: "user" | "assistant",
  blocks: AnthropicBlock[]
): void {
  if (blocks.length === 0) {
    return;
  }

  const last = messages[messages.length - 1];
  if (last && last.role === role) {
    last.content.push(...blocks);
    return;
  }

  messages.push({ role, content: [...blocks] });
}

function parseToolArguments(toolCall: ToolCall): unknown {
  try {
    return JSON.parse(toolCall.function.arguments);
  } catch {
    return { rawArguments: toolCall.function.arguments };
  }
}

function toAnthropicTools(tools: unknown[]): Array<{
  name: string;
  description?: string;
  input_schema: unknown;
}> {
  return tools.flatMap((tool) => {
    if (typeof tool !== "object" || tool === null) {
      return [];
    }

    const value = tool as {
      type?: string;
      function?: {
        name?: string;
        description?: string;
        parameters?: unknown;
      };
    };

    if (value.type !== "function" || !value.function?.name || !value.function.parameters) {
      return [];
    }

    return [{
      name: value.function.name,
      description: value.function.description,
      input_schema: value.function.parameters,
    }];
  });
}

function fromAnthropicResponse(response: AnthropicResponse): ChatMessage {
  const openAIMessage = response.choices?.[0]?.message;
  if (openAIMessage) {
    const toolCalls = extractToolCalls(openAIMessage.tool_calls);
    return {
      role: "assistant",
      content: firstNonEmptyText(
        openAIMessage.content,
        openAIMessage.reasoning_content,
        response.output_text,
        response.completion,
        response.reasoning_content
      ),
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };
  }

  const topLevelToolCalls = extractToolCalls(
    response.tool_calls,
    response.message?.tool_calls,
    response.content,
    response.output
  );

  if (topLevelToolCalls.length > 0) {
    return {
      role: "assistant",
      content: firstNonEmptyText(
        response.output_text,
        response.completion,
        response.reasoning_content,
        response.message?.content,
        response.content,
        response.output
      ),
      tool_calls: topLevelToolCalls,
    };
  }

  if (typeof response.content === "string") {
    return {
      role: "assistant",
      content: response.content || response.output_text || response.completion || null,
    };
  }

  const toolCalls = extractToolCalls(response.content, response.output);
  const content = firstNonEmptyText(
    response.content,
    response.output,
    response.message?.content,
    response.output_text,
    response.completion,
    response.reasoning_content
  );

  return {
    role: "assistant",
    content,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
}

function flattenAnthropicText(response: AnthropicResponse): string {
  return (
    firstNonEmptyText(
      response.choices?.[0]?.message?.content,
      response.choices?.[0]?.message?.reasoning_content,
      response.message?.content,
      response.content,
      response.output,
      response.output_text,
      response.completion,
      response.reasoning_content
    ) ?? ""
  );
}

function firstNonEmptyText(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    const text = extractText(candidate);
    if (text) {
      return text;
    }
  }

  return null;
}

function extractText(value: unknown, depth = 0): string {
  if (depth > 4 || value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => extractText(entry, depth + 1))
      .filter((entry) => entry.length > 0)
      .join("\n\n")
      .trim();
  }

  if (typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  if (record.type === "tool_use" || record.type === "tool_result") {
    return "";
  }

  return [
    extractText(record.text, depth + 1),
    extractText(record.content, depth + 1),
    extractText(record.output_text, depth + 1),
    extractText(record.completion, depth + 1),
    extractText(record.reasoning_content, depth + 1),
    extractText(record.thinking, depth + 1),
  ]
    .filter((entry) => entry.length > 0)
    .join("\n\n")
    .trim();
}

function extractToolCalls(...candidates: unknown[]): ToolCall[] {
  const toolCalls: ToolCall[] = [];

  for (const candidate of candidates) {
    collectToolCalls(candidate, toolCalls, 0);
  }

  const seen = new Set<string>();
  return toolCalls.filter((toolCall) => {
    const key = `${toolCall.id}:${toolCall.function.name}:${toolCall.function.arguments}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function collectToolCalls(value: unknown, output: ToolCall[], depth: number): void {
  if (depth > 4 || value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectToolCalls(entry, output, depth + 1);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  const normalized = normalizeToolCall(record);
  if (normalized) {
    output.push(normalized);
  }

  collectToolCalls(record.tool_calls, output, depth + 1);
  collectToolCalls(record.content, output, depth + 1);
  collectToolCalls(record.output, output, depth + 1);
}

function normalizeToolCall(value: Record<string, unknown>): ToolCall | null {
  if (value.type === "tool_use" && typeof value.id === "string" && typeof value.name === "string") {
    return {
      id: value.id,
      type: "function",
      function: {
        name: value.name,
        arguments: stringifyArguments(value.input ?? {}),
      },
    };
  }

  const fn = typeof value.function === "object" && value.function !== null
    ? value.function as Record<string, unknown>
    : null;
  const functionName = typeof fn?.name === "string"
    ? fn.name
    : typeof value.name === "string"
      ? value.name
      : null;

  if (!functionName) {
    return null;
  }

  const id = typeof value.id === "string"
    ? value.id
    : typeof value.tool_call_id === "string"
      ? value.tool_call_id
      : `tool-${functionName}`;

  const argumentsValue = fn?.arguments ?? value.arguments ?? value.input ?? {};

  return {
    id,
    type: "function",
    function: {
      name: functionName,
      arguments: stringifyArguments(argumentsValue),
    },
  };
}

function stringifyArguments(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function sendAnthropicRequest(
  url: URL,
  requestBody: unknown,
  config: AIConfig,
  cancellationToken?: vscode.CancellationToken,
  onProgress?: (text: string) => void,
  logger?: vscode.OutputChannel
): Promise<AnthropicResponse> {
  const body = JSON.stringify(requestBody);
  const headers: Record<string, string> = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
  };

  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
    headers["x-api-key"] = config.apiKey;
  }

  return new Promise<AnthropicResponse>((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    let settled = false;

    const req = transport.request(
      url,
      {
        method: "POST",
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];

        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          if (onProgress) {
            const totalLen = chunks.reduce((sum, current) => sum + current.length, 0);
            onProgress(`${totalLen} bytes received...`);
          }
        });

        res.on("end", () => {
          if (settled) {
            return;
          }
          settled = true;

          const rawBody = Buffer.concat(chunks).toString("utf-8");
          if (logger) {
            logger.appendLine(`[Anthropic] Raw response (${rawBody.length} chars): ${rawBody.slice(0, 2000)}`);
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(parseErrorMessage(rawBody, `API error ${res.statusCode}`)));
            return;
          }

          try {
            const parsed = JSON.parse(rawBody) as AnthropicResponse;
            if (logger) {
              const normalized = fromAnthropicResponse(parsed);
              logger.appendLine(
                `[Anthropic] Parsed response summary: stop_reason=${parsed.stop_reason ?? "(none)"}, contentChars=${normalized.content?.length ?? 0}, toolCalls=${normalized.tool_calls?.length ?? 0}`
              );
            }
            resolve(parsed);
          } catch {
            reject(new Error("Failed to parse API response"));
          }
        });

        res.on("error", (error) => {
          if (settled) {
            return;
          }
          settled = true;
          reject(error);
        });
      }
    );

    req.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });

    if (cancellationToken) {
      cancellationToken.onCancellationRequested(() => {
        if (settled) {
          return;
        }
        settled = true;
        req.destroy();
        reject(new Error("Request cancelled"));
      });
    }

    req.write(body);
    req.end();
  });
}