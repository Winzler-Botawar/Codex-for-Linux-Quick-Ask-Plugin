# Changelog

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
