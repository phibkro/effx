import { Console, Effect, FileSystem, Option, Path, Predicate, Runtime, Schema } from "effect";
import {
  type CompileResult,
  type Extension,
  CompilerFault,
  EmitMode,
  Naming,
  HttpDiagnostics,
  problemNamingIssue,
  type ProjectConfig,
  Extensions,
  type SourceFrontend,
  TargetProfile,
  compile,
  hasErrors,
} from "@effx/compiler";
import { canonical, semanticHash } from "@effx/ir";
import { readTsconfigEffx } from "@effx/frontend-ts";
import { graph } from "./graph.ts";
import { inspect } from "./inspect.ts";
import { type Manifest, ManifestJson, PreviousManifestJson, locationsOf } from "./manifest.ts";
import { count, report, summary } from "./report.ts";
import { writeSurface } from "./surface-file.ts";

type ManifestDraft = { -readonly [K in keyof Manifest]: Manifest[K] };

type ProjectConfigDraft = { -readonly [K in keyof ProjectConfig]: ProjectConfig[K] };

/*
 * The four commands as portable Effects over FileSystem/Path/Crypto/SourceFrontend and the
 * Console reference. `main.ts` binds them to `effect/cli` and the Bun platform.
 */

/** Exit 1 after the diagnostics have already been printed: nothing left to report (`Runtime.errorReported`). */
export class CheckFailed extends Schema.TaggedError<CheckFailed>()("CheckFailed", {
  errors: Schema.Int,
}) {
  override readonly [Runtime.errorReported] = false;
}

/** Same as `CheckFailed` for a name that resolves to nothing; the message is printed by the command. */
export class UnknownName extends Schema.TaggedError<UnknownName>()("UnknownName", {
  name: Schema.String,
}) {
  override readonly [Runtime.errorReported] = false;
}

export interface Versions {
  readonly effx: string;
  readonly effect: string;
  readonly typescript: string;
}

export interface Project {
  readonly tsconfigPath: string;
  /** The tsconfig directory; manifest and diagnostic path reporting use this root. */
  readonly rootDir: string;
  readonly effxDir: string;
  readonly config: ProjectConfig;
  readonly extensions: ReadonlyArray<Extension>;
}

const ConfigFields = Schema.Struct({
  project: Schema.optionalKey(Schema.String),
  outDir: Schema.optionalKey(Schema.String),
  emit: Schema.optionalKey(EmitMode),
  target: Schema.optionalKey(TargetProfile),
  strictAccess: Schema.optionalKey(Schema.Boolean),
  naming: Schema.optionalKey(Naming),
  extensions: Schema.optionalKey(Schema.Unknown),
  generators: Schema.optionalKey(
    Schema.Struct({
      http: Schema.optionalKey(Schema.Boolean),
      rpc: Schema.optionalKey(Schema.Boolean),
      cli: Schema.optionalKey(Schema.Boolean),
      client: Schema.optionalKey(Schema.Boolean),
      foldkit: Schema.optionalKey(Schema.Boolean),
    }),
  ),
});

/** A definition an extension declares (spec 0020), as `Extension.annotations` carries it. */
type Definition = NonNullable<Extension["annotations"]>[number];

/**
 * What the pipeline reads of a definition an extension declares: its name, target, plan, recorded
 * diagnostics and effect key id. A definition is callable, so the plain-object guards do not apply to it.
 */
const validDefinition = (definition: unknown): definition is Definition =>
  Predicate.hasProperty(definition, "name") &&
  Predicate.isString(definition.name) &&
  Predicate.hasProperty(definition, "target") &&
  Predicate.isString(definition.target) &&
  Predicate.hasProperty(definition, "plan") &&
  Predicate.isObject(definition.plan) &&
  Array.isArray(definition.plan.items) &&
  Predicate.hasProperty(definition, "diagnostics") &&
  Array.isArray(definition.diagnostics) &&
  (!Predicate.hasProperty(definition, "effect") ||
    definition.effect === undefined ||
    (Predicate.hasProperty(definition.effect, "key") &&
      Predicate.hasProperty(definition.effect.key, "key") &&
      Predicate.isString(definition.effect.key.key)));

const validExtensions = (value: unknown): value is ReadonlyArray<Extension> =>
  Array.isArray(value) &&
  value.every(
    (entry) =>
      Predicate.isObject(entry) &&
      Predicate.isString(entry.name) &&
      Predicate.isObject(entry.interpreters) &&
      Object.values(entry.interpreters).every(Predicate.isFunction) &&
      Array.isArray(entry.analyses) &&
      entry.analyses.every(Predicate.isFunction) &&
      Array.isArray(entry.generators) &&
      entry.generators.every(Predicate.isFunction) &&
      (entry.annotations === undefined ||
        (Array.isArray(entry.annotations) && entry.annotations.every(validDefinition))) &&
      (entry.expand === undefined || Predicate.isFunction(entry.expand)) &&
      (entry.fragments === undefined ||
        (Array.isArray(entry.fragments) && entry.fragments.every(Predicate.isFunction))),
  );

const invalidConfig = (file: string, message: string, cause?: unknown): CompilerFault => {
  const detail = "invalid effx config " + file + ": " + message;

  return cause === undefined
    ? new CompilerFault({ stage: "collect", message: detail })
    : new CompilerFault({ stage: "collect", message: detail, cause });
};

/** Only the config module is executed, once per command invocation. No application entry is imported. */
export const loadConfig = Effect.fnUntraced(function* (file: string) {
  const path = yield* Path.Path;
  const url = yield* path.toFileUrl(file);

  const loaded = yield* Effect.tryPromise({
    try: () => import(url.href),
    catch: (cause) => invalidConfig(file, "module import failed", cause),
  });

  const config = yield* Schema.decodeUnknownEffect(ConfigFields)(loaded.default).pipe(
    Effect.mapError((cause) => invalidConfig(file, "invalid fields", cause)),
  );

  if (
    config.extensions !== undefined &&
    !Array.isArray(config.extensions) &&
    !Predicate.isFunction(config.extensions)
  ) {
    return yield* invalidConfig(file, "extensions must be an array or callback");
  }

  return config;
});

export const configuredExtensions = Effect.fnUntraced(function* (
  file: string | undefined,
  config: typeof ConfigFields.Type | undefined,
) {
  const configured = config?.extensions;

  const extensions: unknown = Predicate.isFunction(configured)
    ? yield* Effect.try({
        try: () => configured(Extensions.builtin),
        catch: (cause) => invalidConfig(file ?? "<config>", "extensions callback threw", cause),
      })
    : Array.isArray(configured)
      ? [...Extensions.builtin, ...configured]
      : Extensions.builtin;

  if (!validExtensions(extensions)) {
    return yield* invalidConfig(
      file ?? "<config>",
      "extensions must contain valid Extension entries",
    );
  }

  // Match by built-in identity after the callback; copied/custom extensions keep their generators.
  return extensions.map((extension) => {
    const key =
      extension === Extensions.http
        ? "http"
        : extension === Extensions.rpc
          ? "rpc"
          : extension === Extensions.cli
            ? "cli"
            : extension === Extensions.client
              ? "client"
              : extension === Extensions.foldkitExtension
                ? "foldkit"
                : undefined;

    return key !== undefined && config?.generators?.[key] === false
      ? { ...extension, generators: [] }
      : extension;
  });
});

/** Resolve paths at the source that supplied them; do not discover a second config after project override. */
export const resolveProject = Effect.fn("resolveProject")(function* (
  tsconfig = "tsconfig.json",
  strictAccess?: boolean,
  target?: TargetProfile,
  emit?: EmitMode,
  configPath?: string,
  outDir?: string,
  projectSelected = false,
  namingProblemIdentifier?: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const selectedPath = path.resolve(tsconfig);
  const discovered = path.join(path.dirname(selectedPath), "effx.config.ts");
  const file = configPath === undefined ? discovered : path.resolve(configPath);
  const exists = yield* fs.exists(file);

  if (configPath !== undefined && !exists) {
    return yield* invalidConfig(file, "file does not exist");
  }

  const config = exists ? yield* loadConfig(file) : undefined;

  const tsconfigPath =
    config?.project === undefined || projectSelected
      ? selectedPath
      : path.resolve(path.dirname(file), config.project);

  const rootDir = path.dirname(tsconfigPath);
  const effx = yield* readTsconfigEffx(tsconfigPath);
  const selectedTarget = target ?? config?.target ?? effx?.target;

  const problemIdentifier =
    namingProblemIdentifier ?? config?.naming?.problemIdentifier ?? effx?.naming?.problemIdentifier;

  const namingIssue =
    problemIdentifier === undefined ? undefined : problemNamingIssue(problemIdentifier);

  if (problemIdentifier !== undefined && namingIssue !== undefined) {
    const diagnostic = HttpDiagnostics.EFFX2412.emit({
      pattern: problemIdentifier,
      reason: namingIssue,
    });

    for (const line of report([diagnostic], (file) => file)) yield* Console.log(line);

    return yield* new CheckFailed({ errors: 1 });
  }

  const base = {
    tsconfigPath,
    projectRoot: path.resolve(rootDir, effx?.projectRoot ?? "."),
    outDir:
      outDir === undefined
        ? config?.outDir === undefined
          ? path.resolve(rootDir, effx?.outDir ?? ".effx/generated")
          : path.resolve(path.dirname(file), config.outDir)
        : path.resolve(outDir),
    strictAccess: strictAccess ?? config?.strictAccess ?? effx?.strictAccess ?? false,
    emit: emit ?? config?.emit ?? effx?.emit ?? "all",
  };

  const resolved: ProjectConfigDraft = { ...base };

  if (selectedTarget !== undefined) resolved.target = selectedTarget;

  if (problemIdentifier !== undefined) resolved.naming = { problemIdentifier };

  return {
    tsconfigPath,
    rootDir,
    effxDir: path.join(rootDir, ".effx"),
    config: resolved,
    extensions: yield* configuredExtensions(exists ? file : undefined, config),
  } satisfies Project;
});

/** Runs the pipeline and prints the diagnostics; the result is returned so callers decide what to do with it. */
export const compileAndReport = Effect.fn("compileAndReport")(function* (project: Project) {
  const path = yield* Path.Path;
  const result = yield* compile(project.config, project.extensions);
  const cwd = path.resolve();

  const relative = (file: string): string => {
    const location = path.relative(cwd, file);

    return location === ".." || location.startsWith(".." + path.sep) ? file : location;
  };

  for (const line of report(result.diagnostics, relative)) yield* Console.log(line);
  yield* Console.log(summary(count(result.diagnostics)));

  return result;
});

export const failOnErrors = (result: CompileResult): Effect.Effect<CompileResult, CheckFailed> =>
  hasErrors(result.diagnostics)
    ? Effect.fail(new CheckFailed({ errors: count(result.diagnostics).errors }))
    : Effect.succeed(result);

export const check = Effect.fn("check")(function* (
  project: Project,
): Effect.fn.Return<void, CheckFailed | CompilerFault, SourceFrontend | Path.Path> {
  yield* failOnErrors(yield* compileAndReport(project));
});

const decodePreviousManifest = Schema.decodeEffect(PreviousManifestJson);

export const build = Effect.fn("build")(function* (project: Project, versions: Versions) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const result = yield* failOnErrors(yield* compileAndReport(project));
  // After failOnErrors every stage succeeded; getOrThrow would be a pipeline invariant breach.
  const ir = Option.getOrThrow(result.ir.value);
  const files = Option.getOrThrow(result.files.value);
  const collected = Option.getOrThrow(result.collected.value);
  const generatedDir = collected.project?.outputDir ?? path.join(project.effxDir, "generated");
  const manifestPath = path.join(project.effxDir, "manifest.json");

  const generated = files.map((file) =>
    path.relative(project.effxDir, path.join(generatedDir, file.path)).split(path.sep).join("/"),
  );

  const currentFiles = new Set(generated.map((file) => path.resolve(project.effxDir, file)));

  const previous = (yield* fs.exists(manifestPath))
    ? yield* decodePreviousManifest(yield* fs.readFileString(manifestPath)).pipe(
        Effect.mapError(
          (cause) =>
            new CompilerFault({ stage: "generate", message: "invalid prior effx manifest", cause }),
        ),
      )
    : undefined;

  // A previous manifest is the ownership record: only obsolete files it lists in this output
  // directory may be removed. Never sweep an output directory containing unrelated user files.
  const obsolete = (previous?.generated ?? [])
    .map((file) => path.resolve(project.effxDir, file))
    .filter((file) => {
      const relative = path.relative(generatedDir, file);

      return (
        relative !== "" &&
        relative !== ".." &&
        !relative.startsWith(".." + path.sep) &&
        !path.isAbsolute(relative) &&
        path.extname(file) === ".ts" &&
        !currentFiles.has(file)
      );
    });

  yield* fs.makeDirectory(generatedDir, { recursive: true });
  yield* fs.makeDirectory(project.effxDir, { recursive: true });

  // A custom output may be reused, but stale files can be removed only within a real .effx.
  // Fail before writing if that ownership invariant is not satisfied.
  if (
    obsolete.length > 0 &&
    !(yield* fs.realPath(generatedDir)).split(path.sep).includes(".effx")
  ) {
    return yield* new CompilerFault({
      stage: "generate",
      message: "cannot remove obsolete generated files outside .effx: " + generatedDir,
    });
  }

  for (const file of files) {
    yield* fs.writeFileString(path.join(generatedDir, file.path), file.contents);
  }

  for (const file of obsolete) yield* fs.remove(file, { force: true });

  const irText = canonical(ir) + "\n";
  yield* fs.writeFileString(path.join(project.effxDir, "ir.json"), irText);
  yield* writeSurface(project.effxDir, ir, Option.getOrThrow(result.index));

  const manifestData: ManifestDraft = {
    format: "effx-manifest",
    version: 1,
    compiler: versions,
    semanticHash: yield* semanticHash(ir),
    emit: collected.project?.emit ?? project.config.emit ?? "all",
    naming: collected.project?.naming ??
      project.config.naming ?? { problemIdentifier: "{key}Problem" },
    generated,
    diagnostics: result.diagnostics,
    locations: locationsOf(collected, (file) =>
      path.relative(
        collected.project === undefined
          ? project.rootDir
          : path.dirname(path.dirname(collected.project.canonicalImportBase)),
        file,
      ),
    ),
  };

  if (collected.spreads !== undefined) {
    manifestData.spreads = collected.spreads.map((spread) => ({
      ...spread,
      location: { ...spread.location, file: path.relative(project.rootDir, spread.location.file) },
    }));
  }

  const manifest = yield* Schema.encodeEffect(ManifestJson)(manifestData);

  yield* fs.writeFileString(manifestPath, manifest + "\n");
  yield* Console.log(
    "wrote " +
      path.relative(".", project.effxDir) +
      "/{ir.json, manifest.json, surface.json}; generated: " +
      generated.join(", "),
  );
});

const indexed = Effect.fn("indexed")(function* (project: Project) {
  const result = yield* compile(project.config, project.extensions);

  // `interpret` always yields an IR and an index; only `generate` is skipped on errors.
  return { ir: Option.getOrThrow(result.ir.value), index: Option.getOrThrow(result.index) };
});

export const inspectCommand = Effect.fn("inspect")(function* (project: Project, name: string) {
  const { index } = yield* indexed(project);
  const text = inspect(index, name);

  if (Option.isNone(text)) {
    yield* Console.log(`error: no operation named ${name}`);

    return yield* new UnknownName({ name });
  }

  yield* Console.log(text.value);
});

export const graphCommand = Effect.fn("graph")(function* (
  project: Project,
  name: Option.Option<string>,
) {
  const { ir, index } = yield* indexed(project);
  const text = graph(ir, index, name);

  if (Option.isNone(text)) {
    yield* Console.log(`error: no node named ${Option.getOrElse(name, () => "")}`);

    return yield* new UnknownName({ name: Option.getOrElse(name, () => "") });
  }

  yield* Console.log(text.value);
});
