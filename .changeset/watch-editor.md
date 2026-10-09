---
"@effx/cli": minor
"@effx/compiler": minor
---

Add saved-input `effx dev` checks and opt-in `dev --build` emission with shared output custody. Add a single-project stdio `effx lsp` server for unsaved source and dependency diagnostics through the same compiler pipeline.

Require launch-time LSP authority for executable config. Add source-relative `executableCoverage` config and repeatable `--exec-file` / `--exec-dir` declarations. Restart detection is conditional on complete caller coverage of all otherwise-unobservable executable routes, including static package symlinks, exports, `#imports`, and external aliases; omitted routes can evade detection.

Extend the compiler frontend boundary for immutable source snapshots and observed reads. The private `@effx/frontend-ts` package (currently `0.0.0`) supplies the TypeScript implementation bundled into `@effx/cli`; it has no independent public release. The affected public packages currently use `0.1.0`.

Document finite session, observer, transport, and open-text admission; owned shutdown; exact-directory output locks; and the limits of config trust and executable observation.

Declare the frozen Linux-x64/glibc LSP qualification with Bun 1.3.13 and trusted POSIX readiness code loaded through public Bun dlopen. The build derives ABI 2 metadata and source/artifact identities from `tools/native/lsp-readiness.c` and `scripts/lsp-native-manifest.ts`; this does not certify Ubuntu. CLI adoption and packed-client acceptance remain pending.

Amendment B requires classified startup refusal for regular-file stdout before protocol writes or native writer acquisition. `effx lsp > protocol.log` is unsupported. Maintained Node-client sockets, FIFO, and PTY retain the two-second stalled-writer/close budget. Regular-file stdin, the original four defaults, executable-coverage amendment A, and other CLI/runtime behavior remain unchanged.

Require exclusive stdin ownership and cooperative trusted config reporting. Effx-owned reporting uses stderr or framed protocol messages; arbitrary raw stdout writes and global console output remain outside containment. No global console monkeypatch or sandbox is added. Source: spec 0018 amendment B (frozen `B3cffc85`, lines 678–712), Linux amendment, and `scripts/lsp-linux.ts`.
