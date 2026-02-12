# Contributing to Code Walkthrough

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to the Code Walkthrough extension.

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 18.x or higher
- [VS Code](https://code.visualstudio.com/) 1.90.0 or higher
- Git

### Installation

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/yourusername/code-walkthrough.git
   cd code-walkthrough
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Open in VS Code:
   ```bash
   code .
   ```

4. Press `F5` to open the Extension Development Host

## Project Structure

```
code-walkthrough/
├── src/
│   ├── extension.ts          # Main entry point
│   ├── ai/                   # AI generation
│   │   ├── context.ts        # Code context collection
│   │   ├── generate.ts       # AI generation orchestrator
│   │   └── openai-client.ts  # OpenAI-compatible client
│   ├── export/               # Export functionality
│   │   ├── html.ts           # HTML exporter
│   │   └── markdown.ts       # Markdown exporter
│   ├── git/                  # Git integration
│   │   ├── git.ts            # Git operations
│   │   └── repair.ts         # Walkthrough repair
│   ├── player/               # Playback engine
│   │   ├── engine.ts         # Playback state machine
│   │   └── highlight.ts      # Line highlighting
│   ├── recorder/             # Recording mode
│   │   └── recorder.ts       # Step capture
│   ├── ui/                   # User interface
│   │   ├── panel.ts          # Webview panel
│   │   ├── statusbar.ts      # Status bar indicators
│   │   └── tree.ts           # Sidebar tree view
│   └── walkthrough/          # Walkthrough data
│       ├── loader.ts         # JSON file loading
│       ├── staleness.ts      # Staleness detection
│       └── types.ts          # TypeScript interfaces
├── dist/                     # Compiled output
├── .walkthrough/             # Demo walkthroughs
├── icon.png                  # Extension icon
└── package.json              # Extension manifest
```

## Development Workflow

### Building

```bash
# Production build
npm run build

# Watch mode (rebuilds on file changes)
npm run watch

# Type checking (no emit)
npm run lint
```

### Testing

Currently, the project relies on manual testing in the Extension Development Host:

1. Press `F5` to launch the Extension Development Host
2. Test features in the new VS Code window
3. Use the demo walkthrough in `.walkthrough/demo.json` for testing

### Code Style

- **TypeScript**: Strict mode enabled
- **Formatting**: Use VS Code's default formatter
- **Imports**: Use absolute imports from `src/`

### Making Changes

1. Create a new branch for your feature/fix:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes

3. Build and test:
   ```bash
   npm run build
   npm run lint
   ```

4. Commit with a clear message:
   ```bash
   git commit -m "feat: add feature X"
   ```

## Commit Message Convention

We follow conventional commits:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style (formatting, no logic change)
- `refactor:` Code refactoring
- `test:` Adding/updating tests
- `chore:` Build process, dependencies, etc.

## Pull Request Process

1. Ensure your branch is up to date with `main`
2. Run `npm run build` and `npm run lint` successfully
3. Update README.md if you've added features
4. Update CHANGELOG.md under `[Unreleased]`
5. Submit PR with clear description of changes
6. Link any related issues

## Areas for Contribution

### High Priority

- [ ] Unit tests for core modules
- [ ] Performance optimizations for large codebases
- [ ] Better error handling and user feedback

### Feature Ideas

- [ ] Collaborative walkthroughs (share via URL/gist)
- [ ] Walkthrough versioning and branching
- [ ] Export to video/GIF
- [ ] Custom themes for HTML export
- [ ] Walkthrough templates
- [ ] Import from other formats

### Documentation

- [ ] More example walkthroughs
- [ ] Video tutorials
- [ ] Best practices guide

## Reporting Issues

When reporting bugs, please include:

1. VS Code version
2. Extension version
3. Operating system
4. Steps to reproduce
5. Expected vs actual behavior
6. Screenshots if applicable

## Questions?

Feel free to open an issue for questions or join discussions.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
