import { StableId, type SchemaRef, type SymbolRef } from "@effx/ir";
import {
  Terms,
  type EffectModel,
  type NativeCallee,
  type NativeKind,
  type SourceRange,
  type Term,
  type TermSlot,
} from "@effx/compiler";

/*
 * A realistic, hand-lowered model of the mono-web Profile group, built only through the public
 * `@effx/compiler` API exactly as a frontend writer would (spec 0019 §3.3: the two Profile endpoints, their
 * group and root). Coordinates are synthetic but internally consistent: 100 columns per line.
 */

export const FILE = "src/profile.ts";

export const MODULE = "./src/profile";

const position = (offset: number) => ({
  offset,
  line: 1 + Math.floor(offset / 100),
  col: 1 + (offset % 100),
});

/** A range of `FILE` between two offsets. */
export const range = (start: number, end: number, file: string = FILE): SourceRange => ({
  file,
  start: position(start),
  end: position(end),
});

export const lowered = (term: Term, start: number, end: number): TermSlot => ({
  _tag: "Lowered",
  term,
  range: range(start, end),
  spans: [],
});

export const httpApi = "effect/http-api";

const symbolOf = (module: string, name: string): SymbolRef => ({ module, export: name });

export const schemaOf = (module: string, name: string): SchemaRef => ({
  module,
  export: name,
  symbolId: StableId.make("schema", `${module.replace(/^\.\//u, "")}/${name}`),
});

const claim = (kind: NativeKind, member: string): NativeCallee => ({
  kind,
  member,
  target: "effect-4.0",
  ref: symbolOf(httpApi, kind),
});

/** The native claims the frontend makes under the stable v4 target table. */
export const nativeClaims: ReadonlyArray<NativeCallee> = [
  claim("HttpApiEndpoint", "get"),
  claim("HttpApiEndpoint", "patch"),
  claim("HttpApiGroup", "make"),
  claim("HttpApiSchema", "asJson"),
  claim("OpenApi", "annotations"),
  claim("HttpApi", "make"),
];

export const native = (kind: NativeKind, member: string): Term =>
  Terms.member(Terms.ref(symbolOf(httpApi, kind)), member);

const app = (name: string): SymbolRef => symbolOf("./src/common", name);

const readEndpoint: EffectModel["endpoints"][number] = {
  symbol: symbolOf(MODULE, "ReadOwnProfileEndpoint"),
  range: range(300, 900),
  callee: lowered(native("HttpApiEndpoint", "get"), 300, 330),
  key: lowered(Terms.lit("readOwnProfile"), 331, 348),
  path: lowered(Terms.lit("/api/profile"), 350, 364),
  options: {
    _tag: "Entries",
    range: range(366, 560),
    entries: [
      {
        _tag: "Property",
        name: "headers",
        range: range(370, 400),
        value: lowered(
          Terms.ref(schemaOf("./src/http-semantics", "ConditionalReadHeaders")),
          379,
          400,
        ),
      },
      {
        _tag: "Property",
        name: "success",
        range: range(402, 470),
        value: lowered(
          Terms.call(Terms.ref(symbolOf("./src/http-semantics", "privateConditionalResponses")), [
            Terms.ref(schemaOf("./src/v2-schemas", "UserProfileResponse")),
          ]),
          411,
          470,
        ),
      },
      {
        _tag: "Property",
        name: "error",
        range: range(472, 540),
        value: lowered(
          Terms.call(Terms.ref(symbolOf("./src/http-semantics", "endpointProblemResponses")), [
            Terms.ref(symbolOf("./src/endpoint-problems", "ProfileReadOwnProfileProblem")),
          ]),
          479,
          540,
        ),
      },
    ],
  },
  steps: [
    {
      _tag: "Method",
      name: "middleware",
      range: range(566, 592),
      args: [lowered(Terms.ref(app("PersonSecurity")), 578, 590)],
    },
    {
      _tag: "Apply",
      form: "pipe",
      range: range(596, 800),
      callee: lowered(Terms.ref(symbolOf("./src/access", "annotateAccessSpec")), 640, 658),
      args: [
        lowered(
          Terms.call(Terms.ref(symbolOf("./src/access", "personNativeAccess")), [
            Terms.obj([
              { key: "capability", value: Terms.lit("profile.read-self") },
              { key: "canonicalScopeResolver", value: Terms.lit("profile.current-person") },
              { key: "requirements", value: Terms.lit(["profile.owner"]) },
              { key: "decisionTime", value: Terms.lit("SnapshotRead") },
            ]),
          ]),
          668,
          790,
        ),
      ],
    },
    {
      _tag: "Method",
      name: "annotateMerge",
      range: range(804, 898),
      args: [
        lowered(
          Terms.call(Terms.ref(app("operationAnnotations")), [
            Terms.lit("Read own profile"),
            Terms.lit("Returns the profile selected by the current session."),
          ]),
          818,
          896,
        ),
      ],
    },
  ],
};

export const profileGroup: EffectModel["groups"][number] = {
  symbol: symbolOf(MODULE, "ProfileApi"),
  form: "class",
  range: range(1200, 1500),
  callee: lowered(native("HttpApiGroup", "make"), 1220, 1244),
  id: lowered(Terms.lit("profile"), 1245, 1254),
  options: { _tag: "Absent" },
  steps: [
    {
      _tag: "Method",
      name: "add",
      range: range(1260, 1330),
      args: [
        lowered(Terms.ref(readEndpoint.symbol), 1266, 1288),
        lowered(Terms.ref(symbolOf(MODULE, "UpdateOwnProfileEndpoint")), 1290, 1314),
      ],
    },
    {
      _tag: "Method",
      name: "annotateMerge",
      range: range(1336, 1480),
      args: [
        lowered(
          Terms.call(native("OpenApi", "annotations"), [
            Terms.lit({ title: "Profile", description: "Authenticated self-service profile API." }),
          ]),
          1350,
          1478,
        ),
      ],
    },
  ],
};

export const profileRoot: EffectModel["roots"][number] = {
  symbol: symbolOf("./src/api", "ExternalNativeApi"),
  form: "class",
  range: range(0, 200, "src/api.ts"),
  callee: lowered(native("HttpApi", "make"), 20, 40),
  id: lowered(Terms.lit("external-native-api"), 41, 62),
  steps: [
    {
      _tag: "Method",
      name: "add",
      range: range(64, 90, "src/api.ts"),
      args: [lowered(Terms.ref(profileGroup.symbol), 69, 79)],
    },
  ],
};

/** The Profile group's model: two endpoints (one fully lowered, one unlowerable), its group and root. */
export const profileModel: EffectModel = {
  project: {
    target: "effect-4.0",
    emit: "contract",
    allowImportingTsExtensions: false,
    canonicalImportBase: "/app/src",
    outputDir: "/app/.effx/generated",
  },
  files: [
    {
      file: FILE,
      module: MODULE,
      idPath: "src/profile",
      sha256: "0".repeat(64),
      exports: ["ReadOwnProfileEndpoint", "UpdateOwnProfileEndpoint", "ProfileApi"],
      topLevel: [
        "ReadOwnProfileEndpoint",
        "UpdateOwnProfileEndpoint",
        "ProfileApi",
        "HttpApiEndpoint",
      ],
      imports: [
        {
          _tag: "Resolved",
          specifier: httpApi,
          module: httpApi,
          kind: "value",
          range: range(0, 280),
          bindings: [{ local: "HttpApiEndpoint", ref: symbolOf(httpApi, "HttpApiEndpoint") }],
        },
      ],
      importsEnd: position(280),
      end: position(1500),
    },
  ],
  natives: nativeClaims,
  schemas: [
    {
      ref: schemaOf("./src/http-semantics", "ConditionalReadHeaders"),
      requiredKeys: ["if-none-match"],
    },
  ],
  markers: [{ ref: app("PersonSecurity"), security: true }],
  values: [],
  localValues: [],
  localCalls: [],
  wrappers: [],
  roots: [profileRoot],
  groups: [profileGroup],
  endpoints: [
    readEndpoint,
    {
      symbol: symbolOf(MODULE, "UpdateOwnProfileEndpoint"),
      range: range(920, 1180),
      callee: lowered(native("HttpApiEndpoint", "patch"), 920, 950),
      key: lowered(Terms.lit("updateOwnProfile"), 951, 969),
      path: lowered(Terms.lit("/api/profile"), 971, 985),
      options: {
        _tag: "Unlowered",
        range: range(987, 1150),
        findings: [
          {
            kind: "spread",
            construct: "options spread",
            range: range(1000, 1018),
          },
        ],
      },
      steps: [],
    },
  ],
  bindings: [],
  definitions: [],
};
