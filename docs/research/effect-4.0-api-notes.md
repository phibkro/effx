# Effect 4.0.0 API notes

Snapshot: installed `effect@4.0.0`, `@effect/platform-bun@4.0.0`, and `@effect/vitest@4.0.0`. Signatures are copied from installed primary source; source paths and line numbers follow each group.

## Import paths

| API | Import path |
|---|---|
| Schema, SchemaAST, Graph, Trie, HashMap, Arbitrary, Hash, Crypto, FileSystem, Path | `effect/<module>` (also available as namespaces from `effect`) |
| HTTP API | `effect/http-api` |
| RPC | `effect/rpc` |
| CLI | `effect/cli` |
| Bun modules | `@effect/platform-bun/BunServices`, `@effect/platform-bun/BunRuntime`, `@effect/platform-bun/BunHttpServer` |
| Effect Vitest helpers | `@effect/vitest` |

`effect/package.json:32-60` exposes `./*` as subpaths; `http-api`, `rpc`, and `cli` are also explicit exports. Their barrels export the listed namespaces: `effect/src/http-api/index.ts:12-42`, `effect/src/rpc/index.ts:12-60`, `effect/src/cli/index.ts:12-48`. `@effect/platform-bun/package.json:29-35` exposes subpaths; its root barrel exports `BunHttpServer`, `BunRuntime`, and `BunServices` (`src/index.ts:45-76`).

## Schema

Import: `effect/Schema` (`import { Schema } from "effect"` in ai-docs). Source: `node_modules/effect/src/Schema.ts`.

| Export | Signature | Lines |
|---|---|---|
| `String` | `export const String: String = make(SchemaAST.string)` | 2990 |
| `Struct` | `export function Struct<const Fields extends Struct.Fields>(fields: Fields): Struct<Fields> {` | 3454 |
| `Class` | `<Self = never, Brand = {}>(identifier: string): {`<br>`<S extends Struct<Struct.Fields>>(schema: S, annotations?: Annotations.Declaration<Self, readonly [S]>): [Self] extends [never] ? MissingSelfGeneric<"Schema.Class"> : Class<Self, S, Brand>` | 15043, 15186 |
| `TaggedError` | `<Self = never, Brand = {}>(identifier?: string): {`<br>`<Tag extends string, const Fields extends Struct.Fields>(tag: Tag, fields: Fields, annotations?: Annotations.Declaration<Self, readonly [TaggedStruct<Tag, Fields>]>)`<br>`: [Self] extends [never] ? MissingSelfGeneric<"Schema.TaggedError"> : Class<Self, TaggedStruct<Tag, Fields>, Cause_.YieldableError & Brand>` | 15547, 15577-15582 |
| `Union` | `export function Union<const Members extends ReadonlyArray<Constraint>>(members: Members, options?: SchemaAST.UnionOptions): Union<Members> {` | 4808-4811 |
| `Literals` | `export function Literals<const L extends ReadonlyArray<SchemaAST.LiteralValue>>(literals: L): Literals<L> {` | 4852 |
| `brand` | `export function brand<B extends string>(identifier: B & EnsureSingleBrandKey<B>) {` | 5118 |
| `Array` | `<S extends Constraint>(self: S): $Array<S>`; exported as `ArraySchema as Array` | 4495, 4522 |
| `Record` | `export function Record<Key extends Record.Key, Value extends Constraint>(key: Key, value: Value): $Record<Key, Value> {` | 3867-3870 |
| `Option` | `export function Option<A extends Constraint>(value: A): Option<A> {` | 13780 |
| `optionalKey` | `export const optionalKey: optionalKeyLambda = Struct_.lambda<optionalKeyLambda>((schema) =>`<br>`  make(SchemaAST.optionalKey(schema.ast), { schema })`<br>`)` | 2317-2319 |
| `decodeUnknownEffect` | `export function decodeUnknownEffect<S extends Constraint>(schema: S, options?: SchemaAST.ParseOptions) {`<br>`  return (`<br>`    input: unknown,`<br>`    options?: SchemaAST.ParseOptions`<br>`  ): Effect.Effect<S["Type"], SchemaError, S["DecodingServices"]> => {` | 1473-1478 |
| `encodeUnknownEffect` | `export function encodeUnknownEffect<S extends Constraint>(schema: S, options?: SchemaAST.ParseOptions) {`<br>`  return (`<br>`    input: unknown,`<br>`    options?: SchemaAST.ParseOptions`<br>`  ): Effect.Effect<S["Encoded"], SchemaError, S["EncodingServices"]> => {` | 1878-1883 |
| `toJsonSchemaDocument` | `export function toJsonSchemaDocument(schema: Constraint, options?: ToJsonSchemaOptions): JsonSchema.Document<"draft-2020-12"> {` | 15894-15897 |
| `toCodecJson` | `export const toCodecJson: {`<br>`  <S extends Constraint>(schema: S): toCodecJson<S>`<br>`} = InternalToCodec.toCodecJson` | 15955, 15980-15981 |

The Schema JSON Schema export is named `toJsonSchemaDocument` in this release; there is no `toJsonSchema` declaration in `Schema.ts`. `toCodecJson` derives a JSON-encoded codec.

AI-docs example: `node_modules/effect/ai-docs/src/01_effect/02_schema/10_schema-basics.ts:7-20,29-37`.

```ts
import { Effect, Schema } from "effect"
export class User extends Schema.Class<User>("path/to/module/User")({
  id: Schema.Int,
  name: Schema.NonEmptyString,
  email: Schema.String,
  role: Schema.Literals(["admin", "member"])
}) {}
export const decodeUser = Schema.decodeUnknownEffect(User)
export const encodeUser = Schema.encodeEffect(User)
```

The branded-string example is `Schema.String.pipe(Schema.brand("GroupId"))` at `node_modules/effect/ai-docs/src/40_sql/10_basics.ts:15`.

## SchemaAST

Import: `effect/SchemaAST`. Source: `node_modules/effect/src/SchemaAST.ts`.

The `AST` node-kind union is verbatim from `SchemaAST.ts:52-74`:

```ts
export type AST =
  | Declaration
  | Null
  | Undefined
  | Void
  | Never
  | Unknown
  | Any
  | String
  | Number
  | Boolean
  | BigInt
  | Symbol
  | Literal
  | UniqueSymbol
  | ObjectKeyword
  | Enum
  | TemplateLiteral
  | Arrays
  | Objects
  | Union
  | Suspend
```

Node discriminants and salient fields: `Literal` / `_tag: "Literal"`, `literal: LiteralValue` (`SchemaAST.ts:1690-1692`); `Arrays` / `_tag: "Arrays"`, `isMutable`, `elements`, `rest` (`2222-2226`); `Objects` / `_tag: "Objects"`, `propertySignatures`, `indexSignatures` (`2731-2734`); `Union` / `_tag: "Union"`, `types`, `options` (`3589-3592`); `Suspend` / `_tag: "Suspend"`, `thunk: () => AST` (`3889-3891`).

Representative node constructors:

```ts
export const Literal: new(
  literal: LiteralValue,
  annotations?: Schema.Annotations.Annotations,
  checks?: Checks,
  encoding?: Encoding,
  context?: Context
) => Literal
```

Source: `SchemaAST.ts:1716-1722`.

```ts
export const Arrays: new(
  isMutable: boolean,
  elements: ReadonlyArray<AST>,
  rest: ReadonlyArray<AST>,
  annotations?: Schema.Annotations.Annotations,
  checks?: Checks,
  encoding?: Encoding,
  context?: Context,
  encodingChecks?: Checks
) => Arrays
```

Source: `SchemaAST.ts:2251-2260`.

```ts
export const Objects: new(
  propertySignatures: ReadonlyArray<PropertySignature>,
  indexSignatures: ReadonlyArray<IndexSignature>,
  annotations?: Schema.Annotations.Annotations,
  checks?: Checks,
  encoding?: Encoding,
  context?: Context,
  encodingChecks?: Checks
) => Objects
```

Source: `SchemaAST.ts:2759-2767`.

```ts
export const Union: new<A extends AST = AST>(
  types: ReadonlyArray<A>,
  options?: UnionOptions,
  annotations?: Schema.Annotations.Annotations,
  checks?: Checks,
  encoding?: Encoding,
  context?: Context,
  encodingChecks?: Checks
) => Union<A>
```

Source: `SchemaAST.ts:3628-3636`. `Suspend` is `new(thunk: () => AST, annotations?: Schema.Annotations.Annotations, checks?: Checks, encoding?: Encoding, context?: Context) => Suspend` (`3909-3915`). No direct SchemaAST example was located in `ai-docs/src`.

## Graph

Import: `effect/Graph`. Source: `node_modules/effect/src/Graph.ts`.

```ts
export const make =
  <T extends Kind>(type: T) => <N, E>(mutate?: (mutable: MutableGraph<N, E, T>) => undefined): Graph<N, E, T> => {

export const directed: <N, E>(
  mutate?: (mutable: MutableDirectedGraph<N, E>) => undefined
) => DirectedGraph<N, E> = make("directed")

export const undirected: <N, E>(
  mutate?: (mutable: MutableUndirectedGraph<N, E>) => undefined
) => UndirectedGraph<N, E> = make("undirected")
```

Source: `Graph.ts:574-575,620-622,656-658`.

```ts
export const addNode = <N, E, T extends Kind = "directed">(
  mutable: MutableGraph<N, E, T>,
  data: N
): NodeIndex => {

export const addEdge = <N, E, T extends Kind = "directed">(
  mutable: MutableGraph<N, E, T>,
  source: NodeIndex,
  target: NodeIndex,
  data: E
): EdgeIndex => {
```

Source: `Graph.ts:3516-3519,4613-4618`.

```ts
export const outgoingEdges: {
  (nodeIndex: NodeIndex): <N, E>(
    graph: Graph<N, E, "directed"> | MutableGraph<N, E, "directed">
  ) => Array<EdgeIndex>
  <N, E>(
    graph: Graph<N, E, "directed"> | MutableGraph<N, E, "directed">,
    nodeIndex: NodeIndex
  ): Array<EdgeIndex>
}
```

Source: `Graph.ts:5269,5281-5283,5295-5298`.

```ts
export const dfs: {
  (config?: SearchConfig): <N, E, T extends Kind = "directed">(
    graph: Graph<N, E, T> | MutableGraph<N, E, T>
  ) => NodeWalker<N>
```

Source: `Graph.ts:11159,11205`.

```ts
export const stronglyConnectedComponents = <N, E>(
  graph: Graph<N, E, "directed"> | MutableGraph<N, E, "directed">
): Array<Array<NodeIndex>> => {

export const isAcyclic = <N, E, T extends Kind = "directed">(
  graph: Graph<N, E, T> | MutableGraph<N, E, T>
): boolean => {
```

Source: `Graph.ts:8563-8565,6899-6901`.

```ts
export const topo: {
  (config?: TopoConfig): <N, E>(graph: Graph<N, E, "directed"> | MutableGraph<N, E, "directed">) => NodeWalker<N>
```

Source: `Graph.ts:11680,11721`. The exact topological export name is `topo`, not `topologicalSort`; cyclic graphs make it throw (`Graph.ts:11697-11699`). Cycle-related operations are `isAcyclic` and `stronglyConnectedComponents`; no cycle-enumeration export was found. Walker values are:

```ts
export const values = <T, N>(walker: Walker<T, N>): Iterable<N> => walker.visit((_, data) => data)
```

Source: `Graph.ts:11055`. No Graph example was found in `ai-docs/src`.

## Trie

Import: `effect/Trie`. Source: `node_modules/effect/src/Trie.ts`.

```ts
export const empty: <V = never>() => Trie<V> = TR.empty
export const fromIterable: <V>(entries: Iterable<readonly [string, V]>) => Trie<V> = TR.fromIterable
export const make: <Entries extends Array<readonly [string, any]>>(
  ...entries: Entries
) => Trie<Entries[number] extends readonly [any, infer V] ? V : never> = TR.make
```

Source: `Trie.ts:83,107,126-128`.

```ts
export const insert: {
  <V>(key: string, value: V): (self: Trie<V>) => Trie<V>
  <V>(self: Trie<V>, key: string, value: V): Trie<V>
} = TR.insert

export const get: {
  (key: string): <V>(self: Trie<V>) => Option<V>
  <V>(self: Trie<V>, key: string): Option<V>
} = TR.get
```

Source: `Trie.ts:154,179-180,204-205,712,741-742,770-771`.

```ts
export const keysWithPrefix: {
  (prefix: string): <V>(self: Trie<V>) => IterableIterator<string>
  <V>(self: Trie<V>, prefix: string): IterableIterator<string>
} = TR.keysWithPrefix

export const keys: <V>(self: Trie<V>) => IterableIterator<string> = TR.keys
export const values: <V>(self: Trie<V>) => IterableIterator<V> = TR.values
export const entries: <V>(self: Trie<V>) => IterableIterator<[string, V]> = TR.entries
export const size: <V>(self: Trie<V>) => number = TR.size
```

Source: `Trie.ts:231,257,282,330,353,376,682`. No Trie example was found in `ai-docs/src`.

## HashMap

Import: `effect/HashMap`. Source: `node_modules/effect/src/HashMap.ts`.

```ts
export const empty: <K = never, V = never>() => HashMap<K, V> = internal.empty
export const make: <Entries extends ReadonlyArray<readonly [any, any]>>(
  ...entries: Entries
) => HashMap<
  Entries[number] extends readonly [infer K, any] ? K : never,
  Entries[number] extends readonly [any, infer V] ? V : never
> = internal.make
export const fromIterable: <K, V>(entries: Iterable<readonly [K, V]>) => HashMap<K, V> = internal.fromIterable
```

Source: `HashMap.ts:284,300-305,322`.

```ts
export const get: {
  <K1 extends K, K>(key: K1): <V>(self: HashMap<K, V>) => Option<V>
  <K1 extends K, K, V>(self: HashMap<K, V>, key: K1): Option<V>
} = internal.get

export const set: {
  <K, V>(key: K, value: V): (self: HashMap<K, V>) => HashMap<K, V>
  <K, V>(self: HashMap<K, V>, key: K, value: V): HashMap<K, V>
} = internal.set
```

Source: `HashMap.ts:365,387,409-410,855,875,895-896`.

```ts
export const keys: <K, V>(self: HashMap<K, V>) => IterableIterator<K> = internal.keys
export const values: <K, V>(self: HashMap<K, V>) => IterableIterator<V> = internal.values
export const entries: <K, V>(self: HashMap<K, V>) => IterableIterator<[K, V]> = internal.entries
export const size: <K, V>(self: HashMap<K, V>) => number = internal.size
```

Source: `HashMap.ts:913,930,991,1044`. No HashMap example was found in `ai-docs/src`.

## Arbitrary

Import: `effect/Arbitrary`. Source: `node_modules/effect/src/Arbitrary.ts`.

```ts
export function schema<S extends Schema_.Constraint>(
  schema: S,
  options?: SchemaOptions<S["Type"]>
): Arbitrary<S["Type"]> {

export function Constant<const A>(value: A): Arbitrary<A> {

export const array: <A>(item: Arbitrary<A>, options?: ArrayOptions) => Arbitrary<Array<A>> = Internal.array

export function sampleEffect<A>(
  self: Arbitrary<A>,
  options?: SampleOptions
): Effect.Effect<ReadonlyArray<A>, SampleError> {

export function checkEffect<A, E = never, R = never>(
  self: Arbitrary<A>,
  property: (value: A) => boolean | Effect.Effect<boolean, E, R>,
  options?: CheckOptions
): Effect.Effect<CheckResult<A, E>, never, R> {
```

Source: `Arbitrary.ts:416-420,439-441,490,813-817,847-853`. The module exports `Constant` (capitalized), not `make`; no synchronous `check` export was found. The available Effectful check is `checkEffect`. No direct Arbitrary example was found in `ai-docs/src`.

## Hash

Import: `effect/Hash`. Source: `node_modules/effect/src/Hash.ts`.

```ts
export interface Hash {
  [symbol](): number
}

export const hash: <A>(self: A) => number = <A>(self: A) => {

export const combine: {
  (b: number): (self: number) => number
  (self: number, b: number): number
}

export const number = (n: number) => {
export const string = (str: string) => {
export const structure = <A extends object>(o: A) => structureKeys(o, getAllObjectKeys(o))
export const array = <A>(arr: Iterable<A>): number => {
```

Source: `Hash.ts:65-67,104,243,274,305,395,432,512,556`. `Hash` produces numeric structural hashes; SHA digests are provided by `Crypto`. No Hash example was found in `ai-docs/src`.

## Crypto

Import: `effect/Crypto`. Source: `node_modules/effect/src/Crypto.ts`.

```ts
export type DigestAlgorithm = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512"

randomBytes(size: number): Effect.Effect<Uint8Array, PlatformError.PlatformError>
digest(
  algorithm: DigestAlgorithm,
  data: Uint8Array
): Effect.Effect<Uint8Array, PlatformError.PlatformError>
readonly randomUUIDv4: Effect.Effect<string, PlatformError.PlatformError>
readonly randomUUIDv7: Effect.Effect<string, PlatformError.PlatformError>
```

These are `Crypto` service members (`Crypto.ts:40,78-103,150,155`). The service tag is `export const Crypto: Context.Service<Crypto, Crypto> = Context.Service("effect/Crypto")` (`Crypto.ts:191`). Its constructor is:

```ts
export const make = (
  impl: {
    readonly randomBytes: (size: number) => Uint8Array
    readonly digest: (
      algorithm: DigestAlgorithm,
      data: Uint8Array
    ) => Effect.Effect<Uint8Array, PlatformError.PlatformError>
  }
): Crypto => {
```

Source: `Crypto.ts:230-238`. `SHA-256` is explicitly in the `DigestAlgorithm` union. No Crypto example was found in `ai-docs/src`.

## FileSystem

Import: `effect/FileSystem`. Source: `node_modules/effect/src/FileSystem.ts`; these operations are members of the `FileSystem` service.

```ts
readonly exists: (
  path: string
) => Effect.Effect<boolean, PlatformError>
readonly makeDirectory: (
  path: string,
  options?: {
    readonly recursive?: boolean | undefined
    readonly mode?: number | undefined
  }
) => Effect.Effect<void, PlatformError>
readonly readFile: (
  path: string
) => Effect.Effect<Uint8Array, PlatformError>
readonly readFileString: (
  path: string,
  encoding?: string
) => Effect.Effect<string, PlatformError>
readonly remove: (
  path: string,
  options?: {
    readonly recursive?: boolean | undefined
    readonly force?: boolean | undefined
  }
) => Effect.Effect<void, PlatformError>
readonly writeFileString: (
  path: string,
  data: string,
  options?: {
    readonly flag?: OpenFlag | undefined
    readonly mode?: number | undefined
  }
) => Effect.Effect<void, PlatformError>
```

Source: `FileSystem.ts:143-145,157-163,246-255,271-283,376-383`. The tag is `export const FileSystem: Context.Service<FileSystem, FileSystem> = Context.Service("effect/FileSystem")` (`FileSystem.ts:470`). No direct core FileSystem example was found in `ai-docs/src`.

## Path

Import: `effect/Path`. Source: `node_modules/effect/src/Path.ts`.

```ts
export interface Path {
  readonly [TypeId]: typeof TypeId
  readonly sep: string
  readonly basename: (path: string, suffix?: string) => string
  readonly dirname: (path: string) => string
  readonly extname: (path: string) => string
  readonly format: (pathObject: Partial<Path.Parsed>) => string
  readonly fromFileUrl: (url: URL) => Effect.Effect<string, BadArgument>
  readonly isAbsolute: (path: string) => boolean
  readonly join: (...paths: ReadonlyArray<string>) => string
  readonly normalize: (path: string) => string
  readonly parse: (path: string) => Path.Parsed
  readonly relative: (from: string, to: string) => string
  readonly resolve: (...pathSegments: ReadonlyArray<string>) => string
  readonly toFileUrl: (path: string) => Effect.Effect<URL, BadArgument>
  readonly toNamespacedPath: (path: string) => string
}

export const Path: Context.Service<Path, Path> = Context.Service("effect/Path")
```

Source: `Path.ts:84-100,255`. No direct core Path example was found in `ai-docs/src`.

## HTTP API

Import: `effect/http-api`; barrel source: `node_modules/effect/src/http-api/index.ts`.

```ts
export const make = <const Id extends string>(identifier: Id): HttpApi<Id, never> =>
```

`HttpApi.make`; source: `http-api/HttpApi.ts:235`.

```ts
export const make = <const Id extends string, const TopLevel extends boolean = false>(identifier: Id, options?: {
  readonly topLevel?: TopLevel | undefined
}): HttpApiGroup<Id, never, TopLevel> =>
```

`HttpApiGroup.make`; source: `http-api/HttpApiGroup.ts:415-418`.

```ts
export const get = make("GET")
export const post = make("POST")
```

`HttpApiEndpoint` constructors; source: `http-api/HttpApiEndpoint.ts:1465,1483`. The shared `make` endpoint type is at `HttpApiEndpoint.ts:1048-1080`.

```ts
export const layer = <Id extends string, Groups extends HttpApiGroup.Constraint>(
  api: HttpApi.HttpApi<Id, Groups>,
  options?: {
    readonly openapiPath?: `/${string}` | undefined
  }
): Layer.Layer<
  never,
  never,
  | Etag.Generator
  | HttpRouter.HttpRouter
  | FileSystem
  | HttpPlatform
  | Path
  | HttpApiGroup.ToService<Id, Groups>
> =>
```

`HttpApiBuilder.layer`; source: `http-api/HttpApiBuilder.ts:66-80`.

```ts
export const group = <
  ApiId extends string,
  Groups extends HttpApiGroup.Constraint,
  const Identifier extends HttpApiGroup.Identifier<Groups>,
  Return
>(
  api: HttpApi.HttpApi<ApiId, Groups>,
  groupIdentifier: Identifier,
  build: (
    handlers: Handlers.FromGroup<HttpApiGroup.WithIdentifier<Groups, Identifier>>
  ) => Handlers.ValidateReturn<Return>
): Layer.Layer<
  HttpApiGroup.Service<ApiId, Identifier>,
  Handlers.Error<Return>,
  Exclude<Handlers.Context<Return>, Scope.Scope>
> =>
```

`HttpApiBuilder.group`; source: `http-api/HttpApiBuilder.ts:130-145`.

```ts
export const make = <ApiId extends string, Groups extends HttpApiGroup.Constraint>(
  api: HttpApi.HttpApi<ApiId, Groups>,
  options?: {
    readonly transformClient?: ((client: HttpClient.HttpClient) => HttpClient.HttpClient) | undefined
    readonly transformResponse?:
      | ((effect: Effect.Effect<unknown, unknown, unknown>) => Effect.Effect<unknown, unknown, unknown>)
      | undefined
    readonly baseUrl?: URL | string | undefined
  }
): Effect.Effect<
  Client<Groups>,
  never,
  HttpClient.HttpClient | HttpApiGroup.MiddlewareClient<Groups>
> =>
```

`HttpApiClient.make`; source: `http-api/HttpApiClient.ts:515-528`.

AI-docs example: `node_modules/effect/ai-docs/src/51_http-server/fixtures/api/Api.ts:1-14`.

```ts
import { HttpApi, OpenApi } from "effect/http-api"
import { SystemApi } from "./System.ts"
import { UsersApiGroup } from "./Users.ts"

export class Api extends HttpApi.make("user-api")
  .add(UsersApiGroup)
  .add(SystemApi)
  .annotateMerge(OpenApi.annotations({
    title: "Acme User API"
  }))
{}
```

## RPC

Import: `effect/rpc`; barrel source: `node_modules/effect/src/rpc/index.ts`.

```ts
export const make = <
  const Tag extends string,
  Payload extends Schema.Top | Schema.Struct.Fields = Schema.Void,
  Success extends Schema.Top = Schema.Void,
  Error extends Schema.Top = Schema.Never,
  const Stream extends boolean = false
>(tag: Tag, options?: {
  readonly payload?: Payload
  readonly success?: Success
  readonly error?: Error
  readonly defect?: DefectSchema
  readonly stream?: Stream
  readonly primaryKey?: [Payload] extends [Schema.Struct.Fields] ? ((
      payload: Payload extends Schema.Struct.Fields ? Struct.Simplify<Schema.Struct<Payload>["Type"]> : Payload["Type"]
    ) => string) :
    never
}): Rpc<
  Tag,
  Payload extends Schema.Struct.Fields ? Schema.Struct<Payload> : Payload,
  Stream extends true ? RpcSchema.Stream<Success, Error> : Success,
  Stream extends true ? typeof Schema.Never : Error
> => {
```

`Rpc.make`; source: `rpc/Rpc.ts:941-962`.

```ts
export const make = <const Rpcs extends ReadonlyArray<Rpc.Any>>(
  ...rpcs: Rpcs
): RpcGroup<Rpcs[number]> =>
```

`RpcGroup.make`; source: `rpc/RpcGroup.ts:411-414`.

```ts
export const layer = <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options?: {
    readonly disableTracing?: boolean | undefined
    readonly spanPrefix?: string | undefined
    readonly spanAttributes?: Record<string, unknown> | undefined
    readonly concurrency?: number | "unbounded" | undefined
    readonly disableFatalDefects?: boolean | undefined
  }
): Layer.Layer<
  never,
  never,
  | Protocol
  | Rpc.ToHandler<Rpcs>
  | Rpc.Middleware<Rpcs>
  | Rpc.ServicesServer<Rpcs>
> =>
```

`RpcServer.layer`; source: `rpc/RpcServer.ts:842-858`.

```ts
export const make: <Rpcs extends Rpc.Any, const Flatten extends boolean = false>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options?: {
    readonly spanPrefix?: string | undefined
    readonly spanAttributes?: Record<string, unknown> | undefined
    readonly generateRequestId?: (() => RequestId) | undefined
    readonly disableTracing?: boolean | undefined
    readonly flatten?: Flatten | undefined
  } | undefined
) => Effect.Effect<
  Flatten extends true ? RpcClient.Flat<Rpcs, RpcClientError> : RpcClient<Rpcs, RpcClientError>,
  never,
  Protocol | Rpc.MiddlewareClient<Rpcs> | Scope.Scope
>
```

`RpcClient.make`; source: `rpc/RpcClient.ts:639-651`. `RpcServer.layerHttp` is also exported for HTTP/WebSocket servers (`rpc/RpcServer.ts:872-875`). No RPC example was found in `ai-docs/src`.

## CLI

Import: `effect/cli`; barrel source: `node_modules/effect/src/cli/index.ts`.

```ts
export const make: {
  <Name extends string, const Config extends Command.Config, R, E>(
    name: Name,
    config: Config,
    handler: (config: Command.Config.Infer<Config>) => Effect.Effect<void, E, R>
  ): Command<Name, Command.Config.Infer<Config>, {}, E, Exclude<R, BuiltInSettingContext>>
```

`Command.make`; source: `cli/Command.ts:640,924-929`.

```ts
export const run: {
  <Name extends string, Input, E, R, ContextInput>(
    command: Command<Name, Input, ContextInput, E, R>,
    config: {
      readonly version: string
      readonly renderErrors?: boolean | undefined
    }
  ): Effect.Effect<void, E | CliError.CliError, R | Environment>
}
```

`Command.run`; source: `cli/Command.ts:2835,2968-2975`.

```ts
export const runWith = <const Name extends string, Input, E, R, ContextInput>(
  command: Command<Name, Input, ContextInput, E, R>,
  config: {
    readonly version: string
    readonly renderErrors?: boolean | undefined
  }
): (
  input: ReadonlyArray<string>
) => Effect.Effect<void, Exclude<E, Terminal.QuitError> | CliError.CliError, R | Environment> => {
```

Source: `cli/Command.ts:3052-3060`.

```ts
export const String = (name: string): Flag<string> => Param.String(Param.flagKind, name)
export const Boolean = (name: string): Flag<boolean> => Param.Boolean(Param.flagKind, name)
export const Int = (name: string): Flag<number> => Param.Int(Param.flagKind, name)
```

Source: `cli/Flag.ts:60,80,99`.

```ts
export const withAlias: {
  <A>(alias: string): (self: Flag<A>) => Flag<A>

export const withDefault: {
  <const B>(defaultValue: B | Effect.Effect<B, CliError.CliError, Environment>): <A>(self: Flag<A>) => Flag<A | B>
```

Source: `cli/Flag.ts:480,510,819,844`.

```ts
export const String = (name: string): Argument<string> => Param.String(Param.argumentKind, name)
export const Int = (name: string): Argument<number> => Param.Int(Param.argumentKind, name)

export const withSchema: {
  <A, B>(schema: Schema.ConstraintCodec<B, A, Environment, unknown>): (self: Argument<A>) => Argument<B>
```

Source: `cli/Argument.ts:62,80,1202,1222`. AI-docs example: `node_modules/effect/ai-docs/src/70_cli/10_basics.ts:7-17,152-162`.

```ts
import { Argument, Command, Flag } from "effect/cli"
const workspace = Flag.String("workspace").pipe(
  Flag.withAlias("w"),
  Flag.withDescription("Workspace to operate on"),
  Flag.withDefault("personal")
)
```

The same file runs the composed command through `Command.run` at lines 152-161.

## @effect/platform-bun

Imports: `@effect/platform-bun/BunServices`, `@effect/platform-bun/BunRuntime`, `@effect/platform-bun/BunHttpServer`. Source: `node_modules/@effect/platform-bun/src`.

```ts
export type BunServices = ChildProcessSpawner | Crypto | FileSystem | Path | Terminal | Stdio
export const layer: Layer.Layer<BunServices> = BunChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(
    BunFileSystem.layer,
    BunCrypto.layer,
    BunPath.layer,
    BunStdio.layer,
    BunTerminal.layer
  ))
)
```

Source: `BunServices.ts:32,41-49`.

```ts
export const layer: Layer.Layer<Crypto.Crypto> = NodeCrypto.layer
```

`BunCrypto.layer`; source: `BunCrypto.ts:24`.

```ts
export const runMain: {
  (
    options?: {
      readonly disableErrorReporting?: boolean | undefined
      readonly teardown?: Teardown | undefined
    }
  ): <E, A>(effect: Effect<A, E>) => void
  <E, A>(
    effect: Effect<A, E>,
    options?: {
      readonly disableErrorReporting?: boolean | undefined
      readonly teardown?: Teardown | undefined
    }
  ): void
} = NodeRuntime.runMain
```

`BunRuntime.runMain`; source: `BunRuntime.ts:38,63-68,93-100`.

```ts
export const layerServer: <R extends string>(
  options: ServeOptions<R> & {
    readonly disablePreemptiveShutdown?: boolean | undefined
    readonly gracefulShutdownTimeout?: Duration.Input | undefined
    readonly websocket?: WebSocketOptions | undefined
  }
) => Layer.Layer<Server.HttpServer, Error.ServeError> = flow(make, Layer.effect(Server.HttpServer)) as any
```

`BunHttpServer.layerServer`; source: `BunHttpServer.ts:300-306`.

```ts
export const layerTest: Layer.Layer<
  Server.HttpServer | HttpPlatform | FileSystem.FileSystem | Etag.Generator | Path.Path | HttpClient
> = Server.layerTestClient.pipe(
```

`BunHttpServer.layerTest`; source: `BunHttpServer.ts:350-352`.

AI-docs example: `node_modules/effect/ai-docs/src/01_effect/06_running/10_run-main.ts:6-8,20-30`.

```ts
const program = Layer.launch(Worker)
BunRuntime.runMain(program, { disableErrorReporting: true })
```

## @effect/vitest

Import: `@effect/vitest`. Source: `node_modules/@effect/vitest/src/index.ts`.

```ts
export * from "vitest"
export const effect: Vitest.Tester<Scope.Scope> = internal.effect
export const layer: <R, E>(
  layer_: Layer.Layer<R, E>,
  options?: {
    readonly concurrent?: boolean
    readonly memoMap?: Layer.MemoMap
    readonly timeout?: Duration.Input
    readonly excludeTestServices?: boolean
  }
) => {
  (f: (it: Vitest.MethodsNonLive<R>) => void): void
  (name: string, f: (it: Vitest.MethodsNonLive<R>) => void): void
} = internal.layer
export const prop: Vitest.Methods["prop"] = internal.prop
export const it: Vitest.Methods = internal.it
```

Source: `@effect/vitest/src/index.ts:19,198,249-260,273,282`. `it.effect` is `readonly effect: Vitest.Tester<Scope.Scope, ExtraContext>` (`index.ts:120-121`); `it.layer` is the group combinator on `Vitest.Methods` (`index.ts:173-185`). `expect` is re-exported unchanged from Vitest by `export * from "vitest"`; it is not an Effect-specific wrapper.

AI-docs example: `node_modules/effect/ai-docs/src/09_testing/10_effect-tests.ts:6-17`.

```ts
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
describe("@effect/vitest basics", () => {
  it.effect("runs Effect code with assert helpers", () =>
    Effect.gen(function*() {
      const upper = ["ada", "lin"].map((name) => name.toUpperCase())
      assert.deepStrictEqual(upper, ["ADA", "LIN"])
    }))
})
```

The same ai-docs file shows `it.effect.prop` with `Schema.String` arbitraries at `09_testing/10_effect-tests.ts:48-54`.
