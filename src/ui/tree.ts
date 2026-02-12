import * as vscode from "vscode";
import * as path from "path";
import { discoverWalkthroughs } from "../walkthrough/loader";
import { WalkthroughFile, WalkthroughStep } from "../walkthrough/types";

type TreeItem = WalkthroughTreeItem | StepTreeItem;

class WalkthroughTreeItem extends vscode.TreeItem {
  constructor(public readonly file: WalkthroughFile) {
    super(file.walkthrough.title, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${file.walkthrough.steps.length} steps`;
    this.tooltip = file.walkthrough.description;
    this.iconPath = new vscode.ThemeIcon("book");
    this.contextValue = "walkthrough";
    this.command = {
      command: "codeWalkthrough.playFile",
      title: "Play Walkthrough",
      arguments: [file],
    };
  }
}

class StepTreeItem extends vscode.TreeItem {
  constructor(
    public readonly step: WalkthroughStep,
    public readonly stepIndex: number,
    public readonly file: WalkthroughFile
  ) {
    super(
      `${stepIndex + 1}. ${path.basename(step.file)}:${step.lines[0]}`,
      vscode.TreeItemCollapsibleState.None
    );
    this.description = step.subtitle.length > 50
      ? step.subtitle.slice(0, 50) + "..."
      : step.subtitle;
    this.tooltip = step.subtitle;
    this.iconPath = new vscode.ThemeIcon("debug-stackframe");
    this.contextValue = "step";
    this.command = {
      command: "codeWalkthrough.playFileAtStep",
      title: "Play From Step",
      arguments: [file, stepIndex],
    };
  }
}

export class WalkthroughTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeEmitter.event;

  private walkthroughFiles: WalkthroughFile[] = [];

  async refresh(): Promise<void> {
    this.walkthroughFiles = await discoverWalkthroughs();
    this.onDidChangeEmitter.fire(undefined);
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    if (!element) {
      if (this.walkthroughFiles.length === 0) {
        await this.refresh();
      }
      return this.walkthroughFiles.map((f) => new WalkthroughTreeItem(f));
    }

    if (element instanceof WalkthroughTreeItem) {
      return element.file.walkthrough.steps.map(
        (step, i) => new StepTreeItem(step, i, element.file)
      );
    }

    return [];
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
  }
}
