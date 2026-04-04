import * as vscode from "vscode";
import { ChatMessage, chatCompletionWithTools, getAIConfig } from "./llm-client";
import { TOOL_DEFINITIONS } from "./tools/definitions";
import { executeTool } from "./tools/executor";

const MAX_ITERATIONS = 15;
const MAX_EMPTY_RESPONSES = 2;

const SYSTEM_PROMPT = `You are a senior developer creating an interactive code walkthrough.

Your goal: explore the codebase using the provided tools, understand the architecture and execution flow, then output a walkthrough JSON that guides a new developer through the code.

EXPLORATION STRATEGY:
1. Start with list_files(".") to see the project structure
2. Read entry points (main, index, app, extension) first
3. Use get_symbols to understand file APIs before reading full content
4. Use search to trace how functions/classes are connected
5. Follow imports and function calls to build a mental model
6. Focus on the INTERESTING parts — skip boilerplate, config, and generated code

When you have enough understanding, output ONLY valid JSON (no markdown fences, no explanation) matching this format:

{
  "title": "Short descriptive title",
  "description": "One sentence describing what this walkthrough covers",
  "related": [
    {
      "path": ".walkthrough/other-walkthrough.json",
      "title": "Optional title",
      "type": "related",
      "note": "Optional reason this is worth opening next"
    }
  ],
  "steps": [
    {
      "file": "relative/path/to/file.ts",
      "lines": [startLine, endLine],
      "symbol": "nearestFunctionOrClassName",
      "subtitle": "2-3 sentence explanation of what this code does and why it matters.",
      "duration": 8
    }
  ]
}

REQUIREMENTS:
- 5-15 steps depending on codebase complexity
- Start from entry points, follow execution flow
- Each step highlights 3-20 lines (focused sections, not entire files)
- Line numbers must be accurate (use the line numbers shown by read_file)
- Subtitles explain WHAT and WHY, not just restate the code
- Include "related" only when there is a meaningful connection to another walkthrough provided in the catalog
- Order steps to tell a coherent story
- Do NOT output the JSON until you have explored enough to be accurate`;

export interface AgenticWalkthroughRequest {
  objective: string;
  userGuidance?: string;
  walkthroughCatalog?: string;
  targetWalkthroughJson?: string;
  referenceWalkthroughsJson?: string;
}

export async function runAgenticGeneration(
  folderUri: vscode.Uri,
  logger: vscode.OutputChannel,
  progress: vscode.Progress<{ message?: string }>,
  cancellationToken: vscode.CancellationToken,
  request?: AgenticWalkthroughRequest
): Promise<string | null> {
  const config = getAIConfig();
  const rootFolder = vscode.workspace.asRelativePath(folderUri, false);

  logger.appendLine(`\n${"=".repeat(60)}`);
  logger.appendLine(`[Agentic] Starting deep exploration`);
  logger.appendLine(`[Agentic] Folder: ${rootFolder}`);
  logger.appendLine(`[Agentic] Client: ${config.client}`);
  logger.appendLine(`[Agentic] Endpoint: ${config.endpoint}`);
  logger.appendLine(`[Agentic] Model: ${config.model}`);
  logger.appendLine(`[Agentic] Max iterations: ${MAX_ITERATIONS}`);
  logger.appendLine(`${"=".repeat(60)}`);
  logger.show(true);

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: buildInitialRequest(rootFolder, request),
    },
  ];
  let emptyResponses = 0;

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    if (cancellationToken.isCancellationRequested) {
      logger.appendLine(`[Agentic] Cancelled by user at iteration ${iteration}`);
      return null;
    }

    progress.report({ message: `Exploring... (step ${iteration}/${MAX_ITERATIONS})` });
    logger.appendLine(`\n--- Iteration ${iteration}/${MAX_ITERATIONS} ---`);

    let response: ChatMessage;
    try {
      response = await chatCompletionWithTools({
        messages,
        tools: TOOL_DEFINITIONS,
        logger,
        cancellationToken,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.appendLine(`[Agentic] API error: ${msg}`);
      throw new Error(`API request failed at iteration ${iteration}: ${msg}`);
    }

    messages.push(response);

    if (response.tool_calls && response.tool_calls.length > 0) {
      logger.appendLine(
        `[Agentic] LLM requested ${response.tool_calls.length} tool call(s)`
      );

      if (response.content) {
        logger.appendLine(`[Agentic] LLM thinking: ${response.content.slice(0, 200)}`);
      }

      const toolResults = await Promise.all(
        response.tool_calls.map(async (call) => {
          const result = await executeTool(call.function.name, call.function.arguments, logger);
          const truncated =
            result.length > 8000
              ? result.slice(0, 8000) + "\n... (truncated)"
              : result;

          return {
            role: "tool" as const,
            tool_call_id: call.id,
            content: truncated,
          };
        })
      );

      for (const tr of toolResults) {
        messages.push(tr);
      }

      continue;
    }

    if (response.content) {
      emptyResponses = 0;
      logger.appendLine(`[Agentic] LLM produced final response (${response.content.length} chars)`);
      logger.appendLine(`[Agentic] Completed in ${iteration} iteration(s)`);
      return response.content;
    }

    emptyResponses += 1;
    logger.appendLine(`[Agentic] Empty response with no tool calls — retrying`);
    if (emptyResponses >= MAX_EMPTY_RESPONSES) {
      throw new Error(
        `The configured ${config.client} client returned ${emptyResponses} empty responses in a row. ` +
        `This endpoint likely does not support the expected deep-exploration tool protocol for this model. ` +
        `Try Quick Scan, switch client protocol, or use a model/endpoint with tool support.`
      );
    }
    messages.push({
      role: "user",
      content: "Please continue exploring or output the final walkthrough JSON.",
    });
  }

  logger.appendLine(`[Agentic] Reached max iterations (${MAX_ITERATIONS})`);
  messages.push({
    role: "user",
    content:
      "You have reached the exploration limit. Please output the walkthrough JSON now based on what you have learned so far.",
  });

  let finalResponse: ChatMessage;
  try {
    finalResponse = await chatCompletionWithTools({
      messages,
      tools: [],
      cancellationToken,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.appendLine(`[Agentic] Final request failed: ${msg}`);
    throw new Error(`Final generation failed: ${msg}`);
  }

  if (finalResponse.content) {
    logger.appendLine(
      `[Agentic] Final response after limit (${finalResponse.content.length} chars)`
    );
    return finalResponse.content;
  }

  logger.appendLine(`[Agentic] No final response produced`);
  return null;
}

function buildInitialRequest(
  rootFolder: string,
  request?: AgenticWalkthroughRequest
): string {
  const sections = [
    request?.objective ??
      `Create a walkthrough for the codebase in folder "${rootFolder}". Start by listing files to understand the structure, then explore the code.`,
    `Working folder: ${rootFolder}`,
  ];

  if (request?.userGuidance?.trim()) {
    sections.push(`User guidance:\n${request.userGuidance.trim()}`);
  }

  if (request?.walkthroughCatalog?.trim()) {
    sections.push(`Existing walkthrough catalog:\n${request.walkthroughCatalog.trim()}`);
  }

  if (request?.targetWalkthroughJson?.trim()) {
    sections.push(`Target walkthrough to transform:\n${request.targetWalkthroughJson.trim()}`);
  }

  if (request?.referenceWalkthroughsJson?.trim()) {
    sections.push(`Reference walkthroughs:\n${request.referenceWalkthroughsJson.trim()}`);
  }

  sections.push("Start by listing files to understand the structure, then explore the code before producing the final walkthrough JSON.");

  return sections.join("\n\n");
}
