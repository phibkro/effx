---
"@effx/runtime": minor
"@effx/compiler": minor
---

Add backend-owned `Binding.group` source syntax for explicit raw-handler and guard factory references. Handler projections export a context-taking bound factory, the explicit `…ApiHandlersWith` injection seam, and pre-applied raw and endpoint types. A generic handler factory keeps its own type parameters, so the bound factory preserves the application's context requirements instead of erasing them to `unknown`. Bindings are statically collected only for handler emission and remain outside the IR and semantic hash. Registered EFFX2420–2424 diagnostics reject invalid references, duplicate bindings, incompatible guard choices and local effx operation ownership. Unbound factory bytes and native handwritten-endpoint completion stay unchanged.
