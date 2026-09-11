# Changelog

## 0.1.3 - 2026-09-11

- Reused the KaTeX stylesheet already bundled with Codex when it is available.
- Kept the bundled KaTeX stylesheet as a fallback for builds without native math CSS.
- Limited the bundled font sources to the installed `woff2` files.
- Fixed the launcher when `CODEX_MANAGED_NODE_RUNTIME_DIR` is unset.

## 0.1.2 - 2026-09-11

- Fixed formula rendering in Codex windows that still contain an older injected renderer.
- Added versioned in-page renderer upgrades that replace stale floating UI and styles.
- Added an explicit renderer version marker and compatible helper replacement.

## 0.1.1 - 2026-09-11

- Added local KaTeX rendering for inline and display formulas.
- Added formula parsing for `$...$`, `$$...$$`, `\(...\)`, and `\[...\]`.
- Added streaming-safe formula re-rendering and raw-text fallback for invalid formulas.
- Added bundled KaTeX assets and local font serving, with no runtime CDN dependency.
- Added per-window follow-up questions with streamed answers.

## 0.1.0 - 2026-08-27

- Added selected-text `这是什么` action for Codex Linux Desktop.
- Added draggable explanation windows that remain open until explicitly closed.
- Added recursive selection and explanation inside existing windows.
- Added multilingual UI and input-language-aware explanations.
- Added streaming output through `codex app-server --stdio`.
- Added local installation and uninstall scripts.
