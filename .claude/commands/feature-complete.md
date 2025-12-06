---
description: Finalize and merge the feature
---

Complete the feature: $ARGUMENTS

Final steps:
1. Run final test suite
2. Update documentation if needed
3. Update CHANGELOG.md
4. Commit all changes with descriptive message
5. Create a summary of what was implemented
6. Ask if I want to merge to main or create a PR

Don't merge automatically - wait for confirmation.
```

## Usage in VS Code

Instead of bash scripts, you use slash commands interactively in the Claude Code panel:
```
# Start a new feature
/feature-start terrain-fog

# After reviewing the plan, implement it
/feature-implement terrain-fog

# Review the code
/feature-review terrain-fog

# Test in browser
/feature-test terrain-fog

# Complete and merge
/feature-complete terrain-fog