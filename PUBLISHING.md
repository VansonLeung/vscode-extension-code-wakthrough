# Publishing Guide

This guide covers how to publish the Code Walkthrough extension to the VS Code Marketplace.

## Prerequisites

1. **Azure DevOps Personal Access Token (PAT)**
   - Go to https://dev.azure.com
   - Create an account if you don't have one
   - Navigate to User Settings → Personal Access Tokens
   - Create a new token with "Marketplace" scope (Publish)
   - Copy the token (you won't see it again)

2. **Publisher Account**
   - Go to https://marketplace.visualstudio.com/manage
   - Sign in with your Microsoft account
   - Create a publisher with ID `code-walkthrough` (or your preferred ID)
   - Update `package.json` with your actual publisher ID

3. **vsce CLI**
   ```bash
   npm install -g @vscode/vsce
   ```

## Quick Publish

```bash
# Login to vsce (only once)
vsce login <publisher-id>
# Enter your Azure DevOps PAT when prompted

# Publish
vsce publish
```

## Manual Steps

### 1. Update Version

Update the version in `package.json` following [Semantic Versioning](https://semver.org/):

```json
{
  "version": "0.1.0"  // Change this
}
```

Also update `CHANGELOG.md`:

```markdown
## [0.1.0] - 2025-02-12
### Added
- Initial release
...
```

### 2. Build and Test

```bash
# Clean install
rm -rf node_modules dist
npm install

# Build
npm run build

# Type check
npm run lint

# Package locally and test
vsce package
# Install the .vsix in VS Code to test
```

### 3. Update Publisher Info

Before publishing, update these fields in `package.json`:

```json
{
  "publisher": "your-publisher-id",  // Change from "code-walkthrough"
  "repository": {
    "type": "git",
    "url": "https://github.com/YOURUSERNAME/code-walkthrough.git"
  },
  "bugs": {
    "url": "https://github.com/YOURUSERNAME/code-walkthrough/issues"
  },
  "homepage": "https://github.com/YOURUSERNAME/code-walkthrough#readme"
}
```

### 4. Publish

```bash
# Publish as patch (0.1.0 → 0.1.1)
vsce publish patch

# Or publish as minor (0.1.0 → 0.2.0)
vsce publish minor

# Or publish as major (0.1.0 → 1.0.0)
vsce publish major

# Or publish specific version
vsce publish 0.1.1
```

### 5. Verify

- Go to https://marketplace.visualstudio.com/items?itemName=your-publisher-id.code-walkthrough
- Check that the extension appears
- Verify icon, screenshots, and README render correctly
- Install from marketplace to test

## Troubleshooting

### "Publisher not found"
- Ensure you've created the publisher at https://marketplace.visualstudio.com/manage
- Verify the publisher ID in `package.json` matches exactly

### "Invalid access token"
- Regenerate your Azure DevOps PAT
- Ensure it has "Marketplace" → "Publish" scope
- Run `vsce login <publisher-id>` again

### Package too large
- Check `.vscodeignore` excludes unnecessary files
- Maximum package size is 100MB

### Icon not showing
- Ensure `icon.png` is 128x128 pixels
- Check it's referenced correctly in `package.json`
- Verify it's included in the VSIX (not in `.vscodeignore`)

## Continuous Deployment (Optional)

### GitHub Actions

Create `.github/workflows/publish.yml`:

```yaml
name: Publish

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - run: npm ci
      
      - run: npm run build
      
      - name: Publish to Marketplace
        run: npx vsce publish -p ${{ secrets.VSCE_PAT }}
```

Add `VSCE_PAT` secret in GitHub repository settings.

## Post-Publish Checklist

- [ ] Extension appears on Marketplace
- [ ] Icon displays correctly
- [ ] README renders properly
- [ ] CHANGELOG is visible
- [ ] Extension installs successfully
- [ ] All commands work
- [ ] Walkthrough playback works
- [ ] Recording works
- [ ] AI generation works (with API key)
- [ ] Git repair works
- [ ] Export works

## Support

For marketplace issues:
- https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- https://marketplace.visualstudio.com/manage

For vsce issues:
- https://github.com/microsoft/vscode-vsce
