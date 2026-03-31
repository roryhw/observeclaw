# ObserveClaw — Release Workflow

## Pushing Code Changes (no version bump)

For bug fixes, tweaks, or work-in-progress updates:

```bash
cd /Users/roryhw/.openclaw/workspace/observeclaw

# 1. Build everything (server + UI)
npm run build

# 2. Stage all changes
git add -A

# 3. Review what you're committing
git status

# 4. Commit with a descriptive message
git commit -m "fix: description of what changed"

# 5. Push
git push
```

## Pushing a New Version

When you want to mark a release (new feature, breaking change, etc.):

```bash
cd /Users/roryhw/.openclaw/workspace/observeclaw

# 1. Build everything
npm run build

# 2. Stage and commit your changes first
git add -A
git commit -m "feat: description of what changed"

# 3. Bump the version (pick one)
npm version patch   # 1.0.0 → 1.0.1  (bug fixes)
npm version minor   # 1.0.0 → 1.1.0  (new features)
npm version major   # 1.0.0 → 2.0.0  (breaking changes)

# 4. Push code + version tag
git push --tags
```

`npm version` automatically updates `package.json`, creates a commit, and creates a git tag (e.g. `v1.0.1`).

## Commit Message Conventions

Use prefixes so the history is scannable:

| Prefix | When |
|--------|------|
| `fix:` | Bug fix |
| `feat:` | New feature |
| `docs:` | Documentation only |
| `refactor:` | Code change that doesn't fix a bug or add a feature |
| `chore:` | Build, tooling, or dependency updates |

Examples:
- `fix: memory stats incorrect on Linux ARM`
- `feat: add dark mode to dashboard`
- `docs: update README quick start`

## For Users Who Already Cloned

Tell them:

```bash
cd ~/.openclaw/workspace/observeclaw
git pull
npm install       # only if dependencies changed
node dist/server.js
```

## Checklist Before Every Push

- [ ] `npm run build` completed without errors
- [ ] No secrets in committed files (`git diff --staged` to review)
- [ ] README updated if user-facing behavior changed
- [ ] Version bumped if it's a release (not required for every push)
