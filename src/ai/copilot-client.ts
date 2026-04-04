import * as vscode from "vscode";
import {
  AIConfig,
  ChatMessage,
  ToolCall,
  ToolCompletionOptions,
} from "./client-shared";

const COPILOT_VENDOR = "copilot";
const JUSTIFICATION = "Generate and explore code walkthroughs for the current workspace.";

export async function chooseCopilotModel(
  placeHolder: string,
  persistSelection: boolean,
  config: AIConfig
): Promise<vscode.LanguageModelChat | null> {
  const models = await vscode.lm.selectChatModels({ vendor: COPILOT_VENDOR });
  if (models.length === 0) {
    return null;
  }

  const preferredIds = [config.copilotModel, config.model].filter((value) => value.length > 0);
  for (const preferredId of preferredIds) {
    const match = models.find((model) => model.id === preferredId);
    if (match) {
      return match;
    }
  }

  if (models.length === 1) {
    if (persistSelection) {
      await rememberCopilotModel(models[0]);
    }
    return models[0];
  }

  const pick = await vscode.window.showQuickPick(
    models.map((model) => ({
      label: model.name || model.family || model.id,
      description: `${model.vendor}/${model.family}`,
      detail: model.id,
      model,
    })),
    {
      placeHolder,
      ignoreFocusOut: true,
    }
  );

  if (!pick) {
    return null;
  }

  if (persistSelection) {
    await rememberCopilotModel(pick.model);
  }

  return pick.model;
}

export async function copilotChatCompletion(
  prompt: string,
  config: AIConfig,
  onProgress?: (text: string) => void,
  cancellationToken?: vscode.CancellationToken,
  logger?: vscode.OutputChannel
): Promise<string> {
  const model = await chooseCopilotModel(
    "Select the Copilot model to use for walkthrough generation",
    true,
    config
  );

  if (!model) {
    throw new Error("No Copilot chat models are available.");
  }

  if (logger) {
    logger.appendLine(`\n${"=".repeat(60)}`);
    logger.appendLine(`[API] Provider: VS Code Copilot Language Model API`);
    logger.appendLine(`[API] Model: ${model.id} (${model.vendor}/${model.family})`);
    logger.appendLine(`[API] Prompt length: ${prompt.length} chars`);
    logger.appendLine(`${"=".repeat(60)}`);
  }

  const response = await model.sendRequest(
    [vscode.LanguageModelChatMessage.User(prompt)],
    { justification: JUSTIFICATION },
    cancellationToken
  );

  let fullText = "";
  for await (const chunk of response.text) {
    fullText += chunk;
    onProgress?.(`${fullText.length} chars received...`);
  }

  return fullText;
}

export async function copilotChatCompletionWithTools(
  options: ToolCompletionOptions,
  config: AIConfig
): Promise<ChatMessage> {
  const model = await chooseCopilotModel(
    "Select the Copilot model to use for deep exploration",
    true,
    config
  );

  if (!model) {
    throw new Error("No Copilot chat models are available.");
  }

  if (options.logger) {
    options.logger.appendLine(`[Copilot] Tool-enabled request using model ${model.id}`);
  }

  const tools = toCopilotTools(options.tools);
  const response = await model.sendRequest(
    toCopilotMessages(options.messages),
    {
      justification: JUSTIFICATION,
      ...(tools.length > 0
        ? {
            tools,
            toolMode: vscode.LanguageModelChatToolMode.Auto,
          }
        : {}),
    },
    options.cancellationToken
  );

  const textChunks: string[] = [];
  const toolCalls: ToolCall[] = [];

  for await (const chunk of response.stream) {
    if (chunk instanceof vscode.LanguageModelTextPart) {
      textChunks.push(chunk.value);
      continue;
    }

    if (chunk instanceof vscode.LanguageModelToolCallPart) {
      toolCalls.push({
        id: chunk.callId,
        type: "function",
        function: {
          name: chunk.name,
          arguments: JSON.stringify(chunk.input ?? {}),
        },
      });
    }
  }

  return {
    role: "assistant",
    content: textChunks.join("") || null,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
}

async function rememberCopilotModel(model: vscode.LanguageModelChat): Promise<void> {
  const config = vscode.workspace.getConfiguration("codeWalkthrough.ai");
  await config.update("copilotModel", model.id, vscode.ConfigurationTarget.Global);
  await config.update("model", model.id, vscode.ConfigurationTarget.Global);
}

function toCopilotMessages(messages: ChatMessage[]): vscode.LanguageModelChatMessage[] {
  const systemPrompt = messages
    .filter((message) => message.role === "system" && message.content)
    .map((message) => message.content)
    .join("\n\n")
    .trim();

  const result: vscode.LanguageModelChatMessage[] = [];
  let systemApplied = false;

  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }

    if (message.role === "tool") {
      if (!message.tool_call_id) {
        continue;
      }
      result.push(
        vscode.LanguageModelChatMessage.User([
          new vscode.LanguageModelToolResultPart(message.tool_call_id, [
            new vscode.LanguageModelTextPart(message.content ?? ""),
          ]),
        ])
      );
      continue;
    }

    if (message.role === "assistant") {
      const parts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart> = [];
      if (message.content) {
        parts.push(new vscode.LanguageModelTextPart(message.content));
      }
      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          parts.push(
            new vscode.LanguageModelToolCallPart(
              toolCall.id,
              toolCall.function.name,
              parseToolArguments(toolCall)
            )
          );
        }
      }
      if (parts.length > 0) {
        result.push(vscode.LanguageModelChatMessage.Assistant(parts));
      }
      continue;
    }

    const userText = !systemApplied && systemPrompt
      ? `${systemPrompt}\n\n${message.content ?? ""}`.trim()
      : (message.content ?? "");
    systemApplied = true;
    if (userText) {
      result.push(vscode.LanguageModelChatMessage.User(userText));
    }
  }

  if (!systemApplied && systemPrompt) {
    result.unshift(vscode.LanguageModelChatMessage.User(systemPrompt));
  }

  return result;
}

function toCopilotTools(tools: unknown[]): vscode.LanguageModelChatTool[] {
  return tools.flatMap((tool) => {
    if (typeof tool !== "object" || tool === null) {
      return [];
    }

    const value = tool as {
      type?: string;
      function?: {
        name?: string;
        description?: string;
        parameters?: object;
      };
    };

    if (value.type !== "function" || !value.function?.name || !value.function.description) {
      return [];
    }

    return [{
      name: value.function.name,
      description: value.function.description,
      inputSchema: value.function.parameters,
    }];
  });
}

function parseToolArguments(toolCall: ToolCall): object {
  try {
    return JSON.parse(toolCall.function.arguments) as object;
  } catch {
    return { rawArguments: toolCall.function.arguments };
  }
}