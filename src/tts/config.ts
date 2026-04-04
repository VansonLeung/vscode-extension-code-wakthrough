import * as vscode from "vscode";

export interface TtsConfig {
  voiceUri: string;
}

export function getTtsConfig(): TtsConfig {
  const config = vscode.workspace.getConfiguration("codeWalkthrough.tts");

  return {
    voiceUri: config.get<string>("voiceUri")?.trim() ?? "",
  };
}

export async function updateTtsVoice(voiceUri: string): Promise<void> {
  await vscode.workspace
    .getConfiguration("codeWalkthrough.tts")
    .update("voiceUri", voiceUri.trim(), vscode.ConfigurationTarget.Global);
}