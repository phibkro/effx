---
"@effx/compiler": minor
"@effx/runtime": patch
---

Add the definition-owned `.annotate` lift hook and the required `lift(model, input, registry)` core API. `Annotation.implement(definition, { lift })` supplies a typed pure recognizer over the definition's own lowering plan and cached codec; the default inverse reuses that plan and codec. Recognizer sites read the required resolved project from `EffectModel.project`; `LiftInput` no longer carries one. The lift model records actual definition/key source facts, supports both generated `.annotate(Definition.effect.key, value)` and canonical Context-key reference forms, and prints collected definitions as `.with(Definition(args))`. Recognition failures stay source-ranged, site-atomic diagnostics (`EFFX3011`/`EFFX3012`); unknown and malformed source keeps `EFFX3001`.

Add the data-only runtime `~effx/Annotation/Definition` type-id brand used by the real TypeScript lift frontend to distinguish definition exports without executing application code. The brand contains only the literal definition name and target; no callback, source value, IR field or generated behavior was added.
