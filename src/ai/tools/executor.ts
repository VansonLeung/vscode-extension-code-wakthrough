import * as vscode from "vscode";
import * as path from "path";
import { TOOL_NAMES } from "./definitions";

const MAX_FILE_LINES = 500;
const MAX_SEARCH_RESULTS = 30;
const MAX_LIST_ENTRIES = 100;

function getWorkspaceRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    throw new Error("No workspace open");
  }
  return folders[0].uri.fsPath;
}

function resolveSafePath(relativePath: string): string {
  const root = getWorkspaceRoot();
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(root)) {
    throw new Error(`Access denied: path "${relativePath}" is outside workspace`);
  }
  return resolved;
}

async function listFiles(args: { path: string }): Promise<string> {
  const dirPath = resolveSafePath(args.path);
  const uri = vscode.Uri.file(dirPath);

  try {
    const entries = await vscode.workspace.fs.readDirectory(uri);
    const sorted = entries
      .sort((a, b) => {
        if (a[1] !== b[1]) {
          return a[1] === vscode.FileType.Directory ? -1 : 1;
        }
        return a[0].localeCompare(b[0]);
      })
      .slice(0, MAX_LIST_ENTRIES);

    const lines: string[] = [];
    for (const [name, type] of sorted) {
      if (name.startsWith(".") && name !== ".env.example") {
        continue;
      }
      if (name === "node_modules" || name === ".git") {
        continue;
      }
      const suffix = type === vscode.FileType.Directory ? "/" : "";
      lines.push(`${name}${suffix}`);
    }

    return lines.length > 0
      ? lines.join("\n")
      : "(empty directory)";
  } catch {
    return `Error: Could not read directory "${args.path}"`;
  }
}

async function readFile(args: {
  path: string;
  start_line?: string;
  end_line?: string;
}): Promise<string> {
  const filePath = resolveSafePath(args.path);
  const uri = vscode.Uri.file(filePath);

  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const totalLines = doc.lineCount;

    let startLine = args.start_line ? parseInt(args.start_line, 10) : 1;
    let endLine = args.end_line ? parseInt(args.end_line, 10) : totalLines;

    startLine = Math.max(1, startLine);
    endLine = Math.min(totalLines, endLine);

    if (endLine - startLine + 1 > MAX_FILE_LINES && !args.start_line) {
      endLine = startLine + MAX_FILE_LINES - 1;
      const lines: string[] = [];
      for (let i = startLine - 1; i < endLine; i++) {
        lines.push(`${i + 1}\t${doc.lineAt(i).text}`);
      }
      lines.push(
        `\n... (truncated at ${MAX_FILE_LINES} lines, total ${totalLines} lines. Use start_line/end_line to read more.)`
      );
      return lines.join("\n");
    }

    const lines: string[] = [];
    for (let i = startLine - 1; i < endLine; i++) {
      lines.push(`${i + 1}\t${doc.lineAt(i).text}`);
    }
    return lines.join("\n");
  } catch {
    return `Error: Could not read file "${args.path}"`;
  }
}

async function searchFiles(args: {
  pattern: string;
  include?: string;
}): Promise<string> {
  const root = getWorkspaceRoot();
  const includePattern = args.include ?? "**/*";
  const ignorePattern = "{**/node_modules/**,**/dist/**,**/.git/**,**/.walkthrough/**,**/*.lock}";

  const uris = await vscode.workspace.findFiles(includePattern, ignorePattern, 200);

  const results: string[] = [];
  const lowerPattern = args.pattern.toLowerCase();

  for (const uri of uris) {
    if (results.length >= MAX_SEARCH_RESULTS) {
      break;
    }

    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const relPath = path.relative(root, uri.fsPath);
      const matchingLines: string[] = [];

      for (let i = 0; i < doc.lineCount && matchingLines.length < 5; i++) {
        const lineText = doc.lineAt(i).text;
        if (lineText.toLowerCase().includes(lowerPattern)) {
          matchingLines.push(`  L${i + 1}: ${lineText.trim()}`);
        }
      }

      if (matchingLines.length > 0) {
        results.push(`${relPath}\n${matchingLines.join("\n")}`);
      }
    } catch {
      continue;
    }
  }

  return results.length > 0
    ? results.join("\n\n")
    : `No matches found for "${args.pattern}"`;
}

async function getSymbols(args: { path: string }): Promise<string> {
  const filePath = resolveSafePath(args.path);
  const uri = vscode.Uri.file(filePath);

  try {
    await vscode.workspace.openTextDocument(uri);
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      uri
    );

    if (!symbols || symbols.length === 0) {
      return `No symbols found in "${args.path}" (language server may not be active)`;
    }

    const lines: string[] = [];
    flattenSymbols(symbols, lines, 0);
    return lines.join("\n");
  } catch {
    return `Error: Could not get symbols for "${args.path}"`;
  }
}

function flattenSymbols(
  symbols: vscode.DocumentSymbol[],
  output: string[],
  depth: number
): void {
  const kindName: Record<number, string> = {
    [vscode.SymbolKind.File]: "file",
    [vscode.SymbolKind.Module]: "module",
    [vscode.SymbolKind.Namespace]: "namespace",
    [vscode.SymbolKind.Class]: "class",
    [vscode.SymbolKind.Method]: "method",
    [vscode.SymbolKind.Property]: "property",
    [vscode.SymbolKind.Function]: "function",
    [vscode.SymbolKind.Variable]: "variable",
    [vscode.SymbolKind.Constant]: "constant",
    [vscode.SymbolKind.Interface]: "interface",
    [vscode.SymbolKind.Enum]: "enum",
    [vscode.SymbolKind.Constructor]: "constructor",
    [vscode.SymbolKind.TypeParameter]: "type",
  };

  for (const sym of symbols) {
    const indent = "  ".repeat(depth);
    const kind = kindName[sym.kind] ?? "symbol";
    const range = `L${sym.range.start.line + 1}-${sym.range.end.line + 1}`;
    output.push(`${indent}${kind} ${sym.name} (${range})`);

    if (sym.children.length > 0) {
      flattenSymbols(sym.children, output, depth + 1);
    }
  }
}

export async function executeTool(
  name: string,
  argsJson: string,
  logger?: vscode.OutputChannel
): Promise<string> {
  if (!TOOL_NAMES.includes(name)) {
    return `Error: Unknown tool "${name}"`;
  }

  let args: Record<string, string>;
  try {
    args = JSON.parse(argsJson) as Record<string, string>;
  } catch {
    return `Error: Invalid JSON arguments for tool "${name}"`;
  }

  if (logger) {
    logger.appendLine(`  [Tool] ${name}(${JSON.stringify(args)})`);
  }

  let result: string;
  switch (name) {
    case "list_files":
      result = await listFiles(args as { path: string });
      break;
    case "read_file":
      result = await readFile(args as { path: string; start_line?: string; end_line?: string });
      break;
    case "search":
      result = await searchFiles(args as { pattern: string; include?: string });
      break;
    case "get_symbols":
      result = await getSymbols(args as { path: string });
      break;
    default:
      result = `Error: Unknown tool "${name}"`;
  }

  if (logger) {
    const preview = result.length > 300
      ? result.slice(0, 300) + `... (${result.length} chars total)`
      : result;
    logger.appendLine(`  [Result] ${preview}`);
  }

  return result;
}
