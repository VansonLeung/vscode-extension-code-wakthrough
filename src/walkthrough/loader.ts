import * as vscode from "vscode";
import * as path from "path";
import { Walkthrough, WalkthroughFile, WalkthroughStep } from "./types";

function isValidStep(step: unknown): step is WalkthroughStep {
  if (typeof step !== "object" || step === null) {
    return false;
  }
  const s = step as Record<string, unknown>;
  return (
    typeof s.file === "string" &&
    Array.isArray(s.lines) &&
    s.lines.length === 2 &&
    typeof s.lines[0] === "number" &&
    typeof s.lines[1] === "number" &&
    typeof s.subtitle === "string"
  );
}

function isValidWalkthrough(data: unknown): data is Walkthrough {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const d = data as Record<string, unknown>;
  return (
    typeof d.title === "string" &&
    typeof d.description === "string" &&
    Array.isArray(d.steps) &&
    d.steps.length > 0 &&
    d.steps.every(isValidStep)
  );
}

export async function discoverWalkthroughs(): Promise<WalkthroughFile[]> {
  const files = await vscode.workspace.findFiles(
    ".walkthrough/*.json",
    "**/node_modules/**"
  );

  const results: WalkthroughFile[] = [];

  for (const file of files) {
    try {
      const raw = await vscode.workspace.fs.readFile(file);
      const text = Buffer.from(raw).toString("utf-8");
      const data: unknown = JSON.parse(text);

      if (!isValidWalkthrough(data)) {
        vscode.window.showWarningMessage(
          `Invalid walkthrough: ${path.basename(file.fsPath)}`
        );
        continue;
      }

      results.push({ uri: file.fsPath, walkthrough: data });
    } catch {
      vscode.window.showWarningMessage(
        `Failed to parse: ${path.basename(file.fsPath)}`
      );
    }
  }

  return results;
}

export async function loadWalkthrough(
  fsPath: string
): Promise<Walkthrough | null> {
  try {
    const uri = vscode.Uri.file(fsPath);
    const raw = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(raw).toString("utf-8");
    const data: unknown = JSON.parse(text);

    if (!isValidWalkthrough(data)) {
      vscode.window.showWarningMessage(
        `Invalid walkthrough: ${path.basename(fsPath)}`
      );
      return null;
    }

    return data;
  } catch {
    vscode.window.showWarningMessage(
      `Failed to load: ${path.basename(fsPath)}`
    );
    return null;
  }
}
