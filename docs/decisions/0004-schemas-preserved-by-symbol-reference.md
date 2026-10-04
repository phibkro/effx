# ADR 0004: Schema values are preserved by symbol reference

Status: accepted (2026-10-03)

## Context

`SchemaAST` is a runtime tree with declarations, suspensions, transformations and annotations;
it has no faithful pure-JSON form. Executing application modules at build time introduces
side effects and ordering hazards.

## Decision

IR refers to schemas as `SchemaRef { module, export, symbolId }` and to handlers/services as
`SymbolRef { module, export, member? }`. Generated code imports the original value:

```ts
import { GetUserInput } from "../users/schemas"
Rpc.make("User.Get", { payload: GetUserInput, ... })
```

## Consequences

- Input/success/error schemas must be explicit symbol references in annotations.
- No duplicate handwritten DTOs; Effect performs encoding/decoding at runtime.
- Build-time module execution (schema introspection) is an explicit later feature.
