import * as vscode from "vscode";
import { PlaybackStatus } from "../player/engine";
import { StaleCheckResult } from "../walkthrough/staleness";

export class WalkthroughPanel {
  private panel: vscode.WebviewPanel | null = null;
  private readonly extensionUri: vscode.Uri;

  private readonly onCommandEmitter = new vscode.EventEmitter<string>();
  readonly onCommand = this.onCommandEmitter.event;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "codeWalkthrough",
      "Walkthrough",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.panel.onDidDispose(() => {
      this.panel = null;
      this.onCommandEmitter.fire("stop");
    });

    this.panel.webview.onDidReceiveMessage(
      (msg: { command: string; index?: number }) => {
        if (msg.command === "goTo" && msg.index !== undefined) {
          this.onCommandEmitter.fire(`goTo:${msg.index}`);
        } else {
          this.onCommandEmitter.fire(msg.command);
        }
      }
    );
  }

  update(status: PlaybackStatus, staleResults?: StaleCheckResult[]): void {
    if (!this.panel) {
      return;
    }
    this.panel.webview.html = this.buildPlaybackHtml(status, staleResults);
  }

  updateRecording(stepCount: number): void {
    if (!this.panel) {
      return;
    }
    this.panel.webview.html = this.buildRecordingHtml(stepCount);
  }

  hide(): void {
    if (this.panel) {
      this.panel.dispose();
      this.panel = null;
    }
  }

  private buildRecordingHtml(stepCount: number): string {
    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${this.sharedStyles()}
    .record-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      color: var(--vscode-errorForeground, #f48771);
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    .record-dot {
      width: 8px; height: 8px;
      background: #f44;
      border-radius: 50%;
      animation: pulse-dot 1.2s ease-in-out infinite;
    }
    @keyframes pulse-dot {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    .record-instructions {
      font-size: 13px;
      line-height: 1.7;
      margin-bottom: 16px;
      opacity: 0.85;
    }
    .record-instructions kbd {
      background: var(--vscode-keybindingLabel-background, rgba(255,255,255,0.1));
      border: 1px solid var(--vscode-keybindingLabel-border, rgba(255,255,255,0.2));
      border-radius: 3px;
      padding: 1px 5px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
    }
    .record-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  </style>
</head>
<body>
  <div class="record-badge"><span class="record-dot"></span> Recording</div>
  <div class="header">
    <div class="title">Recording Walkthrough</div>
    <div class="meta">${stepCount} step${stepCount !== 1 ? "s" : ""} captured</div>
  </div>

  <div class="record-instructions">
    1. Navigate to code you want to explain<br>
    2. Select the lines to highlight<br>
    3. Press <kbd>Ctrl+Shift+.</kbd> or click <strong>Capture Step</strong><br>
    4. Enter a subtitle explaining the code
  </div>

  <div class="record-actions">
    <button class="ctrl-btn" onclick="send('recordStep')">Capture Step</button>
    <button class="ctrl-btn secondary" onclick="send('recordUndo')" ${stepCount === 0 ? "disabled" : ""}>Undo Last</button>
    <button class="ctrl-btn" onclick="send('recordStop')" ${stepCount === 0 ? "disabled" : ""}>Save &amp; Finish</button>
    <button class="ctrl-btn secondary" onclick="send('recordCancel')">Cancel</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function send(command) { vscode.postMessage({ command }); }
  </script>
</body>
</html>`;
  }

  private buildPlaybackHtml(
    status: PlaybackStatus,
    staleResults?: StaleCheckResult[]
  ): string {
    const step = status.currentStep;
    const walkthrough = status.walkthrough;
    const title = walkthrough?.title ?? "No Walkthrough";
    const subtitle = step?.subtitle ?? "";
    const fileLabel = step
      ? `${step.file}:${step.lines[0]}-${step.lines[1]}`
      : "";
    const stepLabel =
      status.totalSteps > 0
        ? `Step ${status.currentIndex + 1} / ${status.totalSteps}`
        : "No steps";
    const isPlaying = status.state === "playing";
    const playIcon = isPlaying ? "\u23F8" : "\u25B6";
    const playLabel = isPlaying ? "Pause" : "Play";

    const staleMap = new Map<number, StaleCheckResult>();
    if (staleResults) {
      for (const r of staleResults) {
        staleMap.set(r.stepIndex, r);
      }
    }

    const currentStale = staleMap.get(status.currentIndex);
    const hasAnyStale = staleResults?.some(
      (r) => r.status !== "fresh" && r.status !== "git-resolved"
    );
    const repairBtnHtml = hasAnyStale
      ? '<button class="ctrl-btn repair-btn" onclick="send(\'repair\')">Repair via Git</button>'
      : "";
    const staleWarningHtml =
      currentStale && currentStale.status !== "fresh"
        ? `<div class="stale-warning ${currentStale.status}">
            <span class="stale-icon">${currentStale.status === "missing" ? "\u26A0" : currentStale.status === "git-resolved" ? "\u2713" : "\u21C4"}</span>
            <span>${escapeHtml(currentStale.detail ?? "Code may have changed")}</span>
            ${currentStale.status !== "git-resolved" ? repairBtnHtml : ""}
          </div>`
        : "";

    const stepsHtml =
      walkthrough?.steps
        .map((s, i) => {
          const activeClass = i === status.currentIndex ? "active" : "";
          const doneClass = i < status.currentIndex ? "done" : "";
          const staleInfo = staleMap.get(i);
          const staleClass =
            staleInfo?.status === "drifted"
              ? "drifted"
              : staleInfo?.status === "missing"
                ? "missing-file"
                : staleInfo?.status === "git-resolved"
                  ? "git-resolved"
                  : "";
          const icon =
            i < status.currentIndex
              ? "\u2713"
              : i === status.currentIndex
                ? "\u25B6"
                : "\u25CB";
          const staleIcon =
            staleInfo?.status === "drifted"
              ? ' <span class="stale-dot" title="Code has drifted">\u21C4</span>'
              : staleInfo?.status === "missing"
                ? ' <span class="stale-dot missing" title="File missing">\u26A0</span>'
                : staleInfo?.status === "git-resolved"
                  ? ' <span class="stale-dot resolved" title="Resolved via git">\u2713</span>'
                  : "";
          return `<li class="step-item ${activeClass} ${doneClass} ${staleClass}" onclick="goTo(${i})">
          <span class="step-icon">${icon}</span>
          <span class="step-label">${i + 1}. ${escapeHtml(s.file)}:${s.lines[0]}${staleIcon}</span>
        </li>`;
        })
        .join("\n") ?? "";

    const speedOptions = [0.5, 1, 2, 3]
      .map(
        (s) =>
          `<option value="${s}" ${s === status.speed ? "selected" : ""}>${s}x</option>`
      )
      .join("");

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${this.sharedStyles()}
    .speed-select {
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border);
      border-radius: 4px;
      padding: 4px 6px;
      font-size: 12px;
      cursor: pointer;
    }
    .stale-warning {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 4px;
      margin-bottom: 12px;
      font-size: 12px;
    }
    .stale-warning.drifted {
      background: rgba(255, 193, 7, 0.15);
      border: 1px solid rgba(255, 193, 7, 0.4);
      color: var(--vscode-editorWarning-foreground, #cca700);
    }
    .stale-warning.missing {
      background: rgba(244, 67, 54, 0.15);
      border: 1px solid rgba(244, 67, 54, 0.4);
      color: var(--vscode-errorForeground, #f48771);
    }
    .stale-warning.git-resolved {
      background: rgba(76, 175, 80, 0.15);
      border: 1px solid rgba(76, 175, 80, 0.4);
      color: var(--vscode-terminal-ansiGreen, #89d185);
    }
    .stale-icon { font-size: 16px; }
    .stale-dot {
      font-size: 10px;
      color: var(--vscode-editorWarning-foreground, #cca700);
    }
    .stale-dot.missing {
      color: var(--vscode-errorForeground, #f48771);
    }
    .stale-dot.resolved {
      color: var(--vscode-terminal-ansiGreen, #89d185);
    }
    .repair-btn {
      margin-left: auto;
      font-size: 11px;
      padding: 3px 8px;
    }
    .step-item.drifted { border-left: 2px solid rgba(255, 193, 7, 0.6); }
    .step-item.missing-file { border-left: 2px solid rgba(244, 67, 54, 0.6); opacity: 0.5; }
    .step-item.git-resolved { border-left: 2px solid rgba(76, 175, 80, 0.6); }
    .shortcuts-hint {
      font-size: 11px;
      opacity: 0.5;
      margin-top: 12px;
      line-height: 1.6;
    }
    .shortcuts-hint kbd {
      background: var(--vscode-keybindingLabel-background, rgba(255,255,255,0.1));
      border: 1px solid var(--vscode-keybindingLabel-border, rgba(255,255,255,0.2));
      border-radius: 3px;
      padding: 1px 5px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 10px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">${escapeHtml(title)}</div>
    <div class="meta">${escapeHtml(walkthrough?.description ?? "")}</div>
  </div>

  <div class="controls">
    <button class="ctrl-btn secondary" onclick="send('prev')">\u25C0\u25C0</button>
    <button class="ctrl-btn" onclick="send('togglePlayback')">${playIcon} ${playLabel}</button>
    <button class="ctrl-btn secondary" onclick="send('next')">\u25B6\u25B6</button>
    <select class="speed-select" onchange="send('setSpeed:' + this.value)">
      ${speedOptions}
    </select>
    <div class="progress-bar">
      <div class="progress-fill" style="width: ${status.totalSteps > 0 ? ((status.currentIndex + 1) / status.totalSteps) * 100 : 0}%"></div>
    </div>
    <span class="step-counter">${stepLabel}</span>
  </div>

  ${staleWarningHtml}
  <div class="file-label">${escapeHtml(fileLabel)}</div>
  <div class="subtitle-box">${escapeHtml(subtitle) || "<em>No subtitle</em>"}</div>

  <ul class="steps-list">
    ${stepsHtml}
  </ul>

  <div class="shortcuts-hint">
    <kbd>\u2190</kbd> prev &nbsp; <kbd>\u2192</kbd> next &nbsp; <kbd>Space</kbd> play/pause &nbsp; <kbd>Shift+Space</kbd> speed &nbsp; <kbd>Esc</kbd> stop
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function send(command) { vscode.postMessage({ command }); }
    function goTo(index) { vscode.postMessage({ command: 'goTo', index }); }
  </script>
</body>
</html>`;
  }

  private sharedStyles(): string {
    return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family, sans-serif);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 16px;
      line-height: 1.5;
    }
    .header {
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .title { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
    .meta { font-size: 12px; opacity: 0.7; }
    .controls {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      padding: 8px 0;
    }
    .ctrl-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      min-width: 36px;
    }
    .ctrl-btn:hover { background: var(--vscode-button-hoverBackground); }
    .ctrl-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .ctrl-btn.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .progress-bar {
      flex: 1;
      height: 4px;
      background: var(--vscode-progressBar-background, #333);
      border-radius: 2px;
      overflow: hidden;
      margin: 0 8px;
    }
    .progress-fill {
      height: 100%;
      background: var(--vscode-progressBar-background, #0078d4);
      transition: width 0.3s ease;
    }
    .step-counter { font-size: 12px; opacity: 0.8; white-space: nowrap; }
    .subtitle-box {
      background: var(--vscode-textBlockQuote-background, rgba(255,255,255,0.05));
      border-left: 3px solid var(--vscode-textLink-foreground, #3794ff);
      padding: 12px 16px;
      margin-bottom: 16px;
      border-radius: 0 4px 4px 0;
      font-size: 13px;
      line-height: 1.6;
    }
    .file-label {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      opacity: 0.6;
      margin-bottom: 8px;
    }
    .steps-list { list-style: none; max-height: 300px; overflow-y: auto; }
    .step-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .step-item:hover { background: var(--vscode-list-hoverBackground); }
    .step-item.active {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }
    .step-item.done { opacity: 0.6; }
    .step-icon { width: 16px; text-align: center; }`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
