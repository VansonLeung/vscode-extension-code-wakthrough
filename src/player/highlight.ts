import * as vscode from "vscode";
import * as path from "path";
import { WalkthroughStep } from "../walkthrough/types";

const HIGHLIGHT_DECORATION = vscode.window.createTextEditorDecorationType({
  backgroundColor: "rgba(255, 213, 79, 0.2)",
  isWholeLine: true,
  overviewRulerColor: "rgba(255, 213, 79, 0.8)",
  overviewRulerLane: vscode.OverviewRulerLane.Center,
  border: "1px solid rgba(255, 213, 79, 0.4)",
});

export async function navigateToStep(
  step: WalkthroughStep
): Promise<vscode.TextEditor | null> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return null;
  }

  const rootPath = workspaceFolders[0].uri.fsPath;
  const filePath = path.resolve(rootPath, step.file);
  const uri = vscode.Uri.file(filePath);

  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const startLine = Math.max(0, step.lines[0] - 1);
    const endLine = Math.max(startLine, step.lines[1] - 1);

    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: false,
    });

    const range = new vscode.Range(
      new vscode.Position(startLine, 0),
      new vscode.Position(endLine, doc.lineAt(endLine).text.length)
    );

    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

    editor.setDecorations(HIGHLIGHT_DECORATION, [{ range }]);

    return editor;
  } catch {
    vscode.window.showWarningMessage(
      `Could not open file: ${step.file}`
    );
    return null;
  }
}

export function clearHighlights(editor: vscode.TextEditor): void {
  editor.setDecorations(HIGHLIGHT_DECORATION, []);
}

export function clearAllHighlights(): void {
  for (const editor of vscode.window.visibleTextEditors) {
    editor.setDecorations(HIGHLIGHT_DECORATION, []);
  }
}
