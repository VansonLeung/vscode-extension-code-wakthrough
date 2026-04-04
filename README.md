# Code Walkthrough (Still working-in-progress)

<img width="100%" alt="image" src="https://github.com/user-attachments/assets/21a8ed36-1aeb-4ed9-8e73-636424433322" />


Interactive, step-by-step guided tours of your codebase. Like a video player for code.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.90.0-blue.svg)

## Features

### 🎬 Playback Mode
- **Auto-navigation**: Automatically opens files and highlights relevant line ranges as you step through
- **Subtitle panel**: Explanations appear alongside the code in a dedicated webview panel
- **Keyboard controls**: Use arrow keys (← →) to navigate, Space to play/pause, Escape to stop
- **Speed control**: Cycle through 0.5x, 1x, 2x, and 3x playback speeds
- **Step list**: Click any step to jump directly to it

### 🎥 Record Mode
- **Interactive capture**: Select code in the editor and capture it as a step
- **Smart metadata**: Automatically detects the nearest symbol (function/class name) and computes content hashes for resilience
- **Subtitle prompts**: Enter explanations for each step as you record
- **Real-time counter**: See how many steps you've captured

### 🤖 AI Generation
- **One-click generation**: Right-click any folder and generate a walkthrough automatically
- **Prompt-guided generation**: Tell the AI what to focus on, investigate, or drill into before it writes the walkthrough
- **Context-aware**: Collects file structure, symbols, and code previews to feed to the AI
- **Walkthrough-aware**: AI can relate new walkthroughs to existing ones when they cover adjacent flows or follow-up topics
- **AI refactors existing walkthroughs**: Modify, extend, or refactor saved walkthroughs in place with extra instructions
- **Multi-provider support**: Works with OpenAI, Anthropic, Ollama (local), Groq, Together AI, or any OpenAI-compatible API
- **Provider-driven AI**: Quick Scan and Deep Exploration both use the provider you configure, with clipboard fallback only when no provider is configured

### 🌳 Sidebar Explorer
- **Tree view**: Browse all walkthroughs in your workspace
- **Expandable steps**: See step details at a glance
- **Related links**: Jump between connected walkthroughs from the tree or playback panel
- **Quick actions**: Refresh, generate, record, and export from the sidebar
- **File watcher**: Automatically updates when walkthrough files change

### 🔧 Git Integration & Auto-Repair
- **Resilient to changes**: Walkthroughs store commit SHA and content hashes to detect when code has changed
- **4-tier staleness detection**:
  1. **Fresh**: Code unchanged
  2. **Git-resolved**: Lines shifted but git diff can remap them
  3. **Symbol fallback**: Content changed but symbol still exists
  4. **Stale**: Unable to resolve — needs manual repair
- **One-click repair**: Rebase walkthroughs to current HEAD with automatic line remapping
- **File rename detection**: Handles moved files via git's rename detection

### 📤 Export
- **Markdown export**: Clean, readable format perfect for GitHub/GitLab READMEs
- **HTML export**: Standalone page with dark theme, line numbers, navigation, and keyboard controls
- **Code snippets**: Exports include the actual code from each step

## Installation

### From VS Code Marketplace
1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "Code Walkthrough"
4. Click Install

### From VSIX
```bash
# Download the latest .vsix from Releases
# In VS Code: Extensions → ... → Install from VSIX
```

## Quick Start

### 1. Play a Walkthrough

If your repository has `.walkthrough/*.json` files:

- **Command Palette**: `Walkthrough: Open Walkthrough` (Ctrl+Shift+P)
- **Sidebar**: Click the 📚 Walkthroughs icon in the Activity Bar, then click any walkthrough

### 2. Record a Walkthrough

1. **Start recording**: Command Palette → `Walkthrough: Start Recording` or click the 🔴 button in the sidebar
2. **Navigate**: Open files and select the lines you want to explain
3. **Capture**: Press `Ctrl+Shift+.` (or click "Capture Step" in the panel)
4. **Add subtitle**: Type your explanation when prompted
5. **Repeat**: Continue capturing steps
6. **Save**: Click "Stop & Save" — walkthrough saved to `.walkthrough/<timestamp>.json`

### 3. Generate with AI

1. **Set up AI**: Command Palette → `Walkthrough: Setup AI Provider`
  - Choose from Copilot, OpenAI, Anthropic, Ollama, Groq, Together AI, or Custom
  - Copilot will prompt for a model and remember it
  - HTTP providers will prompt for endpoint/model/API key as needed
2. **Generate**: Right-click any folder in the Explorer → "Generate Walkthrough for Folder"
   - Or use Command Palette → `Walkthrough: Generate Walkthrough with AI`
3. **Pick a strategy**: `Quick Scan` and `Deep Exploration` both use the provider you configured
4. **Guide the AI**: Enter an optional prompt such as “focus on auth flow”, “find the extension activation path”, or “drill into git repair logic”
5. **Open related walkthroughs**: If the AI links the new walkthrough to others, use the related links in the panel or tree to jump across them

### 4. Modify with AI

1. **Choose a walkthrough**: In the sidebar, right-click a walkthrough and select `Modify / Extend / Refactor Walkthrough with AI`
  - Or run it from the Command Palette and pick one or more walkthroughs
2. **Pick a mode**: Modify, Extend, or Refactor
3. **Add instructions**: Describe what to change, what to focus on, or what deeper path the walkthrough should cover
4. **Optional references**: Select other walkthroughs as related context for the AI
5. **Review**: Play the updated walkthrough or open the JSON directly

### 5. Export

1. **Sidebar**: Right-click any walkthrough → "Export Walkthrough"
   - Or click the ⬆ export icon in the sidebar title bar
2. **Choose format**: Markdown or HTML
3. **Save**: Pick location and filename
4. **Open**: Markdown opens in editor, HTML opens in browser

## Walkthrough File Format

Walkthroughs are stored as JSON in `.walkthrough/*.json`:

```json
{
  "title": "Extension Architecture",
  "description": "A walkthrough of how this VSCode extension is structured",
  "commitSha": "abc1234",
  "related": [
    {
      "path": ".walkthrough/ai-generation.json",
      "title": "AI Generation Pipeline",
      "type": "follow-up",
      "note": "Drills into how prompts are built and parsed"
    }
  ],
  "steps": [
    {
      "file": "src/extension.ts",
      "lines": [1, 5],
      "symbol": "activate",
      "contentHash": "sha256:...",
      "subtitle": "Entry point. The extension imports its three core modules...",
      "duration": 10
    }
  ]
}
```

**Fields:**
- `title` (required): Walkthrough name
- `description` (required): Short summary
- `commitSha` (optional): Git commit when recorded — enables auto-repair
- `related` (optional): Related walkthroughs in the same workspace
  - `path` (required): Relative path to another walkthrough JSON, such as `.walkthrough/auth-flow.json`
  - `title` (optional): Display title for the related walkthrough
  - `type` (optional): `related`, `prerequisite`, `follow-up`, or `alternative`
  - `note` (optional): Why the user might want to open that walkthrough next
- `steps` (required): Array of step objects
  - `file` (required): Relative path from workspace root
  - `lines` (required): `[start, end]` line numbers (1-indexed)
  - `symbol` (optional): Nearest function/class name for resilience
  - `contentHash` (optional): SHA256 of line content for staleness detection
  - `subtitle` (required): Explanation shown during playback
  - `duration` (optional): Seconds to show this step during auto-playback

## Commands

| Command | Keybinding | Description |
|---------|-----------|-------------|
| `Walkthrough: Open Walkthrough` | — | Pick and play a walkthrough |
| `Walkthrough: Next Step` | `→` (when active) | Go to next step |
| `Walkthrough: Previous Step` | `←` (when active) | Go to previous step |
| `Walkthrough: Play / Pause` | `Space` (when active) | Toggle playback |
| `Walkthrough: Stop Walkthrough` | `Escape` (when active) | Stop and close panel |
| `Walkthrough: Cycle Playback Speed` | `Shift+Space` (when active) | Cycle 0.5x/1x/2x/3x |
| `Walkthrough: Start Recording` | — | Begin recording mode |
| `Walkthrough: Capture Step` | `Ctrl+Shift+.` | Record current selection as step |
| `Walkthrough: Undo Last Step` | — | Remove most recent step |
| `Walkthrough: Stop Recording & Save` | — | Finish and save walkthrough |
| `Walkthrough: Cancel Recording` | — | Discard recording |
| `Walkthrough: Repair Walkthrough` | — | Rebase to HEAD using git |
| `Walkthrough: Generate Walkthrough with AI` | — | Generate from picker with optional AI guidance |
| `Walkthrough: Generate Walkthrough for Folder` | — | Right-click folder action with optional AI guidance |
| `Walkthrough: Modify / Extend / Refactor Walkthrough with AI` | — | Rewrite existing walkthroughs with AI |
| `Walkthrough: Setup AI Provider` | — | Configure AI endpoint |
| `Walkthrough: Export Walkthrough` | — | Export to Markdown or HTML |
| `Walkthrough: Refresh` | — | Refresh sidebar tree |

## Configuration

Configure AI providers in VS Code settings (`settings.json`):

```json
{
  "codeWalkthrough.ai.client": "copilot",
  "codeWalkthrough.ai.apiEndpoint": "https://api.openai.com/v1",
  "codeWalkthrough.ai.apiKey": "sk-...",
  "codeWalkthrough.ai.model": "gpt-4o",
  "codeWalkthrough.ai.copilotModel": ""
}
```

**Supported providers and endpoints:**
- Copilot provider: uses VS Code's language model API and a selected Copilot chat model
- OpenAI client: `https://api.openai.com/v1`
- Anthropic client: `https://api.anthropic.com/v1`
- Ollama (local): `http://localhost:11434/v1`
- Groq: `https://api.groq.com/openai/v1`
- Together AI: `https://api.together.xyz/v1`

Set `codeWalkthrough.ai.client` to `copilot`, `openai`, or `anthropic` depending on which provider you want both `Quick Scan` and `Deep Exploration` to use.

Set `codeWalkthrough.ai.copilotModel` to a specific Copilot model id if you want the Copilot provider to consistently use that model. If left blank and multiple Copilot models are available, the extension will ask you to pick one and remember it.

**Note:** API keys are only needed for HTTP providers. Copilot uses your VS Code language model access.

## Requirements

- VS Code 1.90.0 or higher
- Git (for auto-repair features)
- AI provider access: Copilot access or an HTTP provider API key (for AI generation)

## Known Issues

- Deep Exploration requires the configured provider and model to support tool use. If a provider returns repeated empty responses, the extension stops early and recommends switching provider, protocol, or model.
- Large folders may take time to process during AI generation (30+ files).
- Content hashes use SHA256 — very large files may impact performance.

## Roadmap

- [ ] Collaborative walkthroughs (share via URL/gist)
- [ ] Walkthrough versioning and branching
- [ ] In-editor annotations alongside playback
- [ ] Export to video/GIF
- [ ] Marketplace for community walkthroughs

## Contributing

Contributions welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT License — see [LICENSE](./LICENSE) for details.

---

**Enjoy coding with guided walkthroughs!** 🚀
