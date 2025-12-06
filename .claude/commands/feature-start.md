---
description: Start implementing a planned feature (assumes spec exists and branch is ready)
---

Implement feature: $ARGUMENTS

Setup:
1. Read the spec from docs/features/$ARGUMENTS.md
2. Check CLAUDE.md for project conventions
3. Start implementation immediately

Implementation approach:
- Work through the spec step-by-step
- Create files as needed in the documented structure
- Follow the coordinate system: Z is vertical (up), X/Y horizontal
- No comments except "// Keep as before" when abbreviating
- Console logging is acceptable for verification
- Provide full methods when possible

Technical constraints:
- Dual API support: WebGPU (primary) and WebGL2 (fallback)
- All renderers owned by Frontend
- Add uniforms via UniformManager first
- Test at each step (use criteria from spec if available)

Begin implementation now.