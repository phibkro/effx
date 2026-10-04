import { describe, expectTypeOf, it } from "@effect/vitest";
import type { Context, Schema } from "effect";
import type {
  Capability as CapabilityValue,
  FoldkitCommandOptions,
  Focus,
  HttpAccessAnnotationSpec,
  HttpAccessOptions,
  HttpContractOptions,
  HttpGroupOptions,
  HttpOperationAnnotator,
  HttpProblemsOptions,
  OperationOptions,
  PersistentModelOptions,
  ProblemRegistry,
  ExportedFunctionSymbol,
  ServiceLike,
} from "../src/Annotation.js";
import * as Builtins from "../src/builtins.js";

/*
 * The hand-written option interfaces of `Annotation.ts` as of 385c928, before they were derived
 * from the definitions. They are kept here verbatim (renamed `Legacy*`) as the API-equivalence
 * evidence: the derived types must stay mutually assignable with them (spec 0020 §3.1).
 */

interface LegacyOperationOptions {
  readonly name?: string;
  readonly input: Schema.Top;
  readonly success: Schema.Top;
}

interface LegacyFoldkitCommandOptions {
  readonly success: Schema.Top;
  readonly failure: Schema.Top;
}

interface LegacyHttpContractOptions {
  readonly root?: string;
  readonly group?: string;
  readonly params?: Schema.Top;
  readonly query?: Schema.Top | true;
  readonly headers?: Schema.Top;
  readonly payload?: Schema.Top;
  /** POST body carrying read-only query input; the compiler checks verb and operation. */
  readonly payloadIsQuery?: boolean;
  readonly success?: Schema.Top;
  readonly status?: number;
  readonly mediaType?: string;
  readonly responseHeaders?: Schema.Top;
  readonly conditional?: boolean;
  readonly middleware?: ReadonlyArray<ServiceLike>;
  readonly metadata?: {
    readonly annotator?: HttpOperationAnnotator;
    readonly operationId?: string;
    readonly commandIdentity?: ExportedFunctionSymbol;
    readonly summary?: string;
    readonly description?: string;
    readonly tags?: ReadonlyArray<string>;
  };
}

interface LegacyHttpGroupOptions {
  /** A legacy name, or an exported concrete HttpApi value with a literal identifier. */
  readonly root: string | { readonly identifier: string };
  readonly group: string;
  readonly title?: string;
  readonly description?: string;
  readonly displayName?: string;
  readonly defaults?: {
    readonly middleware?: ReadonlyArray<ServiceLike>;
    readonly metadata?: { readonly annotator?: HttpOperationAnnotator };
    readonly problems?: { readonly registry?: ProblemRegistry };
    readonly access?: Partial<
      Pick<
        LegacyHttpAccessOptions,
        "annotator" | "exposure" | "acceptedCredentials" | "principalKinds" | "concealment"
      >
    >;
  };
}

/** Source-only declaration; the application owns evaluation and transaction timing. */
interface LegacyHttpAccessOptions extends Omit<
  HttpAccessAnnotationSpec,
  "exposure" | "acceptedCredentials" | "principalKinds" | "concealment"
> {
  /** Exported function lowered as a SymbolRef, never called by the decorator. */
  readonly annotator?: (spec: HttpAccessAnnotationSpec) => Context.Context<never>;
  readonly exposure?: HttpAccessAnnotationSpec["exposure"];
  readonly acceptedCredentials?: HttpAccessAnnotationSpec["acceptedCredentials"];
  readonly principalKinds?: HttpAccessAnnotationSpec["principalKinds"];
  readonly concealment?: HttpAccessAnnotationSpec["concealment"];
}

interface LegacyHttpProblemsOptions<Code extends string = string> {
  readonly registry?: ProblemRegistry<Code>;
  readonly codes: ReadonlyArray<Code>;
  readonly identifier?: string;
  readonly map?: Readonly<Record<string, string>>;
}

interface LegacyPersistentModelOptions {
  readonly table: string;
  readonly views?: Readonly<Record<string, Schema.Top>>;
  readonly focus?: Readonly<Record<string, Focus | ReadonlyArray<string>>>;
}

type First<D> = D extends (...args: infer P) => object ? P[0] : never;

/** Each derived `Live` type must accept and produce exactly the legacy hand-written option type. */
const same = <A, B>(
  ..._witness: [A] extends [B] ? ([B] extends [A] ? [] : [never]) : [never]
) => {};

/** `A` is assignable to `B`, but not (necessarily) the reverse. */
const narrower = <A, B>(..._witness: [A] extends [B] ? [] : [never]): void => {};

describe("built-in definitions: derived Live types equal the legacy hand-written option types", () => {
  it("Query/Command", () => {
    same<First<typeof Builtins.Query>, LegacyOperationOptions>();
    same<First<typeof Builtins.Command>, LegacyOperationOptions>();
    same<OperationOptions, LegacyOperationOptions>();
  });
  it("Http.Contract", () => {
    same<First<typeof Builtins.HttpContract>, LegacyHttpContractOptions>();
    same<HttpContractOptions, LegacyHttpContractOptions>();
  });
  // T1 (spec 0020 §0.1): `principalKinds` is the closed literal set everywhere, including the group
  // defaults. The derived types are therefore STRICTLY narrower than the legacy ones: every derived
  // value is a legacy value, not the reverse.
  it("Http.Group (tightened)", () => {
    narrower<First<typeof Builtins.HttpGroup>, LegacyHttpGroupOptions>();
    narrower<HttpGroupOptions, LegacyHttpGroupOptions>();
  });
  it("Http.Access (tightened)", () => {
    narrower<First<typeof Builtins.HttpAccess>, LegacyHttpAccessOptions>();
    narrower<HttpAccessOptions, LegacyHttpAccessOptions>();
    expectTypeOf<HttpAccessOptions["principalKinds"]>().toEqualTypeOf<
      | readonly [
          "Anonymous" | "Person" | "ServicePrincipal" | "CapabilityHolder",
          ...Array<"Anonymous" | "Person" | "ServicePrincipal" | "CapabilityHolder">,
        ]
      | undefined
    >();
  });
  it("Http.Problems", () => {
    same<First<typeof Builtins.HttpProblems>, LegacyHttpProblemsOptions<string>>();
    same<HttpProblemsOptions, LegacyHttpProblemsOptions<string>>();
    same<HttpProblemsOptions<"a" | "b">, LegacyHttpProblemsOptions<"a" | "b">>();
  });
  it("Foldkit.Command", () => {
    same<First<typeof Builtins.FoldkitCommand>, LegacyFoldkitCommandOptions>();
    same<FoldkitCommandOptions, LegacyFoldkitCommandOptions>();
  });
  it("PersistentModel (the collector injects schema)", () => {
    same<First<typeof Builtins.PersistentModel>, Omit<LegacyPersistentModelOptions, never>>();
    same<PersistentModelOptions, LegacyPersistentModelOptions>();
  });
  it("Authorize / Requirements", () => {
    same<First<typeof Builtins.Authorize>, CapabilityValue>();
    expectTypeOf<Parameters<typeof Builtins.Requirements>>().toEqualTypeOf<ServiceLike[]>();
  });
});
