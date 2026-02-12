import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";
import { CodeContext, collectCodeContext } from "./context";
import { Walkthrough, WalkthroughStep } from "../walkthrough/types";
import { getHeadSha } from "../git/git";
import { chatCompletion, isAIConfigured } from "./openai-client";
import { runAgenticGeneration } from "./agentic";

const log = vscode.window.createOutputChannel("Code Walkthrough");

export type GenerationStrategy = "quick" | "deep";

function getDefaultStrategy(): GenerationStrategy {
  const config = vscode.workspace.getConfiguration("codeWalkthrough.ai");
  return config.get<string>("strategy") === "deep" ? "deep" : "quick";
}

export async function generateWalkthrough(
  folderUri: vscode.Uri
): Promise<vscode.Uri | null> {
  const defaultStrategy = getDefaultStrategy();

  const pick = await vscode.window.showQuickPick(
    [
      {
        label: "$(zap) Quick Scan",
        description: "Sends code context in one shot (works with all providers including Copilot)",
        strategy: "quick" as GenerationStrategy,
      },
      {
        label: "$(search) Deep Exploration",
        description: "LLM explores codebase interactively using tools (requires OpenAI-compatible API with function calling)",
        strategy: "deep" as GenerationStrategy,
      },
    ],
    {
      placeHolder: "Choose generation strategy",
    }
  );

  if (!pick) {
    return null;
  }

  const strategy = pick.strategy ?? defaultStrategy;

  if (strategy === "deep") {
    return generateWithAgenticStrategy(folderUri);
  }

  return generateWithContextDumpStrategy(folderUri);
}

async function generateWithAgenticStrategy(
  folderUri: vscode.Uri
): Promise<vscode.Uri | null> {
  if (!isAIConfigured()) {
    const action = await vscode.window.showWarningMessage(
      "Deep Exploration requires an OpenAI-compatible API with tool/function calling support. Copilot is not supported for this strategy.",
      "Setup AI",
      "Use Quick Scan"
    );
    if (action === "Setup AI") {
      vscode.commands.executeCommand("codeWalkthrough.setupAI");
      return null;
    }
    if (action === "Use Quick Scan") {
      return generateWithContextDumpStrategy(folderUri);
    }
    return null;
  }

  try {
    const rawResponse = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Deep exploration in progress...",
        cancellable: true,
      },
      (progress, token) => runAgenticGeneration(folderUri, log, progress, token)
    );

    if (!rawResponse) {
      return null;
    }

    return parseAndSave(rawResponse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    log.appendLine(`[Agentic] Fatal error: ${msg}`);
    vscode.window.showErrorMessage(`Deep exploration failed: ${msg}. Check 'Code Walkthrough' output.`);
    return null;
  }
}

async function generateWithContextDumpStrategy(
  folderUri: vscode.Uri
): Promise<vscode.Uri | null> {
  const context = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Collecting code context...",
      cancellable: false,
    },
    () => collectCodeContext(folderUri)
  );

  if (context.files.length === 0) {
    vscode.window.showWarningMessage("No source files found in the selected folder.");
    return null;
  }

  const prompt = buildPrompt(context);

  const copilotModel = await selectCopilotModel();
  if (copilotModel) {
    return generateViaCopilot(copilotModel, prompt);
  }

  if (isAIConfigured()) {
    return generateViaOpenAI(prompt);
  }

  return fallbackToClipboard(prompt);
}

async function selectCopilotModel(): Promise<vscode.LanguageModelChat | null> {
  try {
    const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
    if (models.length > 0) {
      return models[0];
    }
  } catch {
  }
  return null;
}

async function generateViaCopilot(
  model: vscode.LanguageModelChat,
  prompt: string
): Promise<vscode.Uri | null> {
  log.appendLine(`\n${"=".repeat(60)}`);
  log.appendLine(`[API] Provider: VS Code Copilot Language Model API`);
  log.appendLine(`[API] Model: ${model.id} (${model.vendor}/${model.family})`);
  log.appendLine(`[API] Prompt length: ${prompt.length} chars`);
  log.appendLine(`${"=".repeat(60)}`);

  const messages = [vscode.LanguageModelChatMessage.User(prompt)];
  const tokenSource = new vscode.CancellationTokenSource();

  try {
    const response = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Generating walkthrough via Copilot...",
        cancellable: true,
      },
      async (progress, token) => {
        token.onCancellationRequested(() => tokenSource.cancel());
        const chatResponse = await model.sendRequest(
          messages,
          {},
          tokenSource.token
        );
        let fullText = "";
        for await (const chunk of chatResponse.text) {
          fullText += chunk;
          progress.report({ message: `${fullText.length} chars received...` });
        }
        return fullText;
      }
    );
    log.appendLine(`[Copilot] Response length: ${response.length}`);
    log.appendLine(`[Copilot] Response (first 2000 chars):\n${response.slice(0, 2000)}`);
    return parseAndSave(response);
  } catch (err) {
    if (err instanceof vscode.LanguageModelError) {
      vscode.window.showErrorMessage(`Copilot failed: ${err.message}`);
    }
    if (isAIConfigured()) {
      return generateViaOpenAI(prompt);
    }
    return fallbackToClipboard(prompt);
  } finally {
    tokenSource.dispose();
  }
}

async function generateViaOpenAI(prompt: string): Promise<vscode.Uri | null> {
  try {
    const response = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Generating walkthrough via API...",
        cancellable: true,
      },
      async (progress, token) => {
        return chatCompletion(
          prompt,
          (msg) => progress.report({ message: msg }),
          token,
          log
        );
      }
    );
    log.appendLine(`[OpenAI] Response length: ${response.length}`);
    log.appendLine(`[OpenAI] Response (first 2000 chars):\n${response.slice(0, 2000)}`);
    return parseAndSave(response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    log.appendLine(`[OpenAI] Error: ${msg}`);
    vscode.window.showErrorMessage(`API request failed: ${msg}`);
    return fallbackToClipboard(prompt);
  }
}

async function fallbackToClipboard(prompt: string): Promise<vscode.Uri | null> {
  await vscode.env.clipboard.writeText(prompt);

  const action = await vscode.window.showInformationMessage(
    "No AI model available. Prompt copied to clipboard. " +
    "Configure an API key via 'Walkthrough: Setup AI Provider', or paste the prompt into your LLM manually.",
    "Setup AI",
    "Paste Response"
  );

  if (action === "Setup AI") {
    vscode.commands.executeCommand("codeWalkthrough.setupAI");
    return null;
  }

  if (action === "Paste Response") {
    const json = await vscode.window.showInputBox({
      prompt: "Paste the walkthrough JSON from your LLM",
      placeHolder: '{ "title": "...", "steps": [...] }',
    });
    if (json) {
      return parseAndSave(json);
    }
  }

  return null;
}

async function parseAndSave(rawResponse: string): Promise<vscode.Uri | null> {
  log.appendLine(`[Parse] Raw response length: ${rawResponse.length}`);
  log.appendLine(`[Parse] Raw response:\n---START---\n${rawResponse}\n---END---`);
  log.show(true);

  const jsonMatch = rawResponse.match(/\{[\s\S]*"steps"[\s\S]*\}/);
  if (!jsonMatch) {
    log.appendLine(`[Parse] FAILED: No JSON match found. Response does not contain {"steps"...} pattern.`);
    vscode.window.showErrorMessage(
      "Could not parse walkthrough JSON from the AI response. Check 'Code Walkthrough' output for details."
    );
    return null;
  }

  log.appendLine(`[Parse] JSON match length: ${jsonMatch[0].length}`);
  log.appendLine(`[Parse] JSON match (first 1000 chars):\n${jsonMatch[0].slice(0, 1000)}`);

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      title?: string;
      description?: string;
      steps?: Array<{
        file?: string;
        lines?: [number, number];
        symbol?: string;
        subtitle?: string;
        duration?: number;
      }>;
    };

    log.appendLine(`[Parse] Parsed OK. title="${parsed.title}", steps=${parsed.steps?.length ?? 0}`);

    if (!parsed.title || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      log.appendLine(`[Parse] FAILED validation: title=${!!parsed.title}, steps=${Array.isArray(parsed.steps)}, count=${parsed.steps?.length ?? 0}`);
      vscode.window.showErrorMessage("Invalid walkthrough structure in AI response. Check 'Code Walkthrough' output.");
      return null;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return null;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const commitSha = await getHeadSha();

    const steps: WalkthroughStep[] = [];
    for (const s of parsed.steps) {
      if (!s.file || !s.lines || !s.subtitle) {
        continue;
      }

      const filePath = path.resolve(rootPath, s.file);
      let contentHash: string | undefined;

      try {
        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.file(filePath)
        );
        const startLine = Math.max(0, s.lines[0] - 1);
        const endLine = Math.min(doc.lineCount - 1, s.lines[1] - 1);
        const content = doc.getText(
          new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).text.length)
        );
        contentHash = crypto
          .createHash("sha256")
          .update(content)
          .digest("hex")
          .slice(0, 12);
      } catch {
      }

      steps.push({
        file: s.file,
        lines: s.lines,
        symbol: s.symbol,
        contentHash,
        subtitle: s.subtitle,
        duration: s.duration ?? 8,
      });
    }

    if (steps.length === 0) {
      vscode.window.showErrorMessage("No valid steps in the AI response.");
      return null;
    }

    const walkthrough: Walkthrough = {
      title: parsed.title,
      description: parsed.description ?? "",
      commitSha: commitSha ?? undefined,
      steps,
    };

    const walkthroughDir = path.join(rootPath, ".walkthrough");
    try {
      await vscode.workspace.fs.createDirectory(
        vscode.Uri.file(walkthroughDir)
      );
    } catch {
    }

    const slug = parsed.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const fileName = `${slug}.json`;
    const uri = vscode.Uri.file(path.join(walkthroughDir, fileName));

    const content = JSON.stringify(walkthrough, null, 2) + "\n";
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));

    vscode.window.showInformationMessage(
      `AI walkthrough saved: .walkthrough/${fileName} (${steps.length} steps)`
    );

    return uri;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.appendLine(`[Parse] JSON.parse FAILED: ${msg}`);
    log.appendLine(`[Parse] Attempted to parse:\n${jsonMatch[0].slice(0, 500)}`);
    vscode.window.showErrorMessage(`Failed to parse JSON from AI response: ${msg}. Check 'Code Walkthrough' output.`);
    return null;
  }
}

function buildPrompt(context: CodeContext): string {
  const fileList = context.files
    .map((f) => `- ${f.relativePath} (${f.lineCount} lines) [${f.symbols.slice(0, 8).join(", ")}]`)
    .join("\n");

  const filePreviews = context.files
    .map((f) => `=== ${f.relativePath} ===\n${f.preview}`)
    .join("\n\n");

  return `You are a senior developer creating an interactive code walkthrough for a codebase.

TASK: Generate a step-by-step walkthrough JSON that explains how this code works. The walkthrough should guide a new developer through the codebase in a logical order, starting from entry points and following the execution flow.

CODEBASE STRUCTURE:
Root folder: ${context.rootFolder}
Total files: ${context.files.length}
Total lines: ${context.totalLines}

FILES AND SYMBOLS:
${fileList}

FILE CONTENTS:
${filePreviews}

OUTPUT FORMAT - Return ONLY valid JSON matching this exact structure:
{
  "title": "Short descriptive title",
  "description": "One sentence describing what this walkthrough covers",
  "steps": [
    {
      "file": "relative/path/to/file.ts",
      "lines": [startLine, endLine],
      "symbol": "nearestFunctionOrClassName",
      "subtitle": "2-3 sentence explanation of what this code does and why it matters. Be specific about the actual code, not generic.",
      "duration": 8
    }
  ]
}

REQUIREMENTS:
- 5-15 steps depending on codebase size
- Start from entry points (main, index, app) and follow the execution flow
- Each step should highlight 3-20 lines (focused, not entire files)
- Line numbers must be 1-indexed and accurate for the file contents shown
- Subtitles should explain WHAT the code does and WHY, not just restate the code
- Use the actual symbol names from the code
- Order steps to tell a coherent story (setup → core logic → helpers → output)
- Do NOT wrap the JSON in markdown code fences`;
}
