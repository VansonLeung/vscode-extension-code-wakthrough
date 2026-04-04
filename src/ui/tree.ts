import * as vscode from "vscode";
import * as path from "path";
import { discoverWalkthroughs } from "../walkthrough/loader";
import { WalkthroughFile, WalkthroughRelation, WalkthroughStep } from "../walkthrough/types";

type TreeItem = WalkthroughTreeItem | RelatedTreeItem | StepTreeItem;

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

class RelatedTreeItem extends vscode.TreeItem {
  constructor(
    public readonly relation: WalkthroughRelation,
    public readonly parentFile: WalkthroughFile
  ) {
    super(`Related: ${relation.title ?? path.basename(relation.path, ".json")}`, vscode.TreeItemCollapsibleState.None);
    this.description = relation.type ?? "related";
    this.tooltip = `${relation.path}${relation.note ? `\n${relation.note}` : ""}`;
    this.iconPath = new vscode.ThemeIcon("link-external");
    this.contextValue = "walkthroughRelation";
    this.command = {
      command: "codeWalkthrough.openLinkedWalkthrough",
      title: "Open Related Walkthrough",
      arguments: [relation.path],
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
      const relatedItems = (element.file.walkthrough.related ?? []).map(
        (relation) => new RelatedTreeItem(relation, element.file)
      );
      const stepItems = element.file.walkthrough.steps.map(
        (step, i) => new StepTreeItem(step, i, element.file)
      );
      return [...relatedItems, ...stepItems];
    }

    return [];
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
  }
}
