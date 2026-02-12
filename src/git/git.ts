import * as vscode from "vscode";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

function getWorkspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return null;
  }
  return folders[0].uri.fsPath;
}

export async function getHeadSha(): Promise<string | null> {
  const root = getWorkspaceRoot();
  if (!root) {
    return null;
  }
  try {
    const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: root });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function isGitRepo(): Promise<boolean> {
  const root = getWorkspaceRoot();
  if (!root) {
    return false;
  }
  try {
    await exec("git", ["rev-parse", "--git-dir"], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

export interface LineMapping {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

// Parses @@ -oldStart,oldCount +newStart,newCount @@ hunk headers into line offset mappings
export async function computeLineMappings(
  fromSha: string,
  toSha: string,
  filePath: string
): Promise<LineMapping[]> {
  const root = getWorkspaceRoot();
  if (!root) {
    return [];
  }
  try {
    const { stdout } = await exec(
      "git",
      ["diff", "-U0", fromSha, toSha, "--", filePath],
      { cwd: root, maxBuffer: 10 * 1024 * 1024 }
    );
    return parseHunkHeaders(stdout);
  } catch {
    return [];
  }
}

function parseHunkHeaders(diffOutput: string): LineMapping[] {
  const mappings: LineMapping[] = [];
  const hunkRegex = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;
  let match: RegExpExecArray | null;

  while ((match = hunkRegex.exec(diffOutput)) !== null) {
    mappings.push({
      oldStart: parseInt(match[1], 10),
      oldCount: parseInt(match[2] ?? "1", 10),
      newStart: parseInt(match[3], 10),
      newCount: parseInt(match[4] ?? "1", 10),
    });
  }

  return mappings;
}

export function remapLineRange(
  oldStart: number,
  oldEnd: number,
  mappings: LineMapping[]
): [number, number] {
  let offset = 0;

  for (const hunk of mappings) {
    const hunkOldEnd = hunk.oldStart + hunk.oldCount;

    if (hunkOldEnd <= oldStart) {
      offset += hunk.newCount - hunk.oldCount;
    } else if (hunk.oldStart > oldEnd) {
      break;
    } else {
      offset += hunk.newCount - hunk.oldCount;
    }
  }

  return [oldStart + offset, oldEnd + offset];
}

export async function fileExistsAtCommit(
  sha: string,
  filePath: string
): Promise<boolean> {
  const root = getWorkspaceRoot();
  if (!root) {
    return false;
  }
  try {
    await exec("git", ["cat-file", "-e", `${sha}:${filePath}`], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

export async function getFileRenames(
  fromSha: string,
  toSha: string,
  filePath: string
): Promise<string | null> {
  const root = getWorkspaceRoot();
  if (!root) {
    return null;
  }
  try {
    const { stdout } = await exec(
      "git",
      ["diff", "--name-status", "-M", fromSha, toSha, "--", filePath],
      { cwd: root }
    );

    for (const line of stdout.split("\n")) {
      const renameMatch = line.match(/^R\d*\t(.+)\t(.+)$/);
      if (renameMatch) {
        if (renameMatch[1] === filePath) {
          return renameMatch[2];
        }
        if (renameMatch[2] === filePath) {
          return renameMatch[1];
        }
      }
    }
  } catch {
  }

  return null;
}
