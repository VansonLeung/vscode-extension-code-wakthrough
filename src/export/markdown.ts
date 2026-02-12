import * as vscode from "vscode";
import * as path from "path";
import { Walkthrough, WalkthroughStep } from "../walkthrough/types";

function inferLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "jsx",
    ".py": "python",
    ".rb": "ruby",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".cs": "csharp",
    ".cpp": "cpp",
    ".c": "c",
    ".h": "c",
    ".hpp": "cpp",
    ".css": "css",
    ".scss": "scss",
    ".html": "html",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".md": "markdown",
    ".sh": "bash",
    ".bash": "bash",
    ".sql": "sql",
    ".swift": "swift",
    ".dart": "dart",
    ".lua": "lua",
    ".php": "php",
    ".vue": "vue",
    ".svelte": "svelte",
  };
  return map[ext] ?? "";
}

async function readLines(
  rootPath: string,
  step: WalkthroughStep
): Promise<string | null> {
  const filePath = path.resolve(rootPath, step.file);
  const uri = vscode.Uri.file(filePath);
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const startLine = Math.max(0, step.lines[0] - 1);
    const endLine = Math.min(doc.lineCount - 1, step.lines[1] - 1);
    const lines: string[] = [];
    for (let i = startLine; i <= endLine; i++) {
      lines.push(doc.lineAt(i).text);
    }
    return lines.join("\n");
  } catch {
    return null;
  }
}

export async function exportToMarkdown(
  walkthrough: Walkthrough
): Promise<string> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const rootPath = workspaceFolders?.[0]?.uri.fsPath ?? "";

  const sections: string[] = [];

  sections.push(`# ${walkthrough.title}`);
  sections.push("");
  sections.push(walkthrough.description);
  sections.push("");
  if (walkthrough.commitSha) {
    sections.push(`> Commit: \`${walkthrough.commitSha.slice(0, 7)}\``);
    sections.push("");
  }
  sections.push("---");
  sections.push("");

  for (let i = 0; i < walkthrough.steps.length; i++) {
    const step = walkthrough.steps[i];
    const lang = inferLanguage(step.file);
    const lineLabel = step.lines[0] === step.lines[1]
      ? `L${step.lines[0]}`
      : `L${step.lines[0]}-${step.lines[1]}`;

    sections.push(`## Step ${i + 1}: \`${step.file}\` (${lineLabel})`);
    sections.push("");
    sections.push(step.subtitle);
    sections.push("");

    const code = await readLines(rootPath, step);
    if (code !== null) {
      sections.push(`\`\`\`${lang}`);
      sections.push(code);
      sections.push("```");
    } else {
      sections.push(`*Could not read \`${step.file}\`*`);
    }
    sections.push("");

    if (i < walkthrough.steps.length - 1) {
      sections.push("---");
      sections.push("");
    }
  }

  return sections.join("\n");
}
