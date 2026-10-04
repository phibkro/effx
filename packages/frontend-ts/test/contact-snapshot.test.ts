import { copyRc116Fixture } from "../../../tools/testing/projects.ts";
import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { inspect } from "@effx/cli";
import { type CompileResult, type Diagnostic, Extensions, compile } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { type ApplicationIR, semanticHash } from "@effx/ir";

const contactConfig = new URL("./fixtures/rc116/tsconfig.contact.effx.json", import.meta.url)
  .pathname;

const Frontend = TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer));

const Services = Layer.mergeAll(Frontend, BunServices.layer);

const commandName = "contact.submitContactMessage";

/** The AccessSpec call exactly as the application annotator receives it: the original fields. */
const emittedAccess =
  '.annotateMerge(contactAccessAnnotations({ exposure: "External", acceptedCredentials: ["ObjectCapability"], principalKinds: ["CapabilityHolder"], capabilities: {"_tag":"One","capability":"contact.submit"}, requirements: [], canonicalScopeResolver: ContactDepartmentRecipientResolver, concealment: {"_tag":"Reveal"}, decisionTime: "SnapshotRead" }));';

/** The Authority section of `effx inspect` with and without the claim. */
const authorityClaimed = "Authority\n  snapshotDecisionForCommand: true\n\nExposed";

const authorityPlain = "Authority\n  (none)\n\nExposed";

const decodeAccess = Schema.decodeUnknownEffect(Extensions.AccessContractData);

const decodeContract = Schema.decodeUnknownEffect(
  Schema.Struct({
    status: Schema.Int,
    securityMiddleware: Schema.Array(Schema.Struct({ export: Schema.String })),
  }),
);

const compileContact = (entry: string, project = contactConfig) =>
  compile(
    { tsconfigPath: project, entry: ["src/" + entry], emit: "contract", strictAccess: true },
    Extensions.builtin,
  );

const errorCodes = (diagnostics: ReadonlyArray<Diagnostic>) =>
  diagnostics.flatMap((item) => (item.severity === "error" ? [item.code] : []));

const inspectText = (result: CompileResult) =>
  Option.getOrThrow(Option.flatMap(result.index, (index) => inspect(index, commandName)));

/** The one `Http.Access` contract of `ir`, decoded with the compiler's own schema. */
const accessOf = Effect.fn("accessOf")(function* (ir: ApplicationIR) {
  const contracts = ir.nodes.flatMap((node) =>
    node._tag === "Extension" && node.extension === "access-contract" ? [node.data] : [],
  );

  assert.lengthOf(contracts, 1);

  return yield* decodeAccess(contracts[0]);
});

describe("Contact Command/SnapshotRead claim (rc.116 fixture)", () => {
  it.effect(
    "lowers the declared claim into the one AccessContract of the Contact command",
    () =>
      Effect.gen(function* () {
        const result = yield* compileContact("contact-message.effx.ts");

        assert.deepStrictEqual(errorCodes(result.diagnostics), []);

        const ir = Option.getOrThrow(result.ir.value);
        const operations = ir.nodes.flatMap((node) => (node._tag === "Operation" ? [node] : []));
        const groups = ir.nodes.flatMap((node) => (node._tag === "HttpGroup" ? [node] : []));

        const routes = ir.nodes.flatMap((node) =>
          node._tag === "Exposure" && node.transport._tag === "http"
            ? [`${node.transport.method} ${node.transport.path}`]
            : [],
        );

        const [contract] = ir.nodes.flatMap((node) =>
          node._tag === "Extension" && node.extension === "http-contract" ? [node.data] : [],
        );

        const wire = yield* decodeContract(contract);
        const access = yield* accessOf(ir);

        assert.lengthOf(operations, 1);
        assert.strictEqual(operations[0]?.name, commandName);
        assert.strictEqual(operations[0]?.kind, "Command");
        assert.lengthOf(groups, 1);
        assert.strictEqual(groups[0]?.id, "group:external-native-api/contact");
        assert.strictEqual(groups[0]?.title, "Public contact");
        assert.deepStrictEqual(routes, ["POST /api/contact-messages"]);
        assert.strictEqual(wire.status, 201);
        assert.deepStrictEqual(
          wire.securityMiddleware.map((marker) => marker.export),
          ["ContactSsrSecurity"],
        );
        assert.strictEqual(access.snapshotDecisionForCommand, true);
        assert.strictEqual(access.decisionTime, "SnapshotRead");
        assert.strictEqual(access.exposure, "External");
        assert.deepStrictEqual(access.acceptedCredentials, ["ObjectCapability"]);
        assert.deepStrictEqual(access.principalKinds, ["CapabilityHolder"]);
        assert.deepStrictEqual(access.capabilities, { _tag: "One", capability: "contact.submit" });
        assert.deepStrictEqual(access.requirements, []);
        assert.deepStrictEqual(access.concealment, { _tag: "Reveal" });
        assert.strictEqual(access.annotator.export, "contactAccessAnnotations");
        assert.strictEqual(
          access.canonicalScopeResolver.export,
          "ContactDepartmentRecipientResolver",
        );
      }).pipe(Effect.provide(Services)),
    120_000,
  );

  it.effect(
    "emits the original AccessSpec and a bodyless 201, never the claim, and inspect shows it",
    () =>
      Effect.gen(function* () {
        const result = yield* compileContact("contact-message.effx.ts");

        assert.deepStrictEqual(errorCodes(result.diagnostics), []);

        const files = Option.getOrThrow(result.files.value);

        assert.deepStrictEqual(
          files.map((file) => file.path),
          ["contact-contract.ts"],
        );

        const text = files[0]!.contents;

        assert.include(
          text,
          'HttpApiEndpoint.post("submitContactMessage", "/api/contact-messages"',
        );
        assert.include(text, ".middleware(ContactSsrSecurity)");
        assert.include(text, 'identifier: "contact.submitContactMessage"');
        assert.include(
          text,
          "success: HttpApiSchema.WithHeaders(ContactSubmitted, ContactSubmittedResponseHeaders).pipe(HttpApiSchema.status(201)),",
        );
        assert.notInclude(text, "HttpApiSchema.status(200)");
        assert.notInclude(text, "NoContent");
        assert.include(text, emittedAccess);
        assert.notInclude(text, "snapshotDecisionForCommand");
        assert.notInclude(text, "undefined");
        assert.notInclude(text, "override");
        assert.include(inspectText(result), authorityClaimed);
      }).pipe(Effect.provide(Services)),
    120_000,
  );

  it.effect(
    "adds only the claim to the IR of the same declaration without it",
    () =>
      Effect.gen(function* () {
        const claimed = yield* compileContact("contact-message.effx.ts");
        const plain = yield* compileContact("contact-no-flag.effx.ts");
        const claimedIr = Option.getOrThrow(claimed.ir.value);
        const plainIr = Option.getOrThrow(plain.ir.value);
        const { snapshotDecisionForCommand, ...remaining } = yield* accessOf(claimedIr);
        const unclaimed = yield* accessOf(plainIr);
        const claimedHash = yield* semanticHash(claimedIr);
        const plainHash = yield* semanticHash(plainIr);
        const claimedText = inspectText(claimed);
        const plainText = inspectText(plain);

        assert.strictEqual(snapshotDecisionForCommand, true);
        assert.isFalse(Object.hasOwn(unclaimed, "snapshotDecisionForCommand"));
        assert.deepStrictEqual(remaining, unclaimed);
        assert.deepStrictEqual(
          claimedIr.nodes.map((node) => node.id),
          plainIr.nodes.map((node) => node.id),
        );
        assert.deepStrictEqual(claimedIr.edges, plainIr.edges);
        assert.notStrictEqual(claimedHash, plainHash);
        assert.include(claimedText, authorityClaimed);
        assert.include(plainText, authorityPlain);
        assert.notInclude(plainText, "snapshotDecisionForCommand");
        assert.strictEqual(
          claimedText.replace("snapshotDecisionForCommand: true", "(none)"),
          plainText,
        );
      }).pipe(Effect.provide(Services)),
    120_000,
  );

  it.effect(
    "keeps rejecting a Command/SnapshotRead without the claim (EFFX2501)",
    () =>
      Effect.gen(function* () {
        const result = yield* compileContact("contact-no-flag.effx.ts");

        assert.sameMembers(errorCodes(result.diagnostics), ["EFFX2501"]);
        assert.isTrue(Option.isNone(result.files.value));
      }).pipe(Effect.provide(Services)),
    120_000,
  );

  it.effect(
    "rejects the claim beside a mutable authority requirement (EFFX2506, EFFX2501 remains)",
    () =>
      Effect.gen(function* () {
        const result = yield* compileContact("contact-flag-requirements.effx.ts");

        assert.sameMembers(errorCodes(result.diagnostics), ["EFFX2501", "EFFX2506"]);
        assert.isTrue(Option.isNone(result.files.value));
      }).pipe(Effect.provide(Services)),
    120_000,
  );

  it.effect(
    "rejects the claim on a Query (EFFX2506)",
    () =>
      Effect.gen(function* () {
        const result = yield* compileContact("contact-flag-query.effx.ts");

        assert.sameMembers(errorCodes(result.diagnostics), ["EFFX2506"]);
        assert.isTrue(Option.isNone(result.files.value));
      }).pipe(Effect.provide(Services)),
    120_000,
  );

  it.effect(
    "rejects the claim on a Command that decides in its Transaction (EFFX2506)",
    () =>
      Effect.gen(function* () {
        const result = yield* compileContact("contact-flag-transaction.effx.ts");

        assert.sameMembers(errorCodes(result.diagnostics), ["EFFX2506"]);
        assert.isTrue(Option.isNone(result.files.value));
      }).pipe(Effect.provide(Services)),
    120_000,
  );

  it.effect(
    "evaluates the generated contract under the strict annotator and renders a bodyless 201",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixtureRoot = yield* copyRc116Fixture();

        const result = yield* compileContact(
          "contact-message.effx.ts",
          path.join(fixtureRoot, "tsconfig.contact.effx.json"),
        );

        assert.deepStrictEqual(errorCodes(result.diagnostics), []);

        const temporaryFixture = yield* fs.makeTempDirectoryScoped({
          prefix: "effx-contact-runtime-",
        });

        yield* fs.copy(path.join(fixtureRoot, "src"), path.join(temporaryFixture, "src"));
        yield* fs.symlink(
          path.join(fixtureRoot, "node_modules"),
          path.join(temporaryFixture, "node_modules"),
        );
        const generated = path.join(temporaryFixture, ".effx", "generated");
        const contract = path.join(generated, "contact-contract.ts");
        yield* fs.makeDirectory(generated, { recursive: true });
        yield* fs.writeFileString(contract, Option.getOrThrow(result.files.value)[0]!.contents);

        const spec = yield* Effect.sync(() => {
          const child = Bun.spawnSync(["bun", "test", "src/contact-access.spec.ts"], {
            cwd: temporaryFixture,
            stdout: "pipe",
            stderr: "pipe",
          });

          return {
            exitCode: child.exitCode,
            output: new TextDecoder().decode(child.stdout) + new TextDecoder().decode(child.stderr),
          };
        });

        assert.strictEqual(spec.exitCode, 0, spec.output);
      }).pipe(Effect.scoped, Effect.provide(Services)),
    120_000,
  );
});
