import * as vscode from "vscode";
import { discoverWalkthroughs } from "./walkthrough/loader";
import { checkStaleness, StaleCheckResult } from "./walkthrough/staleness";
import { PlaybackEngine, SpeedMultiplier, SPEED_OPTIONS } from "./player/engine";
import { navigateToStep, clearAllHighlights } from "./player/highlight";
import { WalkthroughPanel } from "./ui/panel";
import { WalkthroughTreeProvider } from "./ui/tree";
import { Recorder } from "./recorder/recorder";
import { StatusBarController } from "./ui/statusbar";
import { WalkthroughFile } from "./walkthrough/types";
import { repairWalkthrough, saveRepairedWalkthrough } from "./git/repair";
import { generateWalkthrough } from "./ai/generate";
import { exportToMarkdown } from "./export/markdown";
import { exportToHtml } from "./export/html";

let engine: PlaybackEngine;
let panel: WalkthroughPanel;
let treeProvider: WalkthroughTreeProvider;
let recorder: Recorder;
let statusBar: StatusBarController;
let currentStaleResults: StaleCheckResult[] | undefined;
let currentWalkthroughFile: WalkthroughFile | undefined;

export function activate(context: vscode.ExtensionContext): void {
  engine = new PlaybackEngine();
  panel = new WalkthroughPanel(context.extensionUri);
  treeProvider = new WalkthroughTreeProvider();
  recorder = new Recorder();
  statusBar = new StatusBarController();

  const treeView = vscode.window.createTreeView("codeWalkthrough.explorer", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  const walkthroughWatcher = vscode.workspace.createFileSystemWatcher(
    "**/.walkthrough/*.json"
  );
  walkthroughWatcher.onDidChange(() => treeProvider.refresh());
  walkthroughWatcher.onDidCreate(() => treeProvider.refresh());
  walkthroughWatcher.onDidDelete(() => treeProvider.refresh());

  engine.onChange((status) => {
    panel.update(status, currentStaleResults);

    const isActive = status.state !== "idle";
    vscode.commands.executeCommand("setContext", "codeWalkthrough.active", isActive);

    if (status.currentStep && isActive) {
      const staleResult = currentStaleResults?.find(
        (r) => r.stepIndex === status.currentIndex
      );
      if (staleResult?.status === "git-resolved" && staleResult.resolvedLines) {
        navigateToStep({
          ...status.currentStep,
          lines: staleResult.resolvedLines,
        });
      } else if (staleResult?.status === "drifted" && staleResult.resolvedLines) {
        navigateToStep({
          ...status.currentStep,
          lines: staleResult.resolvedLines,
        });
      } else {
        navigateToStep(status.currentStep);
      }
    }

    if (isActive) {
      statusBar.showPlayback(
        status.state as "playing" | "paused",
        status.currentIndex,
        status.totalSteps,
        status.speed
      );
    }

    if (status.state === "idle") {
      clearAllHighlights();
      statusBar.hideAll();
    }
  });

  recorder.onChange(() => {
    if (recorder.isRecording) {
      panel.updateRecording(recorder.stepCount);
      statusBar.showRecording(recorder.stepCount);
    }
  });

  panel.onCommand((command) => {
    if (command === "next") {
      engine.next();
    } else if (command === "prev") {
      engine.prev();
    } else if (command === "togglePlayback") {
      engine.togglePlayback();
    } else if (command === "stop") {
      stopWalkthrough();
    } else if (command.startsWith("goTo:")) {
      const index = parseInt(command.split(":")[1], 10);
      if (!isNaN(index)) {
        engine.goTo(index);
      }
    } else if (command.startsWith("setSpeed:")) {
      const speed = parseFloat(command.split(":")[1]);
      if (SPEED_OPTIONS.includes(speed as SpeedMultiplier)) {
        engine.setSpeed(speed as SpeedMultiplier);
      }
    } else if (command === "recordStep") {
      recorder.captureStep();
    } else if (command === "recordUndo") {
      recorder.removeLastStep();
    } else if (command === "recordStop") {
      finishRecording();
    } else if (command === "recordCancel") {
      recorder.cancel();
      panel.hide();
      statusBar.hideAll();
      vscode.commands.executeCommand("setContext", "codeWalkthrough.recording", false);
    } else if (command === "repair") {
      repairCurrentWalkthrough();
    }
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("codeWalkthrough.open", openWalkthrough),
    vscode.commands.registerCommand("codeWalkthrough.nextStep", () => engine.next()),
    vscode.commands.registerCommand("codeWalkthrough.prevStep", () => engine.prev()),
    vscode.commands.registerCommand("codeWalkthrough.togglePlayback", () => engine.togglePlayback()),
    vscode.commands.registerCommand("codeWalkthrough.stop", stopWalkthrough),
    vscode.commands.registerCommand("codeWalkthrough.recordStart", startRecording),
    vscode.commands.registerCommand("codeWalkthrough.recordStep", () => recorder.captureStep()),
    vscode.commands.registerCommand("codeWalkthrough.recordUndo", () => recorder.removeLastStep()),
    vscode.commands.registerCommand("codeWalkthrough.recordStop", finishRecording),
    vscode.commands.registerCommand("codeWalkthrough.recordCancel", () => {
      recorder.cancel();
      panel.hide();
      statusBar.hideAll();
      vscode.commands.executeCommand("setContext", "codeWalkthrough.recording", false);
    }),
    vscode.commands.registerCommand("codeWalkthrough.cycleSpeed", () => engine.cycleSpeed()),
    vscode.commands.registerCommand("codeWalkthrough.repair", repairCurrentWalkthrough),
    vscode.commands.registerCommand("codeWalkthrough.refreshTree", () => treeProvider.refresh()),
    vscode.commands.registerCommand("codeWalkthrough.playFile", (file: WalkthroughFile) => beginPlayback(file)),
    vscode.commands.registerCommand("codeWalkthrough.playFileAtStep", (file: WalkthroughFile, stepIndex: number) => {
      beginPlayback(file).then(() => engine.goTo(stepIndex));
    }),
    vscode.commands.registerCommand("codeWalkthrough.generate", generateFromPicker),
    vscode.commands.registerCommand("codeWalkthrough.generateFromFolder", (uri: vscode.Uri) => {
      runGeneration(uri);
    }),
    vscode.commands.registerCommand("codeWalkthrough.setupAI", setupAIProvider),
    vscode.commands.registerCommand("codeWalkthrough.export", exportWalkthrough),
    vscode.commands.registerCommand("codeWalkthrough.exportFile", (file: WalkthroughFile) => {
      exportWalkthroughFile(file);
    })
  );

  context.subscriptions.push(
    treeView,
    walkthroughWatcher,
    { dispose: () => engine.dispose() },
    { dispose: () => panel.hide() },
    { dispose: () => treeProvider.dispose() },
    { dispose: () => recorder.dispose() },
    { dispose: () => statusBar.dispose() }
  );
}

async function openWalkthrough(): Promise<void> {
  const files = await discoverWalkthroughs();

  if (files.length === 0) {
    vscode.window.showInformationMessage(
      "No walkthroughs found. Create a .walkthrough/*.json file or use 'Walkthrough: Start Recording'."
    );
    return;
  }

  if (files.length === 1) {
    await beginPlayback(files[0]);
    return;
  }

  const pick = await vscode.window.showQuickPick(
    files.map((f) => ({
      label: f.walkthrough.title,
      description: f.walkthrough.description,
      detail: `${f.walkthrough.steps.length} steps${f.walkthrough.commitSha ? ` · ${f.walkthrough.commitSha.slice(0, 7)}` : ""}`,
      file: f,
    })),
    { placeHolder: "Select a walkthrough" }
  );

  if (pick) {
    await beginPlayback(pick.file);
  }
}

async function beginPlayback(file: WalkthroughFile): Promise<void> {
  const walkthrough = file.walkthrough;
  currentWalkthroughFile = file;
  currentStaleResults = await checkStaleness(
    walkthrough.steps,
    walkthrough.commitSha
  );

  const needsRepair = currentStaleResults.filter(
    (r) => r.status !== "fresh" && r.status !== "git-resolved"
  ).length;
  const gitResolved = currentStaleResults.filter(
    (r) => r.status === "git-resolved"
  ).length;

  if (needsRepair > 0) {
    const hasGitSha = !!walkthrough.commitSha;
    const repairOption = hasGitSha ? "Auto-Repair" : undefined;
    const choice = await vscode.window.showWarningMessage(
      `${needsRepair} step(s) may be outdated.${gitResolved > 0 ? ` ${gitResolved} auto-resolved via git.` : ""}`,
      "Continue Anyway",
      ...(repairOption ? [repairOption] : []),
      "Cancel"
    );
    if (choice === "Cancel" || !choice) {
      return;
    }
    if (choice === "Auto-Repair") {
      await repairCurrentWalkthroughAndReload(file);
      return;
    }
  } else if (gitResolved > 0) {
    vscode.window.showInformationMessage(
      `${gitResolved} step(s) auto-resolved via git diff. Consider running 'Walkthrough: Repair' to update the file.`
    );
  }

  panel.show();
  engine.load(walkthrough);
}

async function startRecording(): Promise<void> {
  const started = await recorder.start();
  if (started) {
    vscode.commands.executeCommand("setContext", "codeWalkthrough.recording", true);
    panel.show();
    panel.updateRecording(0);
    statusBar.showRecording(0);
  }
}

async function finishRecording(): Promise<void> {
  const uri = await recorder.stop();
  vscode.commands.executeCommand("setContext", "codeWalkthrough.recording", false);
  statusBar.hideAll();

  if (uri) {
    const open = await vscode.window.showInformationMessage(
      "Walkthrough saved! Open it now?",
      "Play",
      "View JSON"
    );

    if (open === "Play") {
      await openWalkthrough();
    } else if (open === "View JSON") {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
    } else {
      panel.hide();
    }
  } else {
    panel.hide();
  }
}

async function generateFromPicker(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showWarningMessage("No workspace open.");
    return;
  }

  const folders = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    defaultUri: workspaceFolders[0].uri,
    openLabel: "Select folder to generate walkthrough for",
  });

  if (folders && folders.length > 0) {
    await runGeneration(folders[0]);
  }
}

async function runGeneration(folderUri: vscode.Uri): Promise<void> {
  const uri = await generateWalkthrough(folderUri);
  if (uri) {
    treeProvider.refresh();
    const action = await vscode.window.showInformationMessage(
      "Walkthrough generated!",
      "Play",
      "View JSON"
    );
    if (action === "Play") {
      await openWalkthrough();
    } else if (action === "View JSON") {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
    }
  }
}

async function setupAIProvider(): Promise<void> {
  const provider = await vscode.window.showQuickPick(
    [
      { label: "OpenAI", description: "api.openai.com", endpoint: "https://api.openai.com/v1", model: "gpt-4o" },
      { label: "Anthropic (OpenAI-compatible)", description: "api.anthropic.com", endpoint: "https://api.anthropic.com/v1", model: "claude-sonnet-4-20250514" },
      { label: "Ollama (local)", description: "localhost:11434", endpoint: "http://localhost:11434/v1", model: "llama3" },
      { label: "Groq", description: "api.groq.com", endpoint: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
      { label: "Together AI", description: "api.together.xyz", endpoint: "https://api.together.xyz/v1", model: "meta-llama/Llama-3-70b-chat-hf" },
      { label: "Custom endpoint", description: "Enter your own", endpoint: "", model: "" },
    ],
    { placeHolder: "Select your AI provider" }
  );

  if (!provider) {
    return;
  }

  const config = vscode.workspace.getConfiguration("codeWalkthrough.ai");

  let endpoint = provider.endpoint;
  let model = provider.model;

  if (!endpoint) {
    const customEndpoint = await vscode.window.showInputBox({
      prompt: "API endpoint URL",
      placeHolder: "https://api.example.com/v1",
    });
    if (!customEndpoint) {
      return;
    }
    endpoint = customEndpoint;

    const customModel = await vscode.window.showInputBox({
      prompt: "Model name",
      placeHolder: "gpt-4o",
    });
    model = customModel ?? "gpt-4o";
  }

  await config.update("apiEndpoint", endpoint, vscode.ConfigurationTarget.Global);
  await config.update("model", model, vscode.ConfigurationTarget.Global);

  const isLocal = endpoint.includes("localhost") || endpoint.includes("127.0.0.1");
  if (!isLocal) {
    const apiKey = await vscode.window.showInputBox({
      prompt: `API key for ${provider.label}`,
      placeHolder: "sk-...",
      password: true,
    });
    if (apiKey) {
      await config.update("apiKey", apiKey, vscode.ConfigurationTarget.Global);
    }
  }

  vscode.window.showInformationMessage(
    `AI configured: ${provider.label} (${model}). Try 'Walkthrough: Generate Walkthrough with AI' now.`
  );
}

async function repairCurrentWalkthrough(): Promise<void> {
  if (!currentWalkthroughFile) {
    vscode.window.showWarningMessage("No walkthrough loaded to repair.");
    return;
  }

  await repairCurrentWalkthroughAndReload(currentWalkthroughFile);
}

async function repairCurrentWalkthroughAndReload(
  file: WalkthroughFile
): Promise<void> {
  const result = await repairWalkthrough(file);

  if (!result.repaired && result.stepsUnresolvable > 0) {
    vscode.window.showWarningMessage(
      `Repair incomplete: ${result.stepsUnresolvable} step(s) could not be resolved.`
    );
  }

  if (result.stepsFixed > 0 || result.repaired) {
    await saveRepairedWalkthrough(file.uri, result.walkthrough);
    vscode.window.showInformationMessage(
      `Walkthrough repaired: ${result.stepsFixed} step(s) updated, commit SHA rebased to HEAD.`
    );

    file.walkthrough = result.walkthrough;
    currentWalkthroughFile = file;
    currentStaleResults = await checkStaleness(
      result.walkthrough.steps,
      result.walkthrough.commitSha
    );

    panel.show();
    engine.load(result.walkthrough);
  }
}

async function exportWalkthrough(): Promise<void> {
  const files = await discoverWalkthroughs();

  if (files.length === 0) {
    vscode.window.showInformationMessage("No walkthroughs found to export.");
    return;
  }

  let file: WalkthroughFile;

  if (files.length === 1) {
    file = files[0];
  } else {
    const pick = await vscode.window.showQuickPick(
      files.map((f) => ({
        label: f.walkthrough.title,
        description: `${f.walkthrough.steps.length} steps`,
        file: f,
      })),
      { placeHolder: "Select a walkthrough to export" }
    );
    if (!pick) {
      return;
    }
    file = pick.file;
  }

  await exportWalkthroughFile(file);
}

async function exportWalkthroughFile(file: WalkthroughFile): Promise<void> {
  const format = await vscode.window.showQuickPick(
    [
      { label: "Markdown", description: ".md — works on GitHub, GitLab, etc.", ext: "md" },
      { label: "HTML", description: ".html — standalone page with dark theme and navigation", ext: "html" },
    ],
    { placeHolder: "Export format" }
  );

  if (!format) {
    return;
  }

  const defaultName = file.walkthrough.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  const saveUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(`${defaultName}.${format.ext}`),
    filters:
      format.ext === "md"
        ? { Markdown: ["md"] }
        : { HTML: ["html"] },
  });

  if (!saveUri) {
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Exporting to ${format.label}...` },
    async () => {
      const content =
        format.ext === "md"
          ? await exportToMarkdown(file.walkthrough)
          : await exportToHtml(file.walkthrough);

      await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, "utf-8"));
    }
  );

  const action = await vscode.window.showInformationMessage(
    `Walkthrough exported to ${format.label}.`,
    "Open File"
  );

  if (action === "Open File") {
    if (format.ext === "md") {
      const doc = await vscode.workspace.openTextDocument(saveUri);
      await vscode.window.showTextDocument(doc);
    } else {
      await vscode.env.openExternal(saveUri);
    }
  }
}

function stopWalkthrough(): void {
  engine.stop();
  currentStaleResults = undefined;
  currentWalkthroughFile = undefined;
  clearAllHighlights();
  panel.hide();
  statusBar.hideAll();
  vscode.commands.executeCommand("setContext", "codeWalkthrough.active", false);
}

export function deactivate(): void {
  clearAllHighlights();
}
