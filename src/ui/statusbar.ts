import * as vscode from "vscode";

export class StatusBarController {
  private playbackItem: vscode.StatusBarItem;
  private recordItem: vscode.StatusBarItem;
  private speedItem: vscode.StatusBarItem;

  constructor() {
    this.playbackItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.playbackItem.command = "codeWalkthrough.togglePlayback";

    this.recordItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      99
    );
    this.recordItem.command = "codeWalkthrough.recordStop";

    this.speedItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      98
    );
    this.speedItem.command = "codeWalkthrough.cycleSpeed";
  }

  showPlayback(
    state: "playing" | "paused",
    stepIndex: number,
    totalSteps: number,
    speed: number
  ): void {
    const icon = state === "playing" ? "$(debug-pause)" : "$(play)";
    const stateLabel = state === "playing" ? "Playing" : "Paused";
    this.playbackItem.text = `${icon} Walkthrough: ${stateLabel} (${stepIndex + 1}/${totalSteps})`;
    this.playbackItem.tooltip = "Click to toggle play/pause";
    this.playbackItem.show();

    this.speedItem.text = `$(dashboard) ${speed}x`;
    this.speedItem.tooltip = "Click to cycle speed";
    this.speedItem.show();

    this.recordItem.hide();
  }

  showRecording(stepCount: number): void {
    this.recordItem.text = `$(record) Recording... (${stepCount} steps)`;
    this.recordItem.tooltip = "Click to stop recording";
    this.recordItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.errorBackground"
    );
    this.recordItem.show();

    this.playbackItem.hide();
    this.speedItem.hide();
  }

  hideAll(): void {
    this.playbackItem.hide();
    this.recordItem.hide();
    this.speedItem.hide();
  }

  dispose(): void {
    this.playbackItem.dispose();
    this.recordItem.dispose();
    this.speedItem.dispose();
  }
}
