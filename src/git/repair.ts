import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";
import { Walkthrough, WalkthroughStep } from "../walkthrough/types";
import { WalkthroughFile } from "../walkthrough/types";
import {
  getHeadSha,
  computeLineMappings,
  remapLineRange,
  fileExistsAtCommit,
  getFileRenames,
} from "./git";

export interface RepairResult {
  repaired: boolean;
  stepsFixed: number;
  stepsUnresolvable: number;
  walkthrough: Walkthrough;
}

export async function repairWalkthrough(
  walkthroughFile: WalkthroughFile
): Promise<RepairResult> {
  const walkthrough = walkthroughFile.walkthrough;
  const oldSha = walkthrough.commitSha;
  const newSha = await getHeadSha();

  if (!oldSha || !newSha) {
    return {
      repaired: false,
      stepsFixed: 0,
      stepsUnresolvable: walkthrough.steps.length,
      walkthrough,
    };
  }

  if (oldSha === newSha) {
    return {
      repaired: true,
      stepsFixed: 0,
      stepsUnresolvable: 0,
      walkthrough,
    };
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return {
      repaired: false,
      stepsFixed: 0,
      stepsUnresolvable: walkthrough.steps.length,
      walkthrough,
    };
  }

  const rootPath = workspaceFolders[0].uri.fsPath;
  const repairedSteps: WalkthroughStep[] = [];
  let stepsFixed = 0;
  let stepsUnresolvable = 0;

  const mappingsCache = new Map<string, Awaited<ReturnType<typeof computeLineMappings>>>();

  for (const step of walkthrough.steps) {
    let currentFile = step.file;

    const existsOld = await fileExistsAtCommit(oldSha, currentFile);
    if (existsOld) {
      const renamed = await getFileRenames(oldSha, newSha, currentFile);
      if (renamed) {
        currentFile = renamed;
      }
    }

    const currentFilePath = path.resolve(rootPath, currentFile);
    const uri = vscode.Uri.file(currentFilePath);

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      repairedSteps.push(step);
      stepsUnresolvable++;
      continue;
    }

    const currentContent = doc.getText(
      new vscode.Range(
        Math.max(0, step.lines[0] - 1),
        0,
        Math.min(doc.lineCount - 1, step.lines[1] - 1),
        doc.lineAt(Math.min(doc.lineCount - 1, step.lines[1] - 1)).text.length
      )
    );
    const currentHash = crypto
      .createHash("sha256")
      .update(currentContent)
      .digest("hex")
      .slice(0, 12);

    if (currentHash === step.contentHash && currentFile === step.file) {
      repairedSteps.push(step);
      continue;
    }

    const cacheKey = `${currentFile}`;
    let mappings = mappingsCache.get(cacheKey);
    if (mappings === undefined) {
      mappings = await computeLineMappings(oldSha, newSha, step.file);
      mappingsCache.set(cacheKey, mappings);
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

      repairedSteps.push({
        ...step,
        file: currentFile,
        lines: [clampedStart, clampedEnd],
        contentHash: remappedHash,
      });
      stepsFixed++;
      continue;
    }

    repairedSteps.push({
      ...step,
      file: currentFile,
      contentHash: currentHash,
    });
    stepsUnresolvable++;
  }

  const repairedWalkthrough: Walkthrough = {
    ...walkthrough,
    commitSha: newSha,
    steps: repairedSteps,
  };

  return {
    repaired: stepsFixed > 0 || stepsUnresolvable === 0,
    stepsFixed,
    stepsUnresolvable,
    walkthrough: repairedWalkthrough,
  };
}

export async function saveRepairedWalkthrough(
  originalUri: string,
  walkthrough: Walkthrough
): Promise<void> {
  const uri = vscode.Uri.file(originalUri);
  const content = JSON.stringify(walkthrough, null, 2) + "\n";
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));
}
