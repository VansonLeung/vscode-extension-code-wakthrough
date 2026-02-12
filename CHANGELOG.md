# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2025-02-12

### Added

#### Core Features
- **Playback Mode**: Interactive step-by-step walkthrough with auto-navigation
  - Auto-jump to files and highlight line ranges
  - Subtitle panel with step explanations
  - Keyboard controls (arrow keys, space, escape)
  - Playback speed control (0.5x/1x/2x/3x)
  - Progress bar and step list

- **Record Mode**: Create walkthroughs by navigating your code
  - Capture steps with `Ctrl+Shift+.`
  - Auto-detect nearest symbol name
  - Compute content hashes for resilience
  - Real-time step counter
  - Undo last step functionality

#### AI Generation
- Generate walkthroughs automatically from folder context
- Multi-provider support:
  - OpenAI (GPT-4, GPT-3.5)
  - Anthropic (Claude)
  - Ollama (local models)
  - Groq
  - Together AI
  - Custom OpenAI-compatible endpoints
- Three-tier fallback: Copilot API → configured endpoint → clipboard
- Context collection (up to 30 files, symbols, previews)

#### Git Integration
- Store commit SHA in walkthrough files
- 4-tier staleness detection:
  1. Fresh (content hash match)
  2. Git-resolved (diff-based line remapping)
  3. Symbol fallback (symbol search)
  4. Stale (unresolvable)
- Auto-repair command to rebase walkthroughs to HEAD
- File rename detection via git

#### Sidebar Explorer
- Tree view of all walkthroughs in workspace
- Expandable steps with preview
- Quick actions: Refresh, Generate, Record, Export
- File system watcher for auto-refresh

#### Export
- Markdown export with fenced code blocks
- HTML export with dark theme, line numbers, navigation
- Standalone HTML with keyboard controls and scroll tracking

#### Configuration
- VS Code settings for AI provider
- Quick-setup wizard for popular providers

### Technical
- TypeScript 5.3
- VS Code Engine 1.90.0+
- esbuild for bundling
- No runtime dependencies

[Unreleased]: https://github.com/yourusername/code-walkthrough/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/yourusername/code-walkthrough/releases/tag/v0.1.0
