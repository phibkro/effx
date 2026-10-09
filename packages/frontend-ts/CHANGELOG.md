# Changelog

## Unreleased

- Export `LiftTsSourceFrontend.analyze` and `LiftTsSourceFrontend.layer` from `@effx/frontend-ts` for spec 0019.
- Return `StageResult<EffectModel>` with project diagnostics. Missing or unsupported Effect profiles return `None`, without an invented target.
- Reuse the forward frontend's canonical module paths, StableIds, project loader, and export resolution.
- Read the complete TypeScript source closure, including imported helper modules.
- Preserve UTF-16 source offsets, one-based diagnostic positions, and SHA-256 hashes of the analyzed text.
- Record complete neutral terms or nonempty findings. Unsupported options retain their independent causes.
- Resolve native Effect declarations, export aliases, class-static schemas, const initializers, middleware brands, wrapper headers, and handler registrations statically.
- Record immutable private const identities and unary exported-callee use sites without inventing an export or a partial term.
- Discover annotation definitions through the runtime's nominal static brand. Resolve their literal names and declared Context keys without running definition plans, callbacks, or defaults.
- Canonicalize a nominal `Definition.effect.key` reference to the real exported key used by its definition.
- Carry the required `EffectModel.project` from the same project-loader pass. Do not reconstruct compiler settings or analyze a second Program.
- Preserve each source import or re-export's exact specifier, actual resolved module, value-or-type kind, range, and declaration-origin bindings. Record unresolved and dynamic edges explicitly.
- Record the exact UTF-16 end position of the hashed file and the source import insertion point for cross-file refactors.

The layer provides the compiler-owned `LiftFrontend` service. It requires caller-owned `FileSystem`, `Path`, and `Crypto` services.
Its methods require no additional services. Construction performs no I/O. Analysis writes no files and runs no application modules.
Compiler API invariant failures and I/O failures remain `CompilerFault`. Interruption propagates without a fallback model.

Binding reports remain `UNVERIFIED`. Inline handler ranges are evidence for manual adaptation, not authorization or handler-behavior proof.
The frontend does not guess application authorization functions from their names.
