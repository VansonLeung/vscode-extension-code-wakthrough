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
  ToolCompletionOptions,
} from "./client-shared";

interface ChatCompletionChoice {
  message?: {
    role?: string;
    content?: string | null;
    tool_calls?: ChatMessage["tool_calls"];
  };
}

interface ChatCompletionResponse {
  choices: ChatCompletionChoice[];
}

export async function openAIChatCompletion(
  prompt: string,
  config: AIConfig,
  onProgress?: (text: string) => void,
  cancellationToken?: vscode.CancellationToken,
  logger?: vscode.OutputChannel
): Promise<string> {
  const url = buildApiUrl(config.endpoint, "/chat/completions");

  const requestBody = {
    model: config.model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    max_tokens: 8192,
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

  const response = await sendOpenAIRequest(url, requestBody, config, cancellationToken, onProgress);
  return response.choices?.[0]?.message?.content ?? "";
}

export async function openAIChatCompletionWithTools(
  options: ToolCompletionOptions,
  config: AIConfig
): Promise<ChatMessage> {
  const url = buildApiUrl(config.endpoint, "/chat/completions");

  const requestBody = {
    model: config.model,
    messages: options.messages,
    tools: options.tools,
    tool_choice: "auto" as const,
    temperature: 0.3,
    max_tokens: 8192,
  };

  const response = await sendOpenAIRequest(url, requestBody, config, options.cancellationToken);
  const msg = response.choices?.[0]?.message;
  if (!msg) {
    throw new Error("No message in API response");
  }

  return {
    role: "assistant",
    content: msg.content ?? null,
    ...(msg.tool_calls && msg.tool_calls.length > 0 ? { tool_calls: msg.tool_calls } : {}),
  };
}

function sendOpenAIRequest(
  url: URL,
  requestBody: unknown,
  config: AIConfig,
  cancellationToken?: vscode.CancellationToken,
  onProgress?: (text: string) => void
): Promise<ChatCompletionResponse> {
  const body = JSON.stringify(requestBody);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  return new Promise<ChatCompletionResponse>((resolve, reject) => {
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
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(parseErrorMessage(rawBody, `API error ${res.statusCode}`)));
            return;
          }

          try {
            resolve(JSON.parse(rawBody) as ChatCompletionResponse);
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
