---
"@effx/cli": minor
"@effx/compiler": minor
---

Add saved-input `effx dev` checks and opt-in `dev --build` emission with shared output custody. Add a single-project stdio `effx lsp` server for unsaved source and dependency diagnostics through the same compiler pipeline.

Require launch-time LSP authority for executable config. Add source-relative `executableCoverage` config and repeatable `--exec-file` / `--exec-dir` declarations. Restart detection is conditional on complete caller coverage of all otherwise-unobservable executable routes, including static package symlinks, exports, `#imports`, and external aliases; omitted routes can evade detection.

Extend the compiler frontend boundary for immutable source snapshots and observed reads. The private `@effx/frontend-ts` package (currently `0.0.0`) supplies the TypeScript implementation bundled into `@effx/cli`; it has no independent public release. The affected public packages currently use `0.1.0`.

Document finite session, observer, transport, and open-text admission; owned shutdown; exact-directory output locks; and the limits of config trust and executable observation.

Qualify `effx lsp` for declared Linux-x64/glibc targets with packaged, audited POSIX readiness code loaded through public Bun dlopen. Require exclusive stdin ownership and cooperative trusted config stdio. Unsupported targets fail explicitly before unsafe IO. Other CLI commands and `effx dev` retain existing runtime/platform behavior; arbitrary trusted effects remain outside sandbox containment.
