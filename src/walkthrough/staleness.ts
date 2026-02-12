import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";
import { WalkthroughStep } from "./types";
import {
  getHeadSha,
  computeLineMappings,
  remapLineRange,
} from "../git/git";

export interface StaleCheckResult {
  stepIndex: number;
  status: "fresh" | "drifted" | "missing" | "git-resolved";
  resolvedLines?: [number, number];
  detail?: string;
}

export async function checkStaleness(
  steps: WalkthroughStep[],
  commitSha?: string
): Promise<StaleCheckResult[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return steps.map((_, i) => ({
      stepIndex: i,
      status: "missing" as const,
      detail: "No workspace open",
    }));
  }

  const rootPath = workspaceFolders[0].uri.fsPath;
  const results: StaleCheckResult[] = [];

  const headSha = await getHeadSha();
  const canUseGit = !!commitSha && !!headSha && commitSha !== headSha;
  const mappingsCache = new Map<string, Awaited<ReturnType<typeof computeLineMappings>>>();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const filePath = path.resolve(rootPath, step.file);
    const uri = vscode.Uri.file(filePath);

    try {
      const doc = await vscode.workspace.openTextDocument(uri);

      if (!step.contentHash) {
        results.push({ stepIndex: i, status: "fresh" });
        continue;
      }

      const hashMatch = checkContentHash(doc, step);
      if (hashMatch) {
        results.push({ stepIndex: i, status: "fresh" });
        continue;
      }

      if (canUseGit) {
        let mappings = mappingsCache.get(step.file);
        if (mappings === undefined) {
          mappings = await computeLineMappings(commitSha, headSha, step.file);
          mappingsCache.set(step.file, mappings);
        }

        if (mappings.length > 0) {
          const [newStart, newEnd] = remapLineRange(
            step.lines[0],
            step.lines[1],
            mappings
          );

          const clampedStart = Math.max(1, newStart);
          const clampedEnd = Math.min(doc.lineCount, Math.max(clampedStart, newEnd));

          const remappedContent = doc.getText(
            new vscode.Range(
              clampedStart - 1,
              0,
              clampedEnd - 1,
              doc.lineAt(clampedEnd - 1).text.length
            )
          );
          const remappedHash = crypto
            .createHash("sha256")
            .update(remappedContent)
            .digest("hex")
            .slice(0, 12);

          if (remappedHash === step.contentHash) {
            results.push({
              stepIndex: i,
              status: "git-resolved",
              resolvedLines: [clampedStart, clampedEnd],
              detail: `Git resolved: lines shifted to ${clampedStart}-${clampedEnd}`,
            });
            continue;
          }

          results.push({
            stepIndex: i,
            status: "drifted",
            resolvedLines: [clampedStart, clampedEnd],
            detail: `Git remapped to ${clampedStart}-${clampedEnd}, but content also changed`,
          });
          continue;
        }
      }

      const symbolMatch = await findBySymbol(doc, step);
      if (symbolMatch) {
        results.push({
          stepIndex: i,
          status: "drifted",
          resolvedLines: symbolMatch,
          detail: `Lines shifted. Symbol "${step.symbol}" found at ${symbolMatch[0]}-${symbolMatch[1]}`,
        });
        continue;
      }

      results.push({
        stepIndex: i,
        status: "drifted",
        detail: "Content hash mismatch. Code may have changed since walkthrough was created.",
      });
    } catch {
      results.push({
        stepIndex: i,
        status: "missing",
        detail: `File not found: ${step.file}`,
      });
    }
  }

  return results;
}

function checkContentHash(
  doc: vscode.TextDocument,
  step: WalkthroughStep
): boolean {
  const startLine = Math.max(0, step.lines[0] - 1);
  const endLine = Math.min(doc.lineCount - 1, step.lines[1] - 1);

  const range = new vscode.Range(
    startLine,
    0,
    endLine,
    doc.lineAt(endLine).text.length
  );
  const content = doc.getText(range);
  const hash = crypto
    .createHash("sha256")
    .update(content)
    .digest("hex")
    .slice(0, 12);

  return hash === step.contentHash;
}

async function findBySymbol(
  doc: vscode.TextDocument,
  step: WalkthroughStep
): Promise<[number, number] | null> {
  if (!step.symbol) {
    return null;
  }

  try {
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      doc.uri
    );

    if (!symbols) {
      return null;
    }

    const match = findSymbolByName(symbols, step.symbol);
    if (match) {
      const lineSpan = step.lines[1] - step.lines[0];
      return [match.range.start.line + 1, match.range.start.line + 1 + lineSpan];
    }
  } catch {
  }

  return null;
}

function findSymbolByName(
  symbols: vscode.DocumentSymbol[],
  name: string
): vscode.DocumentSymbol | null {
  for (const sym of symbols) {
    if (sym.name === name) {
      return sym;
    }
    const child = findSymbolByName(sym.children, name);
    if (child) {
      return child;
    }
  }
  return null;
}
