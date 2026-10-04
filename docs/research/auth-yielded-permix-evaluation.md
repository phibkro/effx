# Yielded Auth and Permix as replacements for mono-web's Better Auth and capability system

Research only, observed 2026-10-04. Nothing was migrated. Mono-web is read at the clean integration revision `8152c389f1176ede38b70417bab1332b0a311c21 (unpublished)`; its paths are written `mw/<repo-relative>`. A tag `[INFERENCE]` marks a claim that was not observed in a primary source or a run.

## 0. Pinned sources

| Key | Source                                                                         | Pin                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| YA  | github.com/yielded-dev/auth (docs at yielded.dev/auth)                         | commit `fbdb77731022093ba4fceb138431d9ab2722d4c9` (2026-10-03, "version packages (beta)"); `packages/auth/package.json` = `@yielded/auth@0.1.0-beta.16`. npm: `beta` tag `0.1.0-beta.16` (published 2026-10-04T02:51Z), `latest` tag still `0.1.0-beta.1`; first publish 2026-09-11. |
| PX  | github.com/letstri/permix (npm `repository` field; docs at permix.letstri.dev) | commit `187ff24e41c87fada2e03e8aa0697b3b50e2ddba` (2026-10-02, "release v4.4.0"); npm `permix@4.4.0` (`latest`, 2026-10-02).                                                                                                                                                             |
| MW  | mono-web baseline                                                              | `8152c389 (unpublished)`, `better-auth@1.7.1` and `@better-auth/oauth-provider@1.7.1` (`mw/packages/database/package.json:67-76`); Effect `4.0.0-rc.116` (`mw/package.json:43`).                                                                                                                      |

This updates the earlier Yielded note in [effect-fullstack-composition](effect-fullstack-composition.md) (pinned at `68a4679` / `beta.14`).

## 1. What each one is

| Property             | Yielded Auth                                                                                                                                                                                                                                                                                                                                                                                                                    | Permix                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scope                | **Authentication only**: passwords, passkeys, email/SMS codes, magic links, TOTP, OAuth sign-in to upstream providers, sessions, and an OAuth authorization server for MCP clients. "Your app owns account creation and authorization" (YA `docs/src/content/docs/index.mdx:51`; `guide/oauth.mdx:10`).                                                                                                                       | **Authorization only**: a typed tree of `resource.action` names whose leaves are `boolean` or a synchronous `(data) => boolean` (PX `permix/src/core/rules.ts:4-17`). Adapters for 17 frameworks plus UI hydration (PX `permix/package.json` `exports`).                                                                                                                         |
| Effect v4            | **Native.** Core depends only on Effect plus `@noble/*`; public async operations return `Effect`/`Stream`, typed errors stay in `E` (YA `AGENTS.md`, "Non-negotiable architecture rules" 1-2). Contracts are `HttpApi` groups and `HttpApiMiddleware` services. Peer `effect: ^4.0.0-rc.112` (npm metadata); workspace catalog pins `effect` `4.0.0` (YA `package.json:74`).                                                | **Thin wrapper over a synchronous, mutable core.** `permix/effect` puts one `Permix` instance in a `Context.Service` built by `Layer.sync` (PX `src/effect/permix.ts:38-42`); `check` is `Effect.try` around the boolean core and casts any thrown value to `PermixNotReadyError \| PermixRuleNotDefinedError` (`:57-63`). Peer `effect: >=3`; separate `permix/effect/v3`. |
| Runtime targets      | Workers/Bun/Node/browser/React Native; persistence adapters for D1, libSQL, MySQL2, PGlite, Postgres, SQLite (Bun/DO/Node/WASM) (YA `packages/auth-persistence-drizzle/src/*.ts`; npm peers).                                                                                                                                                                                                                                  | Anywhere JS runs; no I/O in core.                                                                                                                                                                                                                                                                                                                                              |
| Storage model        | Ports per storage role (`Context.Service` with workflow-step methods, no generic CRUD); rungs `managed` / `map` (your tables, startup column check) / `custom`. Standalone operations "reject unrelated ambient transactions" (YA `reference/adapters.md:146-150`).                                                                                                                                                             | None. Rules live in process memory (`let rules` in PX `src/core/permix.ts:324`); `dehydrate` serializes them to JSON booleans for clients (`src/core/rules.ts:38-53`). The Drizzle adapter only derives a `Definition` from a Drizzle schema (`src/drizzle/permix.ts:104-127`).                                                                                               |
| License              | MIT (YA `LICENSE`)                                                                                                                                                                                                                                                                                                                                                                                                              | MIT (PX `LICENSE`)                                                                                                                                                                                                                                                                                                                                                             |
| Maturity             | Repo created 2026-09-10; 16 betas in 23 days (npm `time`); 80 of 99 commits by one author, npm maintainer `danieljvdm` only; 164 stars; 9,984 downloads 2026-09-25..10-01 (npm downloads API). `SECURITY.md`: prerelease, only the latest beta supported. `AGENTS.md:153`: "pre-production … remove superseded aliases or migration shims". 0 published security advisories; 1 open issue. | Repo created 2025-01-14; v4.0.0 2026-06-03 to v4.4.0 2026-10-02, roughly monthly minors (npm `time`); 464 of 492 commits by one author, npm maintainer `letstri` only; 636 stars; 37,071 downloads in the same week. 0 published advisories; 3 open issues (feature requests, including "Add better-auth integration"). No `SECURITY.md`.                               |
| Test and CI posture  | 22 `*.test.ts` files across packages/examples; CI runs format, `vp run check`, all package Vitest suites, a managed-persistence consumer, build and docs (YA `.github/workflows/ci.yml:121-233`). No model checking found.                                                                                                                                                                                                      | 30 test files under `permix/src`; CI runs lint, format and type checks only (PX `.github/workflows/{lint-check,types-check}.yml`); tests run in `prepublishOnly` (PX `permix/package.json:133`). No model checking.                                                                                                                                                           |

## 2. Requirement matrix

Legend: **N** covered natively · **A** covered with app code · **–** not covered · **X** conflicts. Mono-web anchors come first.

| Requirement (mono-web anchor)                                                                                                                                                                                                                                                                       | Yielded Auth                                                                                                                                                                                                                                                                                                                                                                              | Permix                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Credential algebra**: Person = cookie XOR delegated bearer; two credentials fail before either resolves (`mw/apps/backend/src/authority.ts:80-125`; test `mw/apps/backend/src/router.test.ts:697`)                                                                                             | **A.** Session middleware and `OAuthServer.middleware(scopes)` are separate (YA `reference/oauth.md:57-61`); nothing found that rejects a request carrying both. Mono-web's `headerCredentialCount` is already app code and would be kept, retargeted to Yielded's cookie name.                                                                                                           | **–** (authentication is out of scope).                                                                                                                                                        |
| **OAuth delegated bearer**: mono-web is an OAuth _provider_ with `authorization_code`, `client_credentials`, `refresh_token`; resource `urn:vektorprogrammet:native-api`; ES256 JWT/JWKS; 10 min user / 5 min M2M access, 7-day refresh, reuse window 0 (`mw/packages/database/src/oauth-config.ts:87-143`) | **X.** `OAuthServer` supports only `authorization_code` with S256 PKCE for **registered public clients**, plus `refresh_token` (YA `packages/auth/src/oauth/server/server.ts:597-598`, `models.ts:45`; `reference/oauth.md:10-14`). No `client_credentials`, so no `OAuthServiceBearer`. `resource` must be an exact URL on the origin with a non-root path (`:21`), not a URN. Tokens are Yielded signed envelopes, not JWT (`:67-71`). Lifetimes are stated as fixed (10 min access, 30-day grant). It is framed as an MCP authorization server. | **–**                                                                                                                                                                                          |
| **Invitation-only bearer capability** (`ObjectCapability`, `CapabilityHolder`, not-found concealment; header rejects any other credential) (`mw/packages/http-api/src/access.ts:106-127`; `mw/apps/backend/src/http-api/transport.ts:245-264`)                                                  | **A.** No equivalent concept. It is mono-web app code today and would remain so.                                                                                                                                                                                                                                                                                                          | **A.** A rule could be `(invitation) => invitation.digest === presented`, but concealment, credential exclusion and principal kind have no Permix counterpart.                                 |
| **One-use onboarding claim** (transactional `Open → Claimed`, locks, uniqueness triggers) (`mw/packages/database/src/onboarding/postgres.ts:90-131`; migration `0035`)                                                                                                                          | **A.** Single-use proofs exist only for Yielded's own flows. The claim creates a local account inside the claim transaction; Yielded allows registration writes to commit with an application insert on the same SQL client (YA `reference/adapters.md:138-142`), but other standalone operations reject ambient transactions (`:146-150`). Unverified for mono-web's claim shape.      | **–**                                                                                                                                                                                          |
| **Session refresh and revocation**: 7-day expiry, 1-day `updateAge`; revoke current/one/other/all with audit; password reset revokes (`mw/packages/database/src/auth-engine.ts:420-468`; `auth-live.ts:76-110,321-390`)                                                                         | **N.** `Sessions.stateful` with max age, idle timeout and renewal; `List`, `Revoke`, `RevokeAll`, `SignOut` (YA `guide/sessions.mdx:21-46`; `packages/auth/src/sessions/module.ts:1921-2005`). Audit rows remain app code (**A**).                                                                                                                                                         | **–**                                                                                                                                                                                          |
| **SQL-derived reach** (point-in-time memberships, boards, admin; `FOR SHARE`) (`mw/packages/database/src/organization/authority-postgres.ts:373-489`; `mw/packages/domain/src/authz/reach.ts:87-139`)                                                                                           | **–** (out of scope by design).                                                                                                                                                                                                                                                                                                                                                           | **A.** Rules must be built per request from facts the app reads (spike §7 A). Permix contributes only the final boolean lookup.                                                                 |
| **Delegations and revocation** (`mw/packages/domain/src/authz/reach.ts:65-81`; `mw/packages/database/src/authz/delegation-postgres.ts:73-238`)                                                                                                                                                   | **–**                                                                                                                                                                                                                                                                                                                                                                                     | **A.** Same as reach. Revocation is visible only if the instance is rebuilt after the facts are re-read.                                                                                      |
| **Decision time inside the transaction** (`SnapshotRead` / `Transaction`, `mw/packages/domain/src/authz/access.ts:915-967`; SERIALIZABLE at `mw/apps/backend/src/http-api/receipt-transaction.ts:261`)                                                                                         | **A.** `Session.Verify` does not call `checkNoAmbientCommit` (YA `sessions/module.ts:250-255` vs `:1921`), so verification may run inside a caller transaction. Whether its read uses that transaction's connection depends on the adapter sharing the `SqlClient` `[INFERENCE]`. `OAuthServer` persistence "rejects ambient transactions" (`reference/oauth.md:75`). | **A** when used as a pure function in the transaction (spike §7 A). **X** when used as documented: `layer`/`layerSetup` build one shared mutable instance (spike §7 B).                         |
| **Re-authorization on replay**: `prepare` before every receipt lookup (`mw/apps/backend/src/http-api/receipt-transaction.ts:240-245`; test `mw/apps/backend/src/content/http-command-guards.postgres.test.ts:104-113`)                                                                         | **–**                                                                                                                                                                                                                                                                                                                                                                                     | **–** (needs app code; Permix has no transaction or receipt concept).                                                                                                                         |
| **Ordered problem codes** (per-endpoint ordered unions, e.g. `mw/packages/http-api/src/endpoint-problems.ts:20-36`; mapper order `mw/apps/backend/src/http-api/problem.ts:787-819`)                                                                                                             | **A.** Typed tagged errors (`AuthenticationRequired`, `AssuranceRequired`, `HookDenied`, … in `SessionContract` types) must be mapped to `credential.*` problems by app code.                                                                                                                                                                                                              | **X.** `check` yields only `boolean`; a reason (`authority.denied` vs `resource.not-found` vs a requirement failure) cannot be expressed. Throwing rules collapse to `false` in `~any`/`~all` and `dehydrate` (PX `src/core/check.ts:37-43`). |
| **Alloy-checked laws** (`mw/docs/model/authority.als`: 74 `assert`/`check` pairs including mutants, 22 `run` scenarios; not run here)                                                                                                                                                         | **–.** The model's credential laws (exact-one-principal, bearer, single-use claim) describe mono-web code that stays app-owned, so the model stays valid if that code stays.                                                                                                                                                                                                                | **–.** Permix's model (a tree of booleans or closures) has no counterpart in the Alloy model.                                                                                                  |

## 3. Permix specifically

**Can rules depend on current database facts read inside a given transaction?** Only by construction outside Permix. Rules are synchronous (`(data) => boolean`, PX `src/core/rules.ts:4-8`), so a rule cannot itself `yield*` a query. The documented "dynamic rules" path is `layerSetup(effect)`, which runs the effect **once when the Layer is built** (PX `src/effect/permix.ts:44-49`; `docs/content/docs/integrations/effect.mdx:76`). Permix's own ReBAC guide keeps relationship data in an in-memory `Map` with "In a real app this would come from your database" (PX `docs/content/docs/guide/rebac.mdx:147`). The only fresh pattern is the one in spike A: read facts in the transaction, build a new core instance with `createPermix(rules)`, call `check`, and discard it.

**Can it run inside an Effect transaction?** Yes, as a pure function. It performs no I/O, so `check` inside `sql.withTransaction` sees exactly the facts the code passed in. Spike A observed `before: true, after: false` across an in-transaction revocation (§7). The documented Effect integration is unsafe for per-request authority. `setup` mutates the single instance in the `Layer.sync` service (PX `src/core/permix.ts:335-343`). Two concurrent requests that each call `setup` then `check` therefore read each other's rules. Spike B observed `alice` denied on her own team after `bob`'s `setup` overwrote the rules. The error channel is also untrue: a rule that throws `TypeError` arrives typed as `PermixNotReadyError | PermixRuleNotDefinedError` (`src/effect/permix.ts:61`; spike C).

**What it adds over mono-web's pure interpreter.** It adds:

- typed dotted path strings (`"content.create-article"`);
- `~any`/`~all` aggregation;
- `dehydrate`/`hydrate` for shipping booleans to a React/Vue/Svelte UI;
- framework middleware for non-Effect servers.

Mono-web already has typed capability and scope registries (`mw/packages/domain/src/authz/access.ts:47-100,250-380`) and a tagged Decision algebra (`mw/packages/domain/src/authz/decision.ts`). Its dashboard is Foldkit, and its specs forbid inferring authority from visible controls (`docs/specs/0014-content-migration.md`). Permix lacks all of these, which the interpreter has:

- credential/principal kinds;
- typed requirements;
- canonical scope resolvers;
- concealment;
- decision time;
- reasons.

Net: Permix would replace at most the final `capability ∈ reach(scope)` lookup, about one line of the 1,620-line `access.ts`, and it would lose information.

## 4. Yielded specifically

### Better Auth features mono-web actually uses

From `mw/packages/database/src/{auth-engine,auth-live,oauth-config,oauth-live}.ts`:

| Mono-web use                                                                                                                                                                                                                     | Yielded replacement                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email/password sign-in, sign-up disabled, minimum 12, custom hash/verify (`auth-engine.ts:420-440`)                                                                                                                             | `Password.make()`; account creation is app-owned. **Yes.**                                                                                                                                                                                                                                                            |
| Password reset (1 h token, revokes sessions) and recovery outbox (`auth-engine.ts:424-440`; migration `0034`)                                                                                                                   | Email code / link recovery strategies (YA `guide/codes.md`); outbox remains app code. **Yes, with app code.**                                                                                                                                                                                                        |
| Local account issuance for onboarding (`mw/packages/database/src/onboarding-account.ts`)                                                                                                                                         | Registration through the persistence port in the caller's SQL client (YA `reference/adapters.md:138-142`). **Probably** `[INFERENCE]`.                                                                                                                                                                               |
| Database sessions, signed `better-auth.session_token` cookie, 7 d / `updateAge` 1 d, httpOnly, SameSite=Lax (`auth-engine.ts:462-490`; `auth-live.ts:246-268`)                                                                 | `Sessions.stateful`; the cookie is named by the app (`makeSessionHttpContract(…, { cookieName })`). **Yes.**                                                                                                                                                                                                       |
| List / revoke current, one, others, all, with audit (`auth-live.ts:76-110,321-390`; `mw/apps/backend/src/http-api/system.ts`)                                                                                                   | `Session.List`, `Revoke`, `RevokeAll` (YA `sessions/module.ts:1921-2005`). "Revoke others" and audit are app code `[INFERENCE]`. **Yes, with app code.**                                                                                                                                                            |
| OAuth provider: auth code, **client_credentials**, refresh, resource URN, consent page in dashboard, client management, hashed secrets/tokens, rate limits, refresh families with replay revocation (`oauth-config.ts:87-128`; migration `0027`) | Auth code + PKCE for public clients, refresh, reuse-revokes-grant, consent page (YA `reference/oauth.md:8-93`). **No** for `client_credentials`/service principals, confidential clients, URN resources, configurable lifetimes and built-in rate limits ("Applications own ingress rate limits", `:89`). |
| JWT plugin: ES256, JWKS, weekly rotation, 15 min grace (`oauth-config.ts:130-140`)                                                                                                                                               | **No.** Opaque signed envelopes verified against storage on every request (`reference/oauth.md:70-71,79`). Any verifier that relies on JWKS breaks.                                                                                                                                                                 |
| Schema generation (12 Better Auth tables in migrations `0015`, `0027`)                                                                                                                                                           | Yielded `managed`/`map` tables plus its migration exports; Drizzle or Effect SQL owns the journal. Mono-web's checksummed SQL registry would need hand-written migrations.                                                                                                                                         |

Social login, organization, admin, magic-link and bearer plugins are **not** used (`mw/packages/database/src/auth-engine.ts:449-456`).

### Data migration from Better Auth

Yielded documents **no Better Auth importer**: a search of the repository for `better-auth`/`betterauth` found nothing. Its contributor rules reject migration shims (YA `AGENTS.md:153`). Each kind of existing data has a different path:

- **Users and accounts.** These belong to the app ("your accounts"). Map `auth."user"` and `auth."account"` rows to Yielded subjects and password credentials with the `map` rung, or copy them with a one-off SQL migration.
- **Password hashes.** Mono-web's native format is `$argon2id$v=19$m=19456,t=2,p=1$<16-byte salt>$<32-byte key>`, unpadded base64 (`mw/packages/database/src/password-codec.ts:8-18,54-55,84-92`). Yielded's PHC parser accepts that shape (YA `packages/auth-crypto/src/internal/password-encoding.ts:21-31,117-118`). Two things block reuse as-is:
  - mono-web hashes **NFKC**-normalized input (`password-codec.ts:91,121,125`), while Yielded normalizes **NFC** or nothing (YA `packages/auth/src/password/policy.ts:5,33`; `methods/verification.ts:149`);
  - `@yielded/auth-crypto` parses only argon2id and `pbkdf2-sha256`, not mono-web's legacy bcrypt `$2y$12$` or Better Auth scrypt-hex hashes (`password-codec.ts:60-66`).

  A custom `PasswordHashing` Layer (three methods: `hash`, `verify`, `dummy`; YA `packages/auth/src/password/PasswordHashing.ts:18-31`) can wrap mono-web's existing codec. Its `needsRehash` result enables lazy upgrade. **App code, small.**

- **Sessions.** Cookie name, token format and credential versioning differ. The only migration found is a forced re-login at cutover `[INFERENCE]`.
- **OAuth clients and grants.** Public clients can be re-registered in `clients`. Confidential and service clients have no target. All refresh families must be revoked so that clients re-authorize. JWKS consumers must change.

### What being Effect-native gains

- One typed `E`/`R` across authentication. Mono-web currently wraps Better Auth's Promise API and re-parses its cookie with HMAC in `auth-live.ts:246-268`.
- `HttpApi`-group contracts and an `HttpApiMiddleware` security marker. The spike confirmed they join an effx-style group (§7 D, E).
- `Scope`-owned resources, interruption that propagates, Schema-defined wire and persisted values.
- Ports that can share mono-web's Effect SQL client.

It does not remove mono-web's authorization or claim code: Yielded leaves authorization to the app by design.

## 5. Cost and risk of a switch

### Files that change (Yielded)

- Better Auth core: `mw/packages/database/src/auth-engine.ts` (531 lines), `auth-live.ts` (939), `oauth-config.ts` (142), `oauth-live.ts` (2,433), `identity-cohort.ts`, `onboarding-account.ts`, `password-codec.ts`, and their tests.
- Runtime proof/seed programs: `mw/packages/database/runtime/{identity-postgres-proof-main,identity-seed-main,oauth-dashboard-fixture-main,oauth-postgres-tracer-main}.ts`, plus `mw/tools/verification/credential-race.ts`.
- Backend: `mw/apps/backend/src/authority.ts` (507), `session-security.ts`, and the session operations in `http-api/system.ts`.
- Dashboard: OAuth consent/login routes (`mw/apps/dashboard/app/oauth-routes.test.ts` and siblings).
- Migrations: new migrations replacing `0015`/`0027`, and the custom OAuth state tables.
- Credential vocabulary: the name `BetterAuthCookie` appears in `CredentialMechanismSchema` and in every `*.effx.ts` declaration. It is only a registry string (spec 0006), so a rename is mechanical.

83 files under `packages`, `apps` and `tools` mention `better-auth`, tests included.

### Files that change (Permix)

`mw/packages/domain/src/authz/*` (about 3,500 lines; `access.ts` alone has 1,620) plus every `apps/backend/src/**/http-access*.ts`. Most of this logic has no Permix home, so the realistic change is to wrap, not replace.

### Tests and journeys that must re-prove (Yielded)

- Unit and backend tests:
  - `mw/apps/backend/src/router.test.ts` ("accepts exactly one credential per request");
  - `onboarding/claim.http.test.ts`;
  - `authority.schools.test.ts`;
  - `config.oauth.test.ts`;
  - `mw/packages/database/src/{auth-live,oauth-config,oauth-refresh-window,password-recovery,onboarding,password-codec}.test.ts`.
- Browser specs: `auth.spec.ts`, `native-session-journey.spec.ts`, `native-recruitment-session-journey.spec.ts`.
- The `just e2e` suites `identity`, `onboarding`, `owner`, `password-recovery`, `sign-in-pages`.
- **Every** accepted migration journey, because each signs in through real Better Auth: `profile`, `schools`, `social-events`, `content-publication`, `organization`, and `just golden team-application` (see the slice-evidence files in this directory).

### Security regression surface

- Cookie parsing and the cookie XOR bearer rule.
- Legacy password verification: three formats, NFKC, timing, admission limits (`password-codec.ts:35-40`).
- OAuth replay and family revocation.
- Consent CSRF.
- Rate limits, which move from Better Auth config to app ingress.
- Identity and OAuth security audit (migrations `0024`, `0027`).
- Credential resolution inside the `SERIALIZABLE` transaction.

### What is lost

- **Yielded, auth only.** The Alloy model and its laws survive, because the credential algebra, invitation and claim stay app code. They must be re-checked against the changed resolver.
- **Yielded with service principals.** Losing `client_credentials` removes `OAuthServiceBearer` and the `ServicePrincipal` kind. Their Alloy facts would be modelled without an implementation.
- **Permix.** Replacing the interpreter detaches the Alloy laws from the code.
- **EFFX2501-2504** (spec 0006) read `Http.Access.decisionTime` and the security middleware stamp. They are independent of either library and survive both, as long as `Http.Access` stays the declaration.
  - Yielded's `RequireSession` carries the stamp at type level and at runtime (§7 E), so it satisfies EFFX2503.
  - Permix has no decision-time concept, so if it replaced `Http.Access`, EFFX2501/2502 would have nothing to read.

## 6. effx angle: extension packages, no core change

Both mappings fit spec 0020's `Annotation.define`/`implement` with writer slots `endpoint | group | root` (spec 0020 §6). Spec 0020 is frozen but not built (`STATE.md`).

```
@Http.Access({ acceptedCredentials, capabilities, requirements, decisionTime, … })   (core, unchanged)
        │ IR: AccessContract
        ├──▶ @effx-ext/yielded-auth
        │      analysis: credential "YieldedSession" ⇒ Http.Contract.middleware includes the
        │                SymbolRef of SessionHttp.RequireSession (EFFX2503 already checks the stamp)
        │      writer(root slot): .add(AuthContract.httpGroup(AuthApi))   — today an app-owned root does this
        │      guard: unchanged — app's guard yields CurrentSession inside its own transaction
        └──▶ @effx-ext/permix
               writer(new file): permix-definition.ts = { content: ["create-article", …] }
                                 from the IR capability names (writers only add files, §5)
               analysis: none beyond "capability name is in the generated definition" (true by construction)
               cannot map: requirements, canonicalScopeResolver, concealment, decisionTime
```

- **Yielded extension.** It only adds vocabulary and checks. The generated group already accepts any `HttpApiMiddleware`, and spike D shows the join compiles. A core change would only be needed for a "credential name ⇒ required middleware symbol" table. Spec 0006 treats credential names as registry-owned data, so that table belongs in the extension.
- **Permix extension.** It can only emit the `Definition` type. Building rules from transaction facts stays in the app's guard. That is exactly where mono-web's interpreter already runs, so the extension's value is a duplicate capability vocabulary `[INFERENCE]`.
- **Choice.** An app picks one extension in `effx.config` (spec 0015). Neither needs the IR or generators to change.

## 7. Spike (throwaway, deleted)

In a scratch directory outside the repository: `bun add effect@4.0.0 @effect/sql-pglite@4.0.0 @electric-sql/pglite permix@4.4.0 @yielded/auth@0.1.0-beta.16 typescript@5.9.3 @types/bun` (exit 0, Bun 1.3.13, PGlite `0.5.8`). Type checks used `tsc --noEmit --strict --module preserve --moduleResolution bundler --skipLibCheck`.

| #   | Program                                                                                                                                                         | Command / exit                                       | Observation                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Inside `sql.withTransaction` + `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`: read delegations `FOR SHARE`, `createPermix(rules)`, check; end the delegation; re-read; new instance; check | `bun permix-tx.ts` → 0; `tsc` → 0                    | `{"before":true,"after":false}`: per-request instances built from in-transaction facts see revocation.                                                                                                                                         |
| B   | Documented `permix/effect` `layer` + concurrent `setup(rules)`/`check` for two people                                                                         | same run                                             | `alice` checking her own team `t1` → **false**; `bob` → true. The shared mutable instance leaks rules between fibers.                                                                                                                           |
| C   | Rule that dereferences missing data via `permix/effect` `check`                                                                                                | same run                                             | Failure class is `TypeError`, statically typed as `PermixNotReadyError \| PermixRuleNotDefinedError`.                                                                                                                                          |
| D   | `AuthContract.make` + `makeSessionHttpContract`; an `HttpApiGroup` with `.middleware(SessionHttp.RequireSession)`; `HttpApi.make("app").add(Profile, AuthContract.httpGroup(AuthApi))` | `bun yielded-join.ts` → 0 (prints `profile,auth`); `tsc` → 0 | Yielded joins an ordinary `HttpApi` beside an effx-shaped group under Effect `4.0.0`. Not exercised: a running server, a request, or a database.                                                                                               |
| E   | Type-level test: does `typeof RequireSession` have the keys `security` and `~effect/http-api/HttpApiMiddleware/Security` (the keys effx's frontend checks, `packages/frontend-ts/src/lower.ts:597-609`)? Runtime `HttpApiMiddleware.isSecurity` | `bun stamp.ts` → 0; `tsc` → 2 (expected: the assertion was written `false`) | Both keys present at type level; runtime `isSecurity: true`, scheme `session`. A third, unplanned error: `RequireSession` is not assignable to `HttpApiMiddleware.AnyService` as `isSecurity`'s parameter under `effect@4.0.0` types. The effx frontend itself was not run. |

Not spiked: Yielded `OAuthServer` against mono-web's token shapes; Yielded verification inside a mono-web transaction; mono-web's own patched `4.0.0-rc.116`.

## 8. Verdicts

**Permix (`permix@4.4.0`, commit `187ff24`): don't adopt.** It solves a smaller problem than mono-web has. It returns a boolean with no reason, requirement, scope resolver, concealment or decision time (PX `src/core/rules.ts:4-17`). Its documented Effect integration shares mutable rules across requests (PX `src/effect/permix.ts:40-55`; spike B). Used safely (spike A), it shrinks to a lookup the existing interpreter already does, with less typing.

_What would change this:_ a per-request, effectful rule API (rules returning `Effect<Decision, E, R>`, no shared instance) **and** a need for client-side permission hydration in a non-Foldkit UI. Even then, adopt it only for UI hints, never for server decisions.

**Yielded Auth (`@yielded/auth@0.1.0-beta.16`, commit `fbdb777`): don't adopt now; re-evaluate for partial adoption (sessions and passwords only) later.** It is the right shape (Effect-native, `HttpApi` contracts, ports over Effect SQL, app-owned authorization) and covers sessions and passwords with modest app code. But:

- it conflicts with mono-web's OAuth provider (`client_credentials`, URN resource, JWT/JWKS, confidential clients) (YA `packages/auth/src/oauth/server/server.ts:597-598`; `reference/oauth.md:10-21,67-71`);
- it is a 23-day-old, single-maintainer beta whose npm `latest` tag is `0.1.0-beta.1` and whose policy rejects migration shims (YA `SECURITY.md`; `AGENTS.md:153`);
- a switch re-proves every signed-in journey for no new user-facing capability.

_What would change this:_ all of the following.

1. Yielded ships a stable release with a compatibility policy.
2. Its `OAuthServer` supports `client_credentials` and confidential clients, or mono-web retires service bearers.
3. A spike proves `Session.Verify` reads through mono-web's transaction connection.
4. Better Auth develops a concrete blocker (security, Effect-version, maintenance).

Then a partial switch is reasonable: sessions and passwords to Yielded, with a custom `PasswordHashing` wrapping `password-codec.ts`. The OAuth provider would stay on Better Auth until item 2 lands.

### Ranked recommendation

1. **Keep Better Auth (`better-auth@1.7.1`, `@better-auth/oauth-provider@1.7.1`) and the custom capability system** at mono-web `8152c389 (unpublished)`. Continue the effx migration on `Http.Access` + app guards (specs 0006/0019). The Alloy laws and `EFFX2501-2504` stay attached to running code.
2. **Document and test the Yielded join in effx.** Record it as a recipe or an `@effx-ext/yielded-auth` analysis after spec 0020 lands (§6), so new effx apps can choose Yielded without core changes. The evidence is spikes D and E (`@yielded/auth@0.1.0-beta.16` on `effect@4.0.0`).
3. **Re-evaluate Yielded** for mono-web sessions and passwords when the conditions above hold.
4. **Do not build a Permix extension.**

## 9. Claims not verified from a primary source

- That Yielded `Session.Verify` reads through the caller's transaction connection when the adapter shares mono-web's `SqlClient`: inferred from the absence of `checkNoAmbientCommit`, not run.
- That `OAuthServer.middleware(scopes)` is an `HttpApiMiddleware` rather than router middleware: the docs say "`.layer` … to protected routes"; not checked in types.
- That Yielded lifetimes (10 min access, 30-day grant) cannot be configured: stated in the reference, but the option types were not inspected.
- That Yielded registration can join mono-web's onboarding claim transaction, and that "revoke other sessions" and session audit need app code.
- That existing Better Auth sessions cannot be carried over (forced re-login).
- That a Permix extension's value is limited to a duplicate vocabulary.
- That mono-web's Alloy model passes: the model was read but not run.
- Mono-web's per-file inventory was produced by a read-only scout and spot-checked (`authority.ts:80-150`, `router.test.ts:697`, `endpoint-problems.ts:20-36`, `receipt-transaction.ts:240-261`, `oauth-config.ts:87-143`, `password-codec.ts`, line counts); other `mw/` line ranges were not each re-read.
- npm download counts come from the npm downloads API for one week and are a popularity signal only. They count CI installs and are not users.
