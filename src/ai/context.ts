import * as vscode from "vscode";
import * as path from "path";

export interface FileContext {
  relativePath: string;
  lineCount: number;
  symbols: string[];
  preview: string;
}

export interface CodeContext {
  rootFolder: string;
  files: FileContext[];
  totalLines: number;
}

const IGNORED_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.git/**",
  "**/package-lock.json",
  "**/*.lock",
  "**/.walkthrough/**",
];

const MAX_FILES = 30;
const MAX_PREVIEW_LINES = 80;

export async function collectCodeContext(
  folderUri: vscode.Uri
): Promise<CodeContext> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return { rootFolder: "", files: [], totalLines: 0 };
  }

  const rootPath = workspaceFolders[0].uri.fsPath;
  const relativeFolder = path.relative(rootPath, folderUri.fsPath) || ".";
  const searchPattern = relativeFolder === "."
    ? "**/*.{ts,tsx,js,jsx,py,go,rs,java,c,cpp,cs,rb,swift,kt}"
    : `${relativeFolder}/**/*.{ts,tsx,js,jsx,py,go,rs,java,c,cpp,cs,rb,swift,kt}`;

  const ignorePattern = `{${IGNORED_PATTERNS.join(",")}}`;
  const uris = await vscode.workspace.findFiles(searchPattern, ignorePattern, MAX_FILES * 2);

  const sorted = uris
    .map((u) => ({ uri: u, rel: path.relative(rootPath, u.fsPath) }))
    .sort((a, b) => a.rel.localeCompare(b.rel))
    .slice(0, MAX_FILES);

  const files: FileContext[] = [];
  let totalLines = 0;

  for (const { uri, rel } of sorted) {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const lineCount = doc.lineCount;
      totalLines += lineCount;

      const symbols = await getFileSymbols(uri);
      const previewLines = Math.min(lineCount, MAX_PREVIEW_LINES);
      const preview = doc.getText(
        new vscode.Range(0, 0, previewLines - 1, doc.lineAt(previewLines - 1).text.length)
      );

      files.push({
        relativePath: rel,
        lineCount,
        symbols,
        preview,
      });
    } catch {
    }
  }

  return { rootFolder: relativeFolder, files, totalLines };
}

async function getFileSymbols(uri: vscode.Uri): Promise<string[]> {
  try {
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      uri
    );
    if (!symbols) {
      return [];
    }
    return flattenSymbols(symbols).map((s) => `${symbolKindName(s.kind)} ${s.name}`);
  } catch {
    return [];
  }
}

function flattenSymbols(symbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] {
  const result: vscode.DocumentSymbol[] = [];
  for (const sym of symbols) {
    result.push(sym);
    if (sym.children.length > 0) {
      result.push(...flattenSymbols(sym.children));
    }
  }
  return result;
}

function symbolKindName(kind: vscode.SymbolKind): string {
  const names: Record<number, string> = {
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
  };
  return names[kind] ?? "symbol";
}
