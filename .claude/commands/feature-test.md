---
description: Test the feature in a real browser with Puppeteer
---

Use the browser-tester subagent to test: $ARGUMENTS

Testing process:
1. Start a local HTTP server if needed
2. Open the terrain renderer in Chrome
3. Wait for rendering to complete (3s)
4. Check console for errors
5. Take a screenshot
6. Verify the feature works as specified:
   - For fog: Check if fog effect is visible in screenshot
   - For lighting: Check if lighting appears correct
   - etc.
7. Run performance profiling if possible
8. Report results with screenshots

Pass criteria:
- No console errors
- Feature visually confirmed in screenshot
- Performance acceptable (note FPS if measurable)