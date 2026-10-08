import type { SchemaRef, SymbolRef } from "@effx/ir";
import type { AccessContractData } from "../extensions/access-contract.ts";
import type { Cause } from "./causes.ts";
import type { CodeReference, Refactor } from "./result.ts";

/*
 * What the recognizers produce. These are internal working types of the pure core: the public contract is
 * `LiftResult`. Fields that may be absent are `| undefined` so a recognizer states every field explicitly.
 */

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** A schema a channel names, with the type-derived facts the IR records about it. */
export interface SchemaUse {
  readonly ref: SchemaRef;
  /** Every static field key (params, operation input). */
  readonly allKeys: ReadonlyArray<string> | undefined;
  /** The required static field keys (headers). */
  readonly requiredKeys: ReadonlyArray<string> | undefined;
  /** Wrapped by `Http.headers`. */
  readonly headers: boolean;
}

export interface MiddlewareUse {
  readonly ref: SymbolRef;
  readonly security: boolean;
}

export interface MetadataUse {
  readonly annotator: SymbolRef | undefined;
  readonly operationId: string | undefined;
  readonly summary: string | undefined;
  readonly description: string | undefined;
  readonly tags: ReadonlyArray<string> | undefined;
}

/** What `Http.Contract.metadata` records for an endpoint: its operation id is always `<group>.<endpoint key>`. */
export interface ContractMetadata {
  readonly annotator: SymbolRef | undefined;
  readonly operationId: string;
  readonly summary: string | undefined;
  readonly description: string | undefined;
  readonly tags: ReadonlyArray<string> | undefined;
}

export interface ProblemsUse {
  readonly registry: SymbolRef;
  readonly identifier: string;
  readonly codes: ReadonlyArray<string>;
}

/** Access exactly as the existing IR schema defines it, validated by that schema. */
export type AccessUse = AccessContractData;

/** An endpoint the core understood completely: everything the `Collected` annotations need. */
export interface Recognized {
  readonly subject: string;
  readonly key: string;
  readonly method: Method;
  readonly path: string;
  readonly params: SchemaUse | undefined;
  readonly query: SchemaUse | undefined;
  readonly headers: SchemaUse | undefined;
  readonly payload: SchemaUse | undefined;
  readonly mediaType: string | undefined;
  readonly success: SchemaUse;
  readonly status: number | undefined;
  readonly responseHeaders: SchemaRef | undefined;
  readonly conditional: boolean;
  readonly middleware: ReadonlyArray<MiddlewareUse>;
  readonly metadata: ContractMetadata;
  readonly problems: ProblemsUse | undefined;
  readonly access: AccessUse | undefined;
}

export interface Outcome {
  /** `<group>.<key>`, as users write it. */
  readonly subject: string;
  /** Present exactly when `causes` is empty. */
  readonly recognized: Recognized | undefined;
  readonly causes: ReadonlyArray<Cause>;
  readonly refactors: ReadonlyArray<Refactor>;
  readonly codeReferences: ReadonlyArray<CodeReference>;
}
