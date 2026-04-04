import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";
import { CodeContext, collectCodeContext } from "./context";
import {
  Walkthrough,
  WalkthroughFile,
  WalkthroughRelation,
  WalkthroughStep,
} from "../walkthrough/types";
import { discoverWalkthroughs } from "../walkthrough/loader";
import { getHeadSha } from "../git/git";
import { chatCompletion, getAIConfig, isAIConfigured } from "./llm-client";
import { AgenticWalkthroughRequest, runAgenticGeneration } from "./agentic";

const log = vscode.window.createOutputChannel("Code Walkthrough");
const RELATION_TYPES = new Set(["related", "prerequisite", "follow-up", "alternative"]);

export type GenerationStrategy = "quick" | "deep";
export type TransformMode = "modify" | "extend" | "refactor";

interface PromptContextOptions {
  userGuidance?: string;
  walkthroughCatalog?: WalkthroughFile[];
}

interface TransformOptions {
  mode: TransformMode;
  userGuidance?: string;
  target: WalkthroughFile;
  references: WalkthroughFile[];
}

interface SaveOptions {
  overwriteUri?: vscode.Uri;
}

function getDefaultStrategy(): GenerationStrategy {
  const config = vscode.workspace.getConfiguration("codeWalkthrough.ai");
  return config.get<string>("strategy") === "deep" ? "deep" : "quick";
}

export async function generateWalkthrough(
  folderUri: vscode.Uri
): Promise<vscode.Uri | null> {
  const strategy = await chooseStrategy();
  if (!strategy) {
    return null;
  }

  const userGuidance = await promptForGuidance(
    "Optional AI guidance",
    "What should the walkthrough focus on, find out, or drill into? Leave blank to let the AI decide."
  );
  if (userGuidance === undefined) {
    return null;
  }

  const walkthroughCatalog = await discoverWalkthroughs();
  const options: PromptContextOptions = {
    userGuidance,
    walkthroughCatalog,
  };

  if (strategy === "deep") {
    return generateWithAgenticStrategy(folderUri, options);
  }

  return generateWithContextDumpStrategy(folderUri, options);
}

export async function transformWalkthroughsWithAI(
  targets: WalkthroughFile[]
): Promise<vscode.Uri[]> {
  if (targets.length === 0) {
    return [];
  }

  const mode = await chooseTransformMode();
  if (!mode) {
    return [];
  }

  const userGuidance = await promptForGuidance(
    `AI instructions for ${mode}`,
    `Describe how the AI should ${mode} the selected walkthrough${targets.length === 1 ? "" : "s"}.`
  );
  if (userGuidance === undefined) {
    return [];
  }

  const strategy = await chooseStrategy();
  if (!strategy) {
    return [];
  }

  const allWalkthroughs = await discoverWalkthroughs();
  const targetUris = new Set(targets.map((target) => target.uri));
  const referenceCandidates = allWalkthroughs.filter(
    (file) => !targetUris.has(file.uri)
  );
  const references = await pickReferenceWalkthroughs(referenceCandidates);
  if (references === null) {
    return [];
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return [];
  }

  const folderUri = workspaceFolders[0].uri;
  const results: vscode.Uri[] = [];

  for (const target of targets) {
    const options: TransformOptions = {
      mode,
      userGuidance,
      target,
      references,
    };

    const uri = strategy === "deep"
      ? await transformWithAgenticStrategy(folderUri, options, allWalkthroughs)
      : await transformWithContextDumpStrategy(folderUri, options, allWalkthroughs);

    if (uri) {
      results.push(uri);
    }
  }

  return results;
}

async function generateWithAgenticStrategy(
  folderUri: vscode.Uri,
  options: PromptContextOptions
): Promise<vscode.Uri | null> {
  if (!isAIConfigured()) {
    const action = await vscode.window.showWarningMessage(
      "Deep Exploration requires a configured AI provider.",
      "Setup AI",
      "Use Quick Scan"
    );
    if (action === "Setup AI") {
      void vscode.commands.executeCommand("codeWalkthrough.setupAI");
      return null;
    }
    if (action === "Use Quick Scan") {
      return generateWithContextDumpStrategy(folderUri, options);
    }
    return null;
  }

  try {
    const request: AgenticWalkthroughRequest = {
      objective: `Create a new walkthrough for the codebase in folder "${vscode.workspace.asRelativePath(folderUri, false)}".`,
      userGuidance: options.userGuidance,
      walkthroughCatalog: formatWalkthroughCatalog(options.walkthroughCatalog ?? []),
    };

    const rawResponse = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Deep exploration in progress...",
        cancellable: true,
      },
      (progress, token) => runAgenticGeneration(folderUri, log, progress, token, request)
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
  folderUri: vscode.Uri,
  options: PromptContextOptions
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

  const prompt = buildPrompt(context, options);

  if (isAIConfigured()) {
    return generateViaConfiguredProvider(prompt);
  }

  return fallbackToClipboard(prompt);
}

async function transformWithAgenticStrategy(
  folderUri: vscode.Uri,
  options: TransformOptions,
  walkthroughCatalog: WalkthroughFile[]
): Promise<vscode.Uri | null> {
  if (!isAIConfigured()) {
    const action = await vscode.window.showWarningMessage(
      "Deep Exploration requires a configured AI provider.",
      "Setup AI",
      "Use Quick Scan"
    );
    if (action === "Setup AI") {
      void vscode.commands.executeCommand("codeWalkthrough.setupAI");
      return null;
    }
    if (action === "Use Quick Scan") {
      return transformWithContextDumpStrategy(folderUri, options, walkthroughCatalog);
    }
    return null;
  }

  const request: AgenticWalkthroughRequest = {
    objective: buildTransformObjective(options),
    userGuidance: options.userGuidance,
    walkthroughCatalog: formatWalkthroughCatalog(
      walkthroughCatalog.filter((file) => file.uri !== options.target.uri)
    ),
    targetWalkthroughJson: JSON.stringify(options.target.walkthrough, null, 2),
    referenceWalkthroughsJson: options.references.length > 0
      ? JSON.stringify(
          options.references.map((file) => ({
            path: file.relativePath,
            walkthrough: file.walkthrough,
          })),
          null,
          2
        )
      : undefined,
  };

  try {
    const rawResponse = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `${transformModeLabel(options.mode)} ${options.target.walkthrough.title} with AI...`,
        cancellable: true,
      },
      (progress, token) => runAgenticGeneration(folderUri, log, progress, token, request)
    );

    if (!rawResponse) {
      return null;
    }

    return parseAndSave(rawResponse, {
      overwriteUri: vscode.Uri.file(options.target.uri),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    log.appendLine(`[Agentic Transform] Fatal error: ${msg}`);
    vscode.window.showErrorMessage(`AI transform failed: ${msg}. Check 'Code Walkthrough' output.`);
    return null;
  }
}

async function transformWithContextDumpStrategy(
  folderUri: vscode.Uri,
  options: TransformOptions,
  walkthroughCatalog: WalkthroughFile[]
): Promise<vscode.Uri | null> {
  const context = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Collecting code context for ${options.target.walkthrough.title}...`,
      cancellable: false,
    },
    () => collectCodeContext(folderUri)
  );

  if (context.files.length === 0) {
    vscode.window.showWarningMessage("No source files found in the workspace.");
    return null;
  }

  const prompt = buildTransformPrompt(context, options, walkthroughCatalog);

  if (isAIConfigured()) {
    return generateViaConfiguredProvider(prompt, {
      overwriteUri: vscode.Uri.file(options.target.uri),
    });
  }

  return fallbackToClipboard(prompt, {
    overwriteUri: vscode.Uri.file(options.target.uri),
  });
}

async function chooseStrategy(): Promise<GenerationStrategy | null> {
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
        description: "LLM explores codebase interactively using tools using the configured provider",
        strategy: "deep" as GenerationStrategy,
      },
    ],
    {
      placeHolder: `Choose generation strategy (default: ${defaultStrategy})`,
      ignoreFocusOut: true,
    }
  );

  return pick?.strategy ?? null;
}

async function chooseTransformMode(): Promise<TransformMode | null> {
  const pick = await vscode.window.showQuickPick(
    [
      {
        label: "Modify",
        description: "Adjust the walkthrough in place",
        mode: "modify" as TransformMode,
      },
      {
        label: "Extend",
        description: "Add missing depth, branches, or supporting steps",
        mode: "extend" as TransformMode,
      },
      {
        label: "Refactor",
        description: "Reorder and rewrite for clarity or a new narrative",
        mode: "refactor" as TransformMode,
      },
    ],
    {
      placeHolder: "How should AI change the selected walkthrough(s)?",
      ignoreFocusOut: true,
    }
  );

  return pick?.mode ?? null;
}

async function promptForGuidance(
  prompt: string,
  placeHolder: string
): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt,
    placeHolder,
    ignoreFocusOut: true,
  });
}

async function pickReferenceWalkthroughs(
  options: WalkthroughFile[]
): Promise<WalkthroughFile[] | null> {
  if (options.length === 0) {
    return [];
  }

  const picks = await vscode.window.showQuickPick(
    options.map((file) => ({
      label: file.walkthrough.title,
      description: file.relativePath,
      detail: file.walkthrough.description,
      file,
    })),
    {
      canPickMany: true,
      placeHolder: "Optional: pick other walkthroughs to use as related context",
      ignoreFocusOut: true,
    }
  );

  return picks ? picks.map((pick) => pick.file) : null;
}

async function generateViaConfiguredProvider(
  prompt: string,
  saveOptions?: SaveOptions
): Promise<vscode.Uri | null> {
  const config = getAIConfig();
  const providerLabel = config.client === "copilot"
    ? "Copilot"
    : config.client === "anthropic"
      ? "Anthropic"
      : "OpenAI-compatible API";

  try {
    const response = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Generating walkthrough via ${providerLabel}...`,
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
    log.appendLine(`[${providerLabel}] Response length: ${response.length}`);
    log.appendLine(`[${providerLabel}] Response (first 2000 chars):\n${response.slice(0, 2000)}`);
    return parseAndSave(response, saveOptions);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    log.appendLine(`[${providerLabel}] Error: ${msg}`);
    vscode.window.showErrorMessage(`${providerLabel} request failed: ${msg}`);
    return null;
  }
}

async function fallbackToClipboard(
  prompt: string,
  saveOptions?: SaveOptions
): Promise<vscode.Uri | null> {
  await vscode.env.clipboard.writeText(prompt);

  const action = await vscode.window.showInformationMessage(
    "No AI model available. Prompt copied to clipboard. Configure an API key via 'Walkthrough: Setup AI Provider', or paste the prompt into your LLM manually.",
    "Setup AI",
    "Paste Response"
  );

  if (action === "Setup AI") {
    void vscode.commands.executeCommand("codeWalkthrough.setupAI");
    return null;
  }

  if (action === "Paste Response") {
    const json = await vscode.window.showInputBox({
      prompt: "Paste the walkthrough JSON from your LLM",
      placeHolder: '{ "title": "...", "steps": [...] }',
      ignoreFocusOut: true,
    });
    if (json) {
      return parseAndSave(json, saveOptions);
    }
  }

  return null;
}

async function parseAndSave(
  rawResponse: string,
  saveOptions?: SaveOptions
): Promise<vscode.Uri | null> {
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
      related?: Array<{
        path?: string;
        title?: string;
        type?: string;
        note?: string;
      }>;
      steps?: Array<{
        file?: string;
        lines?: [number, number];
        symbol?: string;
        subtitle?: string;
        explanation?: string;
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
    const related = normalizeRelations(parsed.related);

    const steps: WalkthroughStep[] = [];
    for (const step of parsed.steps) {
      if (!step.file || !step.lines || !step.subtitle) {
        continue;
      }

      const filePath = path.resolve(rootPath, step.file);
      let contentHash: string | undefined;

      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        const startLine = Math.max(0, step.lines[0] - 1);
        const endLine = Math.min(doc.lineCount - 1, step.lines[1] - 1);
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
        file: step.file,
        lines: step.lines,
        symbol: step.symbol,
        contentHash,
        subtitle: step.subtitle,
        explanation: step.explanation,
        duration: step.duration ?? 8,
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
      ...(related.length > 0 ? { related } : {}),
      steps,
    };

    const walkthroughDir = path.join(rootPath, ".walkthrough");
    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(walkthroughDir));
    } catch {
    }

    const slug = parsed.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const fileName = `${slug}.json`;
    const uri = saveOptions?.overwriteUri ?? vscode.Uri.file(path.join(walkthroughDir, fileName));

    const content = JSON.stringify(walkthrough, null, 2) + "\n";
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));

    vscode.window.showInformationMessage(
      `${saveOptions?.overwriteUri ? "AI walkthrough updated" : "AI walkthrough saved"}: ${vscode.workspace.asRelativePath(uri, false)} (${steps.length} steps)`
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

function buildPrompt(context: CodeContext, options?: PromptContextOptions): string {
  const fileList = context.files
    .map((file) => `- ${file.relativePath} (${file.lineCount} lines) [${file.symbols.slice(0, 8).join(", ")}]`)
    .join("\n");

  const filePreviews = context.files
    .map((file) => `=== ${file.relativePath} ===\n${file.preview}`)
    .join("\n\n");

  const sections = [
    "You are a senior developer creating an interactive code walkthrough for a codebase.",
    "",
    "TASK: Generate a step-by-step walkthrough JSON that explains how this code works. The walkthrough should guide a new developer through the codebase in a logical order, starting from entry points and following the execution flow.",
  ];

  if (options?.userGuidance?.trim()) {
    sections.push("", `USER GUIDANCE:\n${options.userGuidance.trim()}`);
  }

  const catalog = formatWalkthroughCatalog(options?.walkthroughCatalog ?? []);
  if (catalog) {
    sections.push("", `EXISTING WALKTHROUGHS:\n${catalog}`);
  }

  sections.push(
    "",
    "CODEBASE STRUCTURE:",
    `Root folder: ${context.rootFolder}`,
    `Total files: ${context.files.length}`,
    `Total lines: ${context.totalLines}`,
    "",
    "FILES AND SYMBOLS:",
    fileList,
    "",
    "FILE CONTENTS:",
    filePreviews,
    "",
    "OUTPUT FORMAT - Return ONLY valid JSON matching this exact structure:",
    "{",
    '  "title": "Short descriptive title",',
    '  "description": "One sentence describing what this walkthrough covers",',
    '  "related": [',
    "    {",
    '      "path": ".walkthrough/other-walkthrough.json",',
    '      "title": "Optional title",',
    '      "type": "related",',
    '      "note": "Optional reason this is worth opening next"',
    "    }",
    "  ],",
    '  "steps": [',
    "    {",
    '      "file": "relative/path/to/file.ts",',
    '      "lines": [startLine, endLine],',
    '      "symbol": "nearestFunctionOrClassName",',
    '      "subtitle": "Markdown-formatted text. 2-3 sentence explanation of what this code does and why it matters. Be specific about the actual code, not generic.",',
    '      "explanation": "Markdown-formatted text. Point-form List of explanations that deeply analyze interesting or non-obvious parts of the code. Include some code excerpts here to explain.",',
    '      "duration": 8',
    "    }",
    "  ]",
    "}",
    "",
    "REQUIREMENTS:",
    "- 5-20 steps depending on codebase size",
    "- Start from entry points (main, index, app) and follow the execution flow",
    "- Each step should highlight 3-20 lines (focused, not entire files)",
    "- Line numbers must be 1-indexed and accurate for the file contents shown",
    "- Subtitles should explain WHAT the code does and WHY, not just restate the code",
    "- Explanations should explain interesting or non-obvious parts of the code deeply rather than surface-level descriptions of trivial code (you may include some code excerpts to explain)",
    "- Use the actual symbol names from the code",
    "- Include \"related\" only when another walkthrough in the catalog is genuinely useful context",
    "- If you include \"related\", the \"path\" must exactly match a catalog entry",
    "- Order steps to tell a coherent story (setup → core logic → helpers → output)",
    "- Do NOT wrap the JSON in markdown code fences"
  );

  return sections.join("\n");
}

function buildTransformPrompt(
  context: CodeContext,
  options: TransformOptions,
  walkthroughCatalog: WalkthroughFile[]
): string {
  const fileList = context.files
    .map((file) => `- ${file.relativePath} (${file.lineCount} lines) [${file.symbols.slice(0, 8).join(", ")}]`)
    .join("\n");

  const filePreviews = context.files
    .map((file) => `=== ${file.relativePath} ===\n${file.preview}`)
    .join("\n\n");

  const sections = [
    `You are a senior developer ${transformModeLabel(options.mode).toLowerCase()} an interactive code walkthrough.`,
    "",
    `TASK: ${buildTransformObjective(options)}`,
    "",
    "TARGET WALKTHROUGH JSON:",
    JSON.stringify(options.target.walkthrough, null, 2),
  ];

  if (options.references.length > 0) {
    sections.push(
      "",
      "REFERENCE WALKTHROUGHS:",
      JSON.stringify(
        options.references.map((file) => ({
          path: file.relativePath,
          walkthrough: file.walkthrough,
        })),
        null,
        2
      )
    );
  }

  if (options.userGuidance?.trim()) {
    sections.push("", `USER GUIDANCE:\n${options.userGuidance.trim()}`);
  }

  const catalog = formatWalkthroughCatalog(
    walkthroughCatalog.filter((file) => file.uri !== options.target.uri)
  );
  if (catalog) {
    sections.push("", `EXISTING WALKTHROUGH CATALOG:\n${catalog}`);
  }

  sections.push(
    "",
    "CODEBASE STRUCTURE:",
    `Root folder: ${context.rootFolder}`,
    `Total files: ${context.files.length}`,
    `Total lines: ${context.totalLines}`,
    "",
    "FILES AND SYMBOLS:",
    fileList,
    "",
    "FILE CONTENTS:",
    filePreviews,
    "",
    "OUTPUT FORMAT - Return ONLY valid JSON matching this exact structure:",
    "{",
    '  "title": "Short descriptive title",',
    '  "description": "One sentence describing what this walkthrough covers",',
    '  "related": [',
    "    {",
    '      "path": ".walkthrough/other-walkthrough.json",',
    '      "title": "Optional title",',
    '      "type": "related",',
    '      "note": "Optional reason this is worth opening next"',
    "    }",
    "  ],",
    '  "steps": [',
    "    {",
    '      "file": "relative/path/to/file.ts",',
    '      "lines": [startLine, endLine],',
    '      "symbol": "nearestFunctionOrClassName",',
    '      "subtitle": "Markdown-formatted text. 2-3 sentence explanation of what this code does and why it matters. Be specific about the actual code, not generic.",',
    '      "explanation": "Markdown-formatted text. Point-form List of explanations that deeply analyze interesting or non-obvious parts of the code. Include some code excerpts here to explain.",',
    '      "duration": 8',
    "    }",
    "  ]",
    "}",
    "",
    "REQUIREMENTS:",
    "- Keep the walkthrough grounded in the actual code shown",
    "- Preserve the current walkthrough's purpose unless the user guidance clearly changes it",
    "- For extend, add genuinely missing steps or deeper detail instead of rephrasing the same content",
    "- For refactor, improve structure, sequencing, and clarity",
    "- For modify, make the requested targeted changes without unnecessary churn",
    "- Subtitles should explain WHAT the code does and WHY, not just restate the code",
    "- Explanations should explain interesting or non-obvious parts of the code deeply rather than surface-level descriptions of trivial code (you may include some code excerpts to explain)",
    "- Include \"related\" only when another walkthrough in the catalog is genuinely useful context",
    "- If you include \"related\", the \"path\" must exactly match a catalog entry",
    "- Return JSON only with no markdown fences"
  );

  return sections.join("\n");
}

function buildTransformObjective(options: TransformOptions): string {
  const title = options.target.walkthrough.title;
  switch (options.mode) {
    case "extend":
      return `Extend the existing walkthrough "${title}" with stronger coverage, better drill-down, and any missing steps that matter.`;
    case "refactor":
      return `Refactor the existing walkthrough "${title}" so the narrative is clearer, better ordered, and easier for a new developer to follow.`;
    default:
      return `Modify the existing walkthrough "${title}" based on the requested focus and keep the changes targeted.`;
  }
}

function transformModeLabel(mode: TransformMode): string {
  switch (mode) {
    case "extend":
      return "Extending";
    case "refactor":
      return "Refactoring";
    default:
      return "Modifying";
  }
}

function normalizeRelations(
  related: Array<{ path?: string; title?: string; type?: string; note?: string }> | undefined
): WalkthroughRelation[] {
  if (!related) {
    return [];
  }

  return related.flatMap((relation) => {
    if (!relation.path) {
      return [];
    }

    const normalized: WalkthroughRelation = {
      path: relation.path.replace(/\\/g, "/").replace(/^\.\//, ""),
    };

    if (relation.title) {
      normalized.title = relation.title;
    }
    if (relation.type && RELATION_TYPES.has(relation.type)) {
      normalized.type = relation.type as WalkthroughRelation["type"];
    }
    if (relation.note) {
      normalized.note = relation.note;
    }

    return [normalized];
  });
}

function formatWalkthroughCatalog(files: WalkthroughFile[]): string {
  if (files.length === 0) {
    return "";
  }

  return files
    .map((file) => {
      const relatedSummary = file.walkthrough.related?.length
        ? `; related: ${file.walkthrough.related.map((relation) => relation.path).join(", ")}`
        : "";
      return `- path: ${file.relativePath}; title: ${file.walkthrough.title}; description: ${file.walkthrough.description}; steps: ${file.walkthrough.steps.length}${relatedSummary}`;
    })
    .join("\n");
}
