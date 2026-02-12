import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";
import { Walkthrough, WalkthroughStep } from "../walkthrough/types";
import { getHeadSha } from "../git/git";

export interface RecordedStep {
  file: string;
  lines: [number, number];
  symbol: string;
  contentHash: string;
  subtitle: string;
}

export class Recorder {
  private recording = false;
  private steps: RecordedStep[] = [];
  private title = "";
  private description = "";

  private readonly onChangeEmitter = new vscode.EventEmitter<void>();
  readonly onChange = this.onChangeEmitter.event;

  get isRecording(): boolean {
    return this.recording;
  }

  get stepCount(): number {
    return this.steps.length;
  }

  get capturedSteps(): readonly RecordedStep[] {
    return this.steps;
  }

  async start(): Promise<boolean> {
    const title = await vscode.window.showInputBox({
      prompt: "Walkthrough title",
      placeHolder: "e.g. Auth Flow",
    });
    if (!title) {
      return false;
    }

    const description = await vscode.window.showInputBox({
      prompt: "Short description",
      placeHolder: "e.g. How authentication works end-to-end",
    });

    this.title = title;
    this.description = description ?? "";
    this.steps = [];
    this.recording = true;
    this.onChangeEmitter.fire();
    return true;
  }

  async captureStep(): Promise<boolean> {
    if (!this.recording) {
      return false;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("No active editor to capture.");
      return false;
    }

    const doc = editor.document;
    const selection = editor.selection;
    const startLine = selection.start.line + 1;
    const endLine = Math.max(startLine, selection.end.line + 1);

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return false;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const relativePath = path.relative(rootPath, doc.uri.fsPath);

    const lineContent = doc.getText(
      new vscode.Range(selection.start.line, 0, selection.end.line, doc.lineAt(selection.end.line).text.length)
    );
    const contentHash = crypto.createHash("sha256").update(lineContent).digest("hex").slice(0, 12);

    const symbol = await this.findNearestSymbol(doc, selection.start.line);

    const subtitle = await vscode.window.showInputBox({
      prompt: `Subtitle for step ${this.steps.length + 1} (${relativePath}:${startLine}-${endLine})`,
      placeHolder: "Explain what this code does...",
    });

    if (subtitle === undefined) {
      return false;
    }

    this.steps.push({
      file: relativePath,
      lines: [startLine, endLine],
      symbol,
      contentHash,
      subtitle: subtitle || "",
    });

    this.onChangeEmitter.fire();
    vscode.window.showInformationMessage(`Step ${this.steps.length} captured.`);
    return true;
  }

  async stop(): Promise<vscode.Uri | null> {
    if (!this.recording) {
      return null;
    }

    this.recording = false;
    this.onChangeEmitter.fire();

    if (this.steps.length === 0) {
      vscode.window.showWarningMessage("No steps captured. Walkthrough discarded.");
      return null;
    }

    return this.save();
  }

  cancel(): void {
    this.recording = false;
    this.steps = [];
    this.onChangeEmitter.fire();
  }

  removeLastStep(): void {
    if (this.steps.length > 0) {
      this.steps.pop();
      this.onChangeEmitter.fire();
    }
  }

  private async save(): Promise<vscode.Uri | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return null;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const walkthroughDir = path.join(rootPath, ".walkthrough");

    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(walkthroughDir));
    } catch {
    }

    const slug = this.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const fileName = `${slug}.json`;
    const filePath = path.join(walkthroughDir, fileName);
    const uri = vscode.Uri.file(filePath);

    const commitSha = await getHeadSha();

    const walkthrough: Walkthrough = {
      title: this.title,
      description: this.description,
      commitSha: commitSha ?? undefined,
      steps: this.steps.map((s): WalkthroughStep => ({
        file: s.file,
        lines: s.lines,
        symbol: s.symbol || undefined,
        contentHash: s.contentHash,
        subtitle: s.subtitle,
        duration: 8,
      })),
    };

    const content = JSON.stringify(walkthrough, null, 2) + "\n";
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf-8"));

    vscode.window.showInformationMessage(`Walkthrough saved: .walkthrough/${fileName}`);
    return uri;
  }

  private async findNearestSymbol(doc: vscode.TextDocument, line: number): Promise<string> {
    try {
      const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        "vscode.executeDocumentSymbolProvider",
        doc.uri
      );

      if (!symbols || symbols.length === 0) {
        return "";
      }

      return this.findClosestSymbol(symbols, line) ?? "";
    } catch {
      return "";
    }
  }

  private findClosestSymbol(symbols: vscode.DocumentSymbol[], line: number): string | null {
    let best: string | null = null;
    let bestDistance = Infinity;

    for (const sym of symbols) {
      if (sym.range.start.line <= line && sym.range.end.line >= line) {
        const distance = line - sym.range.start.line;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = sym.name;
        }

        const childResult = this.findClosestSymbol(sym.children, line);
        if (childResult) {
          return childResult;
        }
      }
    }

    return best;
  }

  dispose(): void {
    this.onChangeEmitter.dispose();
  }
}
