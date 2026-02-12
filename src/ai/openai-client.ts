import * as vscode from "vscode";
import * as https from "https";
import * as http from "http";
import { URL } from "url";

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

interface ChatCompletionChoice {
  message?: {
    role?: string;
    content?: string | null;
    tool_calls?: ToolCall[];
  };
  finish_reason?: string;
  delta?: { content?: string };
}

interface ChatCompletionResponse {
  choices: ChatCompletionChoice[];
}

export interface AIConfig {
  endpoint: string;
  apiKey: string;
  model: string;
}

export function getAIConfig(): AIConfig {
  const config = vscode.workspace.getConfiguration("codeWalkthrough.ai");
  return {
    endpoint: config.get<string>("apiEndpoint") ?? "https://api.openai.com/v1",
    apiKey: config.get<string>("apiKey") ?? "",
    model: config.get<string>("model") ?? "gpt-4o",
  };
}

export function isAIConfigured(): boolean {
  const config = getAIConfig();
  const isLocalhost =
    config.endpoint.includes("localhost") ||
    config.endpoint.includes("127.0.0.1");
  return isLocalhost || config.apiKey.length > 0;
}

export async function chatCompletion(
  prompt: string,
  onProgress?: (text: string) => void,
  cancellationToken?: vscode.CancellationToken,
  logger?: vscode.OutputChannel
): Promise<string> {
  const config = getAIConfig();
  const url = new URL(`${config.endpoint}/chat/completions`);

  const requestBody = {
    model: config.model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 8192,
  };

  const body = JSON.stringify(requestBody);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (logger) {
    const maskedKey = config.apiKey ? `${config.apiKey.slice(0, 6)}...` : "(none)";
    logger.appendLine(`\n${"=".repeat(60)}`);
    logger.appendLine(`[API] Provider: OpenAI-compatible HTTP`);
    logger.appendLine(`[API] Endpoint: ${url.toString()}`);
    logger.appendLine(`[API] Model: ${config.model}`);
    logger.appendLine(`[API] API Key: ${maskedKey}`);
    logger.appendLine(`[API] Prompt length: ${prompt.length} chars`);
    logger.appendLine(`${"=".repeat(60)}`);
  }

  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  return new Promise<string>((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;

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
            const totalLen = chunks.reduce((s, c) => s + c.length, 0);
            onProgress(`${totalLen} bytes received...`);
          }
        });

        res.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf-8");

          if (res.statusCode && res.statusCode >= 400) {
            let errorMsg = `API error ${res.statusCode}`;
            try {
              const errJson = JSON.parse(rawBody) as {
                error?: { message?: string };
              };
              if (errJson.error?.message) {
                errorMsg = errJson.error.message;
              }
            } catch {
            }
            reject(new Error(errorMsg));
            return;
          }

          try {
            const json = JSON.parse(rawBody) as ChatCompletionResponse;
            const content = json.choices?.[0]?.message?.content ?? "";
            resolve(content);
          } catch {
            reject(new Error("Failed to parse API response"));
          }
        });

        res.on("error", reject);
      }
    );

    req.on("error", reject);

    if (cancellationToken) {
      cancellationToken.onCancellationRequested(() => {
        req.destroy();
        reject(new Error("Request cancelled"));
      });
    }

    req.write(body);
    req.end();
  });
}

export interface ToolCompletionOptions {
  messages: ChatMessage[];
  tools: unknown[];
  logger?: vscode.OutputChannel;
  cancellationToken?: vscode.CancellationToken;
}

export async function chatCompletionWithTools(
  options: ToolCompletionOptions
): Promise<ChatMessage> {
  const config = getAIConfig();
  const url = new URL(`${config.endpoint}/chat/completions`);

  const requestBody = {
    model: config.model,
    messages: options.messages,
    tools: options.tools,
    tool_choice: "auto" as const,
    temperature: 0.3,
    max_tokens: 8192,
  };

  const bodyStr = JSON.stringify(requestBody);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  return new Promise<ChatMessage>((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;

    const req = transport.request(
      url,
      { method: "POST", headers },
      (res) => {
        const chunks: Buffer[] = [];

        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });

        res.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf-8");

          if (res.statusCode && res.statusCode >= 400) {
            let errorMsg = `API error ${res.statusCode}`;
            try {
              const errJson = JSON.parse(rawBody) as {
                error?: { message?: string };
              };
              if (errJson.error?.message) {
                errorMsg = errJson.error.message;
              }
            } catch {
            }
            reject(new Error(errorMsg));
            return;
          }

          try {
            const json = JSON.parse(rawBody) as ChatCompletionResponse;
            const msg = json.choices?.[0]?.message;
            if (!msg) {
              reject(new Error("No message in API response"));
              return;
            }

            const result: ChatMessage = {
              role: "assistant",
              content: msg.content ?? null,
            };

            if (msg.tool_calls && msg.tool_calls.length > 0) {
              result.tool_calls = msg.tool_calls;
            }

            resolve(result);
          } catch {
            reject(new Error("Failed to parse API response"));
          }
        });

        res.on("error", reject);
      }
    );

    req.on("error", reject);

    if (options.cancellationToken) {
      options.cancellationToken.onCancellationRequested(() => {
        req.destroy();
        reject(new Error("Request cancelled"));
      });
    }

    req.write(bodyStr);
    req.end();
  });
}
