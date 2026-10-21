# Rotstift

Cross-platform desktop app (Tauri 2, React, TypeScript) that corrects student work, offline by default: It transcribes handwritten scans or PDFs with a local model, annotates the text with standardized correction marks and draws them in thin red "fineliner" handwriting onto the original pages, plus statistics. Privacy is the core constraint: No telemetry, and student data never leaves the machine unless the user switches a step to a cloud model or an own server ([ADR 0009](docs/adr/0009-cloud-modelle.md)). Otherwise there are no network calls except model downloads, and cloud calls only go through Rust. It must run on an 8 GB laptop without GPU.

## Commands

```bash
pnpm fetch:runtime  # download the pinned llama-server sidecar, needed before any Rust build
pnpm dev            # Tauri app with hot reload
pnpm dev:web        # frontend only in the browser, port 1420
pnpm build          # installers for the current OS (pnpm build --debug is faster)
pnpm check          # typecheck, oxlint, prettier --check, vitest, cargo fmt --check, clippy, cargo test
pnpm format         # prettier --write and cargo fmt
pnpm test           # vitest once
```

`pnpm check` must pass before every commit. With Homebrew's rustup, `cargo` lives in `/opt/homebrew/opt/rustup/bin`.

## Structure

- `src/`: React frontend. Domain logic in plain TypeScript modules with colocated `*.test.ts`.
- `src-tauri/`: Thin Rust shell (window, file access, later the llama.cpp `llama-server` sidecar, model download, hardware detection). Keep logic in TypeScript unless it needs the OS.
- `docs/adr/`: Architecture decisions, German.

## Conventions

- UI text, README, ADRs, commits and PRs in German; code, identifiers and comments in English.
- Relative imports carry the extension (`./App.tsx`, `./count-words.ts`).
- Never commit real student work. Tests and evaluation use self-written samples.
- New network access or a looser CSP in `src-tauri/tauri.conf.json` needs an explicit reason in the PR.
