import * as vscode from "vscode";
import { PlaybackStatus } from "../player/engine";
import { TtsConfig } from "../tts/config";
import { StaleCheckResult } from "../walkthrough/staleness";
import { WalkthroughStep } from "../walkthrough/types";

export type PanelCommand =
  | { type: "next" }
  | { type: "prev" }
  | { type: "togglePlayback" }
  | { type: "stop" }
  | { type: "goTo"; index: number }
  | { type: "setSpeed"; speed: number }
  | { type: "recordStep" }
  | { type: "recordUndo" }
  | { type: "recordStop" }
  | { type: "recordCancel" }
  | { type: "repair" }
  | { type: "openRelated"; path: string }
  | { type: "ttsReady" }
  | { type: "ttsSetVoice"; voiceUri: string };

export type PanelMessage = { type: "ttsState"; voiceUri: string };

export class WalkthroughPanel {
  private panel: vscode.WebviewPanel | null = null;
  private readonly extensionUri: vscode.Uri;

  private readonly onCommandEmitter = new vscode.EventEmitter<PanelCommand>();
  readonly onCommand = this.onCommandEmitter.event;

  private readonly onFocusChangeEmitter = new vscode.EventEmitter<boolean>();
  readonly onFocusChange = this.onFocusChangeEmitter.event;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.onFocusChangeEmitter.fire(this.panel.active);
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
      this.onFocusChangeEmitter.fire(false);
      this.onCommandEmitter.fire({ type: "stop" });
    });

    this.panel.onDidChangeViewState((event) => {
      this.onFocusChangeEmitter.fire(event.webviewPanel.active);
    });

    this.panel.webview.onDidReceiveMessage((msg: Record<string, unknown>) => {
      const command = typeof msg.command === "string" ? msg.command : "";

      switch (command) {
        case "next":
        case "prev":
        case "togglePlayback":
        case "stop":
        case "recordStep":
        case "recordUndo":
        case "recordStop":
        case "recordCancel":
        case "repair":
        case "ttsReady":
          this.onCommandEmitter.fire({ type: command });
          return;
        case "goTo":
          if (typeof msg.index === "number") {
            this.onCommandEmitter.fire({ type: "goTo", index: msg.index });
          }
          return;
        case "setSpeed":
          if (typeof msg.speed === "number") {
            this.onCommandEmitter.fire({ type: "setSpeed", speed: msg.speed });
          }
          return;
        case "openRelated":
          if (typeof msg.path === "string") {
            this.onCommandEmitter.fire({ type: "openRelated", path: msg.path });
          }
          return;
        case "ttsSetVoice":
          if (typeof msg.voiceUri === "string") {
            this.onCommandEmitter.fire({ type: "ttsSetVoice", voiceUri: msg.voiceUri });
          }
          return;
        default:
          return;
      }
    });
  }

  update(
    status: PlaybackStatus,
    staleResults: StaleCheckResult[] | undefined,
    ttsConfig: TtsConfig
  ): void {
    if (!this.panel) {
      return;
    }
    this.panel.webview.html = this.buildPlaybackHtml(status, staleResults, ttsConfig);
  }

  postMessage(message: PanelMessage): void {
    if (!this.panel) {
      return;
    }

    void this.panel.webview.postMessage(message);
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
    <button class="ctrl-btn" onclick="sendCommand('recordStep')">Capture Step</button>
    <button class="ctrl-btn secondary" onclick="sendCommand('recordUndo')" ${stepCount === 0 ? "disabled" : ""}>Undo Last</button>
    <button class="ctrl-btn" onclick="sendCommand('recordStop')" ${stepCount === 0 ? "disabled" : ""}>Save &amp; Finish</button>
    <button class="ctrl-btn secondary" onclick="sendCommand('recordCancel')">Cancel</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function sendCommand(command) { vscode.postMessage({ command }); }
  </script>
</body>
</html>`;
  }

  private buildPlaybackHtml(
    status: PlaybackStatus,
    staleResults: StaleCheckResult[] | undefined,
    ttsConfig: TtsConfig
  ): string {
    const step = status.currentStep;
    const walkthrough = status.walkthrough;
    const title = walkthrough?.title ?? "No Walkthrough";
    const subtitle = step?.subtitle ?? "";
    const explanation = step?.explanation ?? "";
    const symbolLabel = step?.symbol ?? "";
    const fileLabel = step
      ? `${step.file}:${step.lines[0]}-${step.lines[1]}`
      : "";
    const speechPayload = {
      stepKey: `${status.currentIndex}:${step?.file ?? ""}:${step?.lines.join("-") ?? ""}:${step?.symbol ?? ""}`,
      hasStep: !!step,
      hasNextStep: status.currentIndex < status.totalSteps - 1,
      text: step ? buildSpeechText(step) : "",
    };
    const stepLabel =
      status.totalSteps > 0
        ? `Step ${status.currentIndex + 1} / ${status.totalSteps}`
        : "No steps";
    const isPlaying = status.state === "playing";
    const playIcon = isPlaying ? "\u23F8" : "\u25B6";
    const playLabel = isPlaying ? "Pause" : "Play";

    const staleMap = new Map<number, StaleCheckResult>();
    if (staleResults) {
      for (const result of staleResults) {
        staleMap.set(result.stepIndex, result);
      }
    }

    const currentStale = staleMap.get(status.currentIndex);
    const hasAnyStale = staleResults?.some(
      (result) => result.status !== "fresh" && result.status !== "git-resolved"
    );
    const repairBtnHtml = hasAnyStale
      ? '<button class="ctrl-btn repair-btn" onclick="sendCommand(\'repair\')">Repair via Git</button>'
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
        .map((walkthroughStep, index) => {
          const activeClass = index === status.currentIndex ? "active" : "";
          const doneClass = index < status.currentIndex ? "done" : "";
          const staleInfo = staleMap.get(index);
          const staleClass =
            staleInfo?.status === "drifted"
              ? "drifted"
              : staleInfo?.status === "missing"
                ? "missing-file"
                : staleInfo?.status === "git-resolved"
                  ? "git-resolved"
                  : "";
          const icon =
            index < status.currentIndex
              ? "\u2713"
              : index === status.currentIndex
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
          return `<li class="step-item ${activeClass} ${doneClass} ${staleClass}" onclick="goTo(${index})">
          <span class="step-icon">${icon}</span>
          <span class="step-label">${index + 1}. ${escapeHtml(walkthroughStep.file)}:${walkthroughStep.lines[0]}${staleIcon}</span>
        </li>`;
        })
        .join("\n") ?? "";

    const speedOptions = [0.5, 1, 2, 3]
      .map(
        (speed) =>
          `<option value="${speed}" ${speed === status.speed ? "selected" : ""}>${speed}x</option>`
      )
      .join("");

    const relatedHtml = walkthrough?.related && walkthrough.related.length > 0
      ? `<div class="related-section">
          <div class="related-heading">Related Walkthroughs</div>
          <div class="related-list">
            ${walkthrough.related.map((relation) => {
              const note = relation.note ? `<span class="related-note">${escapeHtml(relation.note)}</span>` : "";
              const type = relation.type ? `<span class="related-type">${escapeHtml(relation.type)}</span>` : "";
              return `<button class="related-link" onclick='openRelated(${serializeJsString(relation.path)})'>${escapeHtml(relation.title ?? relation.path)}${type}</button>${note}`;
            }).join("")}
          </div>
        </div>`
      : "";

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
    .related-section {
      margin: 0 0 16px;
      padding: 12px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: var(--vscode-sideBar-background, rgba(255,255,255,0.03));
    }
    .related-heading {
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 8px;
      opacity: 0.8;
    }
    .related-list {
      display: grid;
      gap: 8px;
    }
    .related-link {
      text-align: left;
      border: 1px solid var(--vscode-button-secondaryBackground);
      background: transparent;
      color: var(--vscode-textLink-foreground);
      padding: 8px 10px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
    }
    .related-link:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .related-type {
      margin-left: 6px;
      opacity: 0.6;
      font-size: 11px;
      text-transform: uppercase;
    }
    .related-note {
      font-size: 11px;
      opacity: 0.7;
      margin-top: -2px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">${escapeHtml(title)}</div>
    <div class="meta">${escapeHtml(walkthrough?.description ?? "")}</div>
  </div>

  <div class="controls">
    <button class="ctrl-btn secondary" onclick="sendCommand('prev')">\u25C0\u25C0</button>
    <button class="ctrl-btn" onclick="sendCommand('togglePlayback')">${playIcon} ${playLabel}</button>
    <button class="ctrl-btn secondary" onclick="sendCommand('next')">\u25B6\u25B6</button>
    <select class="speed-select" onchange="setSpeed(this.value)">
      ${speedOptions}
    </select>
    <div class="progress-bar">
      <div class="progress-fill" style="width: ${status.totalSteps > 0 ? ((status.currentIndex + 1) / status.totalSteps) * 100 : 0}%"></div>
    </div>
    <span class="step-counter">${stepLabel}</span>
  </div>

  ${staleWarningHtml}
  <div class="file-label">${escapeHtml(fileLabel)}</div>
  ${symbolLabel ? `<div class="symbol-label">${escapeHtml(symbolLabel)}</div>` : ""}
  <div class="subtitle-box">${escapeHtml(subtitle) || "<em>No subtitle</em>"}</div>
  ${escapeHtml(explanation) ? `<div class="subtitle-box">${escapeHtml(explanation)}</div>` : ``}
  <div class="tts-controls">
    <button id="tts-button" class="ctrl-btn secondary" onclick="toggleTts()">Read Step</button>
    <label class="tts-option">
      <input id="auto-read-toggle" type="checkbox" onchange="toggleAutoRead(this.checked)">
      <span>Auto-read</span>
    </label>
    <label class="tts-option" for="tts-rate-select">Read speed</label>
    <select id="tts-rate-select" class="speed-select" onchange="setTtsRate(this.value)">
      <option value="0.75">0.75x</option>
      <option value="1">1.0x</option>
      <option value="1.25">1.25x</option>
      <option value="1.5">1.5x</option>
      <option value="1.75">1.75x</option>
      <option value="2">2.0x</option>
    </select>
    <label class="tts-option" for="tts-voice-select">Voice</label>
    <select id="tts-voice-select" class="speed-select" onchange="setTtsVoice(this.value)">
      <option value="">Loading voices...</option>
    </select>
    <span id="tts-voice-label" class="tts-voice-label">Voice: English (US)</span>
  </div>
  ${relatedHtml}

  <ul class="steps-list">
    ${stepsHtml}
  </ul>

  <div class="shortcuts-hint">
    <kbd>\u2190</kbd> prev &nbsp; <kbd>\u2192</kbd> next &nbsp; <kbd>Space</kbd> play/pause &nbsp; <kbd>Shift+Space</kbd> speed &nbsp; <kbd>Esc</kbd> stop
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const speechPayload = ${serializeScriptValue(speechPayload)};
    const initialTtsVoiceUri = ${serializeScriptValue(ttsConfig.voiceUri)};
    const defaultViewState = {
      autoRead: false,
      ttsRate: 1,
      ttsVoiceUri: initialTtsVoiceUri || '',
      lastSpokenStepKey: '',
    };
    let viewState = { ...defaultViewState, ...(vscode.getState() || {}) };
    if (!viewState.ttsVoiceUri && initialTtsVoiceUri) {
      viewState.ttsVoiceUri = initialTtsVoiceUri;
    }

    const ttsButton = document.getElementById('tts-button');
    const autoReadToggle = document.getElementById('auto-read-toggle');
    const ttsRateSelect = document.getElementById('tts-rate-select');
    const ttsVoiceSelect = document.getElementById('tts-voice-select');
    const ttsVoiceLabel = document.getElementById('tts-voice-label');
    const hasSpeech = typeof window.speechSynthesis !== 'undefined';
    const utterance = hasSpeech ? new SpeechSynthesisUtterance() : null;

    function sendCommand(command) { vscode.postMessage({ command }); }
    function sendMessage(message) { vscode.postMessage(message); }
    function goTo(index) { sendMessage({ command: 'goTo', index }); }
    function openRelated(path) { sendMessage({ command: 'openRelated', path }); }

    function setViewState(nextState) {
      viewState = { ...viewState, ...nextState };
      vscode.setState(viewState);
    }

    function updateTtsButton(isSpeaking) {
      if (!ttsButton) {
        return;
      }
      ttsButton.textContent = isSpeaking ? 'Stop Reading' : 'Read Step';
      ttsButton.disabled = !hasSpeech;
      ttsButton.title = hasSpeech ? '' : 'Speech synthesis is unavailable in this environment.';
    }

    function setSpeed(value) {
      const speed = Number.parseFloat(value);
      if (!Number.isFinite(speed)) {
        return;
      }
      sendMessage({ command: 'setSpeed', speed });
    }

    function setTtsRate(value) {
      const rate = Number.parseFloat(value);
      if (!Number.isFinite(rate)) {
        return;
      }
      setViewState({ ttsRate: rate });
      if (hasSpeech && speechSynthesis.speaking) {
        void speakCurrentStep(true);
      }
    }

    function setTtsVoice(voiceUri) {
      setViewState({ ttsVoiceUri: voiceUri });
      updateVoiceLabel();
      sendMessage({ command: 'ttsSetVoice', voiceUri });
      if (hasSpeech && speechSynthesis.speaking) {
        void speakCurrentStep(true);
      }
    }

    function populateVoiceOptions() {
      if (!ttsVoiceSelect || !hasSpeech) {
        return;
      }

      const voices = speechSynthesis.getVoices();
      if (!voices.length) {
        ttsVoiceSelect.innerHTML = '<option value="">Loading voices...</option>';
        return;
      }

      const selectedUri = resolveVoiceUri(voices);
      const options = voices
        .map((voice) => {
          const label = voice.name + ' (' + voice.lang + ')';
          const selected = voice.voiceURI === selectedUri ? ' selected' : '';
          return '<option value="' + voice.voiceURI.replace(/"/g, '&quot;') + '"' + selected + '>' + label + '</option>';
        })
        .join('');

      ttsVoiceSelect.innerHTML = options;
      if (selectedUri && selectedUri !== viewState.ttsVoiceUri) {
        setViewState({ ttsVoiceUri: selectedUri });
      }

      updateVoiceLabel();
    }

    function resolveVoiceUri(voices) {
      return (
        viewState.ttsVoiceUri ||
        initialTtsVoiceUri ||
        findDefaultVoiceUri(voices) ||
        ''
      );
    }

    function findDefaultVoiceUri(voices) {
      return (
        voices.find((voice) => voice.lang.toLowerCase() === 'en-us')?.voiceURI ||
        voices.find((voice) => voice.lang.toLowerCase().startsWith('en-us'))?.voiceURI ||
        voices.find((voice) => voice.lang.toLowerCase().startsWith('en'))?.voiceURI ||
        voices[0]?.voiceURI || ''
      );
    }

    function updateVoiceLabel() {
      if (!ttsVoiceLabel) {
        return;
      }

      if (!hasSpeech) {
        ttsVoiceLabel.textContent = 'Voice: Browser voices unavailable';
        return;
      }

      const selectedVoice = speechSynthesis.getVoices().find((voice) => voice.voiceURI === viewState.ttsVoiceUri);
      ttsVoiceLabel.textContent = 'Voice: ' + (selectedVoice?.name ?? 'English (US)');
    }

    function toggleAutoRead(enabled) {
      setViewState({
        autoRead: enabled,
        lastSpokenStepKey: enabled ? '' : viewState.lastSpokenStepKey,
      });

      if (!enabled) {
        stopSpeech();
        return;
      }

      void speakCurrentStep(true);
    }

    async function toggleTts() {
      if (!hasSpeech) {
        return;
      }

      if (speechSynthesis.speaking) {
        stopSpeech();
      } else {
        await speakCurrentStep(true);
      }
    }

    function findPreferredVoiceFromList(voices) {
      return voices.find((voice) => voice.voiceURI === viewState.ttsVoiceUri)
        || voices.find((voice) => voice.lang.toLowerCase() === 'en-us')
        || voices.find((voice) => voice.lang.toLowerCase().startsWith('en-us'))
        || voices.find((voice) => voice.lang.toLowerCase().startsWith('en'))
        || voices[0]
        || null;
    }

    async function resolvePreferredVoice() {
      if (!hasSpeech) {
        return null;
      }

      const initialVoice = findPreferredVoiceFromList(speechSynthesis.getVoices());
      if (initialVoice) {
        return initialVoice;
      }

      await new Promise((resolve) => {
        let settled = false;
        const onVoicesChanged = () => {
          if (settled) {
            return;
          }
          settled = true;
          speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
          resolve();
        };

        speechSynthesis.addEventListener('voiceschanged', onVoicesChanged, { once: true });
        setTimeout(onVoicesChanged, 300);
      });

      const resolvedVoice = findPreferredVoiceFromList(speechSynthesis.getVoices());
      if (resolvedVoice?.voiceURI && resolvedVoice.voiceURI !== viewState.ttsVoiceUri) {
        setViewState({ ttsVoiceUri: resolvedVoice.voiceURI });
      }
      return resolvedVoice;
    }

    async function speakCurrentStep(forceReplay) {
      if (!speechPayload.hasStep || !speechPayload.text || !utterance) {
        return;
      }

      if (!forceReplay && viewState.lastSpokenStepKey === speechPayload.stepKey) {
        return;
      }

      stopSpeech();

      const voice = await resolvePreferredVoice();
      utterance.text = speechPayload.text;
      utterance.lang = 'en-US';
      utterance.rate = Number(viewState.ttsRate) || 1;
      utterance.voice = voice;
      utterance.onend = () => {
        updateTtsButton(false);
        setViewState({ lastSpokenStepKey: speechPayload.stepKey });
        if (viewState.autoRead && speechPayload.hasNextStep) {
          sendCommand('next');
        }
      };
      utterance.onerror = () => {
        updateTtsButton(false);
      };

      if (ttsVoiceLabel) {
        ttsVoiceLabel.textContent = 'Voice: ' + (voice?.name ?? 'English (US)');
      }

      speechSynthesis.speak(utterance);
      updateTtsButton(true);
    }

    function stopSpeech() {
      if (!hasSpeech) {
        return;
      }
      speechSynthesis.cancel();
      updateTtsButton(false);
    }

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || message.type !== 'ttsState') {
        return;
      }

      if (typeof message.voiceUri === 'string' && message.voiceUri !== viewState.ttsVoiceUri) {
        setViewState({ ttsVoiceUri: message.voiceUri });
      }

      populateVoiceOptions();
      updateVoiceLabel();
    });

    if (autoReadToggle) {
      autoReadToggle.checked = !!viewState.autoRead;
      autoReadToggle.disabled = !hasSpeech;
    }

    if (ttsRateSelect) {
      ttsRateSelect.value = String(viewState.ttsRate || 1);
      ttsRateSelect.disabled = !hasSpeech;
    }

    if (ttsVoiceSelect) {
      ttsVoiceSelect.disabled = !hasSpeech;
    }

    window.addEventListener('beforeunload', () => {
      if (hasSpeech) {
        speechSynthesis.cancel();
      }
    });

    if (hasSpeech) {
      populateVoiceOptions();
      speechSynthesis.addEventListener('voiceschanged', () => {
        populateVoiceOptions();
        updateVoiceLabel();
      });
    } else {
      updateTtsButton(false);
      updateVoiceLabel();
    }

    sendCommand('ttsReady');

    if (viewState.autoRead) {
      void speakCurrentStep(false);
    }
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
    .symbol-label {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      opacity: 0.75;
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
    .step-icon { width: 16px; text-align: center; }
    .tts-controls {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .tts-option {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
    }
    .tts-voice-label {
      font-size: 11px;
      opacity: 0.7;
    }`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");
}

function serializeJsString(value: string): string {
  return JSON.stringify(value);
}

function buildSpeechText(step: WalkthroughStep): string {
  const parts = [
    step.file,
    step.symbol ? `${step.symbol.replace(/`/g, "")}` : "",
    step.subtitle,
    step.explanation ? `Explanation: ${step.explanation.replace(/`/g, "")}` : "",
  ].filter(Boolean);

  return parts.join(". \n");
}

function serializeScriptValue(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
