# Code Walkthrough

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
- **Context-aware**: Collects file structure, symbols, and code previews to feed to the AI
- **Multi-provider support**: Works with OpenAI, Anthropic, Ollama (local), Groq, Together AI, or any OpenAI-compatible API
- **Three-tier fallback**: Tries VS Code's Copilot API first, then your configured endpoint, then falls back to clipboard

### 🌳 Sidebar Explorer
- **Tree view**: Browse all walkthroughs in your workspace
- **Expandable steps**: See step details at a glance
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
   - Choose from OpenAI, Anthropic, Ollama, Groq, Together AI, or Custom
   - Enter your API key (stored in VS Code settings)
2. **Generate**: Right-click any folder in the Explorer → "Generate Walkthrough for Folder"
   - Or use Command Palette → `Walkthrough: Generate Walkthrough with AI`

### 4. Export

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
| `Walkthrough: Generate Walkthrough with AI` | — | Generate from picker |
| `Walkthrough: Generate Walkthrough for Folder` | — | Right-click folder action |
| `Walkthrough: Setup AI Provider` | — | Configure AI endpoint |
| `Walkthrough: Export Walkthrough` | — | Export to Markdown or HTML |
| `Walkthrough: Refresh` | — | Refresh sidebar tree |

## Configuration

Configure AI providers in VS Code settings (`settings.json`):

```json
{
  "codeWalkthrough.ai.apiEndpoint": "https://api.openai.com/v1",
  "codeWalkthrough.ai.apiKey": "sk-...",
  "codeWalkthrough.ai.model": "gpt-4o"
}
```

**Supported endpoints:**
- OpenAI: `https://api.openai.com/v1`
- Anthropic: `https://api.anthropic.com/v1`
- Ollama (local): `http://localhost:11434/v1`
- Groq: `https://api.groq.com/openai/v1`
- Together AI: `https://api.together.xyz/v1`

**Note:** API keys are stored in VS Code settings. For production use, consider using a key management solution.

## Requirements

- VS Code 1.90.0 or higher
- Git (for auto-repair features)
- AI provider API key (for AI generation)

## Known Issues

- Anthropic API uses `x-api-key` header instead of `Authorization: Bearer`. Use an OpenAI-compatible proxy or custom endpoint if needed.
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
