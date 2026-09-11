---
name: selection-explainer
description: "Manage and troubleshoot the Codex Selection Explainer local helper for Codex Linux Desktop. Use when the user asks to install, uninstall, start, stop, or check the floating selected-text explainer."
---

# Codex Selection Explainer

This plugin bundles a local helper that injects a floating explainer into the
Codex Linux Desktop renderer through the built-in Chromium DevTools endpoint.
The Codex plugin manifest itself provides install metadata and instructions;
the actual floating UI is implemented by `src/renderer.js`, and the explanation
backend is implemented by `src/server.mjs`.

## What it does

- Selecting text in Codex shows a small floating `这是什么` button.
- Clicking the button opens a draggable explanation popup.
- The popup remains open until its close button is clicked.
- Selecting text inside an explanation popup shows the same button and can open
  a new popup while the original popup remains visible.
- Each popup has its own follow-up input. Follow-up answers are appended to that
  popup and include only that popup's previous question-and-answer history.
- Inline and display LaTeX formulas are rendered locally with the bundled KaTeX
  assets; invalid formulas fall back to their original text.

## Install

Run from the plugin source directory:

```bash
bash install.sh
```

The installer writes two files into the Codex Linux app runtime hook
directories:

- `.codex-linux/env.d/20-codex-selection-explainer`
- `.codex-linux/launcher.d/20-codex-selection-explainer`
- `.codex-linux/after-exit.d/20-codex-selection-explainer`

It also copies the helper to `~/.local/share/codex-selection-explainer/`.

After installing, fully quit Codex Desktop (including the tray process) and
start it again. The launcher then exposes the local CDP port and starts the
helper automatically.

## Troubleshooting

Check the helper log:

```bash
cat ~/.local/share/codex-selection-explainer/helper.log
```

Check the HTTP service:

```bash
curl http://127.0.0.1:34891/health
```

If the floating button does not appear, confirm the launcher log contains
`--remote-debugging-port=9222`, then restart Codex Desktop.
