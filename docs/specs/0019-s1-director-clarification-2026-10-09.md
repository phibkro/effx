# Spec 0019 S1 — Director clarification (2026-10-09)

Status: approved implementation clarification for the existing frozen specs 0019 and 0020. This additive note does not replace any frozen law or change IR semantics.

## Definition-owned lift boundary

`Annotation.implement(definition, { lift })` is the S1 compiler hook. `DefinitionLift<D>` receives a synchronous, pure `LiftSite<D>` whose `plan` is exactly `definition.plan` and whose `schema` is the single codec derived from that plan and cached once per selected registry. The hook's typed success is `ReadArgs<D>`; a schema-defined `LiftRecognitionError` reports a non-match. Runtime `Definition` remains data-only: no callback, TypeScript object, application value, source evaluation, or IR function is admitted. The nominal definition type-id, where needed for frontend fact discovery, carries only `{ name, target }` data.

The static `EffectModel` gains the required, additive `DefinitionRecord` source fact `{ ref: SymbolRef, name: string, key?: { ref: SymbolRef, id: string } }`. The frontend supplies actual declaring-export identity, a literal definition name and, when source semantics establish it, the declaring Context key's canonical exported symbol and literal key id. No guessed key identity, name-derived symbol, private export, or evaluated application value is accepted. Existing local-const and local-call facts remain their own source facts and do not duplicate or alias DefinitionRecord identity.

The selected registry is REQUIRED at `lift(model, input, registry)`. `liftRegistryOf(extensions)` aggregates selected definition-owned rule DATA and hooks in extension/implementation order and derives each definition codec once per registry. It does not create a second definition registry or collision policy: duplicate names, invalid definitions and effect-key collisions continue through `definitionDiagnostics(extensions)`.

Definition-owned `rules` remain inert, Schema-defined DATA consumed by the existing readers. The recognizer is separate compiler code, runs only for the resolved registered definition key, and owns the inverse when present. A rejected, malformed, throwing or invalid hook never falls back to the core default walker after that selected hook has run. The default path reuses the definition's one existing plan/codec; it is not a second plan and does not create a second parser convention.

## Diagnostic separation

- A malformed/unreadable source construct and a resolved but unregistered key keep the existing EFFX3001 entry and the same `UnknownAnnotationKey`/malformed-source variants.
- EFFX3011 is the new source-ranged, blocking recognition-site diagnostic for a selected definition's recognizer, the default codec validation, and produced-reference resolution. Its reasons are a closed Schema literal set. Hook failures may carry the hook's own Schema-defined `construct`; codec failures may carry Schema issue text; a callback throw carries only `hook-threw`. A thrown value, raw message, cause, source payload, or secret is never copied into diagnostic data.
- EFFX3012 is the new source-ranged, blocking diagnostic for a key-shaped expression whose actual source cannot statically resolve the registered effect key identity, including source/runtime key-id disagreement. It does not overload EFFX1304 (the registered two-definition collision) or EFFX3103 (the check-only overlay/root/projection failure).
- EFFX3103 remains a check diagnostic. No annotation-recognition callback exception is reported as a check failure.

Every failure for an endpoint remains an ordinary diagnostic cause ordered by source file, start offset and diagnostic code. Any cause makes the endpoint unsupported atomically: no annotation, refactor, reserved name, code plan, or partial suggestion leaks from the failed endpoint. Duplicate `cardinality: "one"` sites retain EFFX2402.

## Unchanged decisions and laws

This clarification preserves 0019 §0.7's explicit-200 status witness and §0.8's complete untouched original root with a fresh isolated-group comparison root. It does not alter S5 generation, IR shape/version, canonical normalization/hash, any generator, or any L1–L5 law. In particular, the end-to-end RateLimit consumer must compile the existing `.effx` source, lift the actual generated `http.ts` with the real TypeScript Program and selected registry, retain the identical definition `SymbolRef` and decoded arguments, compile to canonical IR equality and identical generated HTTP bytes, and recollect the printed `.with(Definition(args))` suggestion through the real frontend.
