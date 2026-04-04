import * as vscode from "vscode";
import { anthropicChatCompletion, anthropicChatCompletionWithTools } from "./anthropic-client";
import { chooseCopilotModel, copilotChatCompletion, copilotChatCompletionWithTools } from "./copilot-client";
import {
  AIConfig,
  ChatMessage,
  getAIConfig,
  isAIConfigured,
  ToolCall,
  ToolCompletionOptions,
} from "./client-shared";
import { openAIChatCompletion, openAIChatCompletionWithTools } from "./openai-client";

export type { AIClientType, AIConfig, ChatMessage, ToolCall, ToolCompletionOptions } from "./client-shared";
export { getAIConfig, isAIConfigured } from "./client-shared";
export { chooseCopilotModel } from "./copilot-client";

export async function chatCompletion(
  prompt: string,
  onProgress?: (text: string) => void,
  cancellationToken?: vscode.CancellationToken,
  logger?: vscode.OutputChannel,
  config: AIConfig = getAIConfig()
): Promise<string> {
  switch (config.client) {
    case "anthropic":
      return anthropicChatCompletion(prompt, config, onProgress, cancellationToken, logger);
    case "copilot":
      return copilotChatCompletion(prompt, config, onProgress, cancellationToken, logger);
    default:
      return openAIChatCompletion(prompt, config, onProgress, cancellationToken, logger);
  }
}

export async function chatCompletionWithTools(
  options: ToolCompletionOptions,
  config: AIConfig = getAIConfig()
): Promise<ChatMessage> {
  switch (config.client) {
    case "anthropic":
      return anthropicChatCompletionWithTools(options, config);
    case "copilot":
      return copilotChatCompletionWithTools(options, config);
    default:
      return openAIChatCompletionWithTools(options, config);
  }
}