import type { SymbolRef } from "@effx/ir";
import {
  Terms,
  type EffectModel,
  type LiftInput,
  type LiftRule,
  type SourceFileRecord,
  type ValueRecord,
} from "@effx/compiler";
import { profileModel, range, schemaOf } from "./lift-support.ts";

/*
 * The mono-web Profile group as the pure core sees it: the `profileModel` of `lift-support.ts` (two
 * endpoints, group, root) completed with what a frontend also records (the problem union's declaration, the
 * source file records, the schemas' static keys) and the data rules of the application's adapters. The
 * second endpoint stays unsupported on purpose: its options object is a spread.
 */

const sym = (module: string, name: string): SymbolRef => ({ module, export: name });

export const PROBLEMS_FILE = "src/endpoint-problems.ts";

export const PROBLEMS_MODULE = "./src/endpoint-problems";

export const codes = ["request.malformed", "precondition.failed", "internal.error"] as const;

const problemUnion = sym("./src/http-semantics", "problemUnion");

/** `export const ProfileReadOwnProfileProblem = problemUnion("ProfileReadOwnProfileProblem", [codes])`. */
export const problemValue: ValueRecord = {
  symbol: sym(PROBLEMS_MODULE, "ProfileReadOwnProfileProblem"),
  range: range(100, 260, PROBLEMS_FILE),
  init: {
    _tag: "Lowered",
    term: Terms.call(Terms.ref(problemUnion), [
      Terms.lit("ProfileReadOwnProfileProblem"),
      Terms.lit([...codes]),
    ]),
    range: range(140, 258, PROBLEMS_FILE),
    spans: [
      { path: [], range: range(140, 258, PROBLEMS_FILE) },
      { path: ["args", 1], range: range(190, 256, PROBLEMS_FILE) },
    ],
  },
};

const problemsFile: SourceFileRecord = {
  file: PROBLEMS_FILE,
  module: PROBLEMS_MODULE,
  idPath: "src/endpoint-problems",
  sha256: "1".repeat(64),
  exports: ["ProfileReadOwnProfileProblem"],
  topLevel: ["ProfileReadOwnProfileProblem"],
  imports: [
    {
      _tag: "Resolved",
      specifier: "./src/http-semantics",
      module: "./src/http-semantics",
      kind: "value",
      range: range(0, 60, PROBLEMS_FILE),
      bindings: [{ local: "problemUnion", ref: problemUnion }],
    },
  ],
  importsEnd: { offset: 60, line: 1, col: 61 },
  end: { offset: 260, line: 3, col: 61 },
};

/** The application modules the rules name; each exports the symbols its rules refer to. */
const moduleOf = (module: string, exports: ReadonlyArray<string>): SourceFileRecord => ({
  file: `${module.replace(/^\.\//u, "")}.ts`,
  module,
  idPath: module.replace(/^\.\//u, ""),
  sha256: "2".repeat(64),
  exports,
  topLevel: exports,
  imports: [],
  importsEnd: { offset: 0, line: 1, col: 1 },
  end: { offset: 0, line: 1, col: 1 },
});

const applicationFiles: ReadonlyArray<SourceFileRecord> = [
  moduleOf("./src/http-semantics", [
    "privateConditionalResponses",
    "endpointProblemResponses",
    "problemUnion",
    "ProfileReadResponseHeaders",
  ]),
  moduleOf("./src/common", [
    "operationAnnotations",
    "nativeOperationAnnotations",
    "PersonSecurity",
  ]),
  moduleOf("./src/access", ["annotateAccessSpec", "personNativeAccess"]),
  moduleOf("./src/profile-effx-adapters", ["profileAccessAnnotations", "ProfileCurrentPerson"]),
  moduleOf("./src/v2-schemas", ["UserProfileResponse"]),
];

const [profileFile] = profileModel.files;

export const profileFullModel: EffectModel = {
  ...profileModel,
  files: [...(profileFile === undefined ? [] : [profileFile]), problemsFile, ...applicationFiles],
  schemas: [
    {
      ref: schemaOf("./src/http-semantics", "ConditionalReadHeaders"),
      allKeys: ["if-none-match"],
      requiredKeys: ["if-none-match"],
    },
  ],
  values: [problemValue],
};

const noStrings: ReadonlyArray<string> = [];

const strings = (name: string) => ({
  name,
  kind: "strings" as const,
  required: false,
  default: noStrings,
});

export const profileRules: ReadonlyArray<LiftRule> = [
  {
    _tag: "SuccessWrapper",
    callee: sym("./src/http-semantics", "privateConditionalResponses"),
    responseHeaders: schemaOf("./src/http-semantics", "ProfileReadResponseHeaders"),
    conditional: true,
  },
  {
    _tag: "ProblemRegistry",
    response: sym("./src/http-semantics", "endpointProblemResponses"),
    union: problemUnion,
    registry: sym("./src/endpoint-problems", "nativeProblems"),
  },
  {
    _tag: "Metadata",
    callee: sym("./src/common", "operationAnnotations"),
    annotator: sym("./src/common", "nativeOperationAnnotations"),
    positional: ["summary", "description"],
  },
  {
    _tag: "Access",
    callee: sym("./src/access", "personNativeAccess"),
    apply: sym("./src/access", "annotateAccessSpec"),
    annotator: sym("./src/profile-effx-adapters", "profileAccessAnnotations"),
    arguments: {
      _tag: "Object",
      fields: [
        { name: "capability", kind: "string", required: true },
        { name: "canonicalScopeResolver", kind: "string", required: true },
        strings("requirements"),
        { name: "decisionTime", kind: "string", required: true },
      ],
    },
    resolver: { _tag: "Arg", name: "canonicalScopeResolver" },
    emit: {
      exposure: { _tag: "Const", value: "External" },
      acceptedCredentials: { _tag: "Const", value: ["BetterAuthCookie", "OAuthUserBearer"] },
      principalKinds: { _tag: "Const", value: ["Person"] },
      capabilities: {
        _tag: "Object",
        fields: [
          { key: "_tag", value: { _tag: "Const", value: "One" } },
          { key: "capability", value: { _tag: "Arg", name: "capability" } },
        ],
      },
      requirements: {
        _tag: "Map",
        arg: "requirements",
        body: { _tag: "Object", fields: [{ key: "id", value: { _tag: "Item" } }] },
      },
      concealment: {
        _tag: "Object",
        fields: [{ key: "_tag", value: { _tag: "Const", value: "Reveal" } }],
      },
      decisionTime: { _tag: "Arg", name: "decisionTime" },
    },
  },
];

export const profileInput: LiftInput = {
  group: "profile",
  rules: profileRules,
  names: {
    "profile.current-person": sym("./src/profile-effx-adapters", "ProfileCurrentPerson"),
  },
  output: { module: "./src/profile.effx" },
};
