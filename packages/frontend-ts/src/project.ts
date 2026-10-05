import { Effect, FileSystem, Option, Path, Schema } from "effect";
import {
  CompilerFault,
  type AnalyzeOptions,
  type Diagnostic,
  type ProjectConfig,
  type ProjectResolution,
  EmitMode,
  TargetProfile,
  CoreDiagnostics,
} from "@effx/compiler";
import { ts, tryTs } from "./ts.ts";
import { snapshotHost } from "./snapshot-host.ts";

export interface Project {
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly rootDir: string;
  /** The actual tsconfig include/explicit entry files; imported helpers are not declarations. */
  readonly rootNames: ReadonlyArray<string>;
  readonly resolution: ProjectResolution | undefined;
  /** TS resolution against this tsconfig's installed Effect package, not a source-file sibling. */
  readonly resolveEffectModule: ((specifier: string) => boolean) | undefined;
  readonly outDir: string;
  /** Directory of the resolved `@effx/runtime` entry; `undefined` when the project does not import it. */
  readonly runtimeRoot: string | undefined;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

const PackageJson = Schema.fromJsonString(
  Schema.Struct({
    dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    devDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  }),
);

const TsconfigEffx = Schema.Struct({
  effx: Schema.optionalKey(
    Schema.Struct({
      projectRoot: Schema.optionalKey(Schema.String),
      outDir: Schema.optionalKey(Schema.String),
      emit: Schema.optionalKey(EmitMode),
      target: Schema.optionalKey(TargetProfile),
      strictAccess: Schema.optionalKey(Schema.Boolean),
    }),
  ),
});

/** Read selected tsconfig metadata without evaluating application modules. */
export const readTsconfigEffx = Effect.fnUntraced(function* (tsconfigPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(tsconfigPath);

  const settings = yield* tryTs("collect", () => {
    const parsed = ts.parseConfigFileTextToJson(tsconfigPath, text);

    if (parsed.error !== undefined) {
      throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n"));
    }

    return parsed.config;
  });

  const decoded = yield* Schema.decodeUnknownEffect(TsconfigEffx)(settings).pipe(
    Effect.mapError(
      (cause) =>
        new CompilerFault({
          stage: "collect",
          message: "invalid tsconfig effx settings in " + tsconfigPath,
          cause,
        }),
    ),
  );

  return decoded.effx;
});

const InstalledEffect = Schema.fromJsonString(
  Schema.Struct({ name: Schema.Literal("effect"), version: Schema.String }),
);

/** Only the installed target package version selects an implicit output API profile. */
export const targetProfileFromVersion = (version: string): TargetProfile | undefined => {
  if (version === "4.0.0") return "effect-4.0";

  if (/^4\.0\.0-rc\.\d+$/.test(version)) return "effect-4.0-rc";

  return undefined;
};

/** Nearest `package.json` walking up from `dir`; `Option`-like via `undefined` because absence is normal. */
const typescriptPin = Effect.fn("typescriptPin")(function* (
  dir: string,
  host: ts.ModuleResolutionHost,
) {
  const path = yield* Path.Path;
  let current = dir;

  for (;;) {
    const candidate = path.join(current, "package.json");

    const text = yield* tryTs("collect", () => host.readFile(candidate));

    if (text !== undefined) {
      const decoded = Schema.decodeOption(PackageJson)(text);

      if (Option.isNone(decoded)) return undefined;
      const pkg = decoded.value;
      const pin = pkg.devDependencies?.["typescript"] ?? pkg.dependencies?.["typescript"];

      if (pin !== undefined) return pin;
    }

    const parent = path.dirname(current);

    if (parent === current) return undefined;
    current = parent;
  }
});

/** ADR 0009: report analysis-vs-gate TypeScript skew as data. */
const versionSkew = (pin: string | undefined): ReadonlyArray<Diagnostic> => {
  if (pin === undefined || pin === ts.version) return [];

  return [CoreDiagnostics.EFFX0001.emit({ analysisVersion: ts.version, projectPin: pin })];
};

export const loadProject = Effect.fn("loadProject")(function* (
  config: ProjectConfig,
  input: AnalyzeOptions = {},
) {
  const captured: AnalyzeOptions = { ...input, sources: new Map(input.sources) };
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const tsconfigPath = path.resolve(config.tsconfigPath);
  const tsconfigDir = path.dirname(tsconfigPath);

  const text = yield* fs.readFileString(tsconfigPath);

  const snapshot = yield* tryTs("collect", () =>
    snapshotHost(path, captured, [tsconfigPath, text]),
  );

  const { parsed, settings } = yield* tryTs("collect", () => {
    const json = ts.parseConfigFileTextToJson(tsconfigPath, text);

    if (json.error !== undefined) {
      throw new Error(ts.flattenDiagnosticMessageText(json.error.messageText, "\n"));
    }

    return {
      parsed: ts.parseJsonConfigFileContent(
        json.config,
        snapshot,
        tsconfigDir,
        undefined,
        tsconfigPath,
      ),
      settings: json.config,
    };
  });

  if (parsed.errors.length > 0) {
    return yield* new CompilerFault({
      stage: "collect",
      message: parsed.errors
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
        .join("\n"),
    });
  }

  const effx = Schema.decodeUnknownOption(TsconfigEffx)(settings);
  const settingsEffx = Option.isSome(effx) ? effx.value.effx : undefined;

  const outDir =
    config.outDir === undefined
      ? path.resolve(tsconfigDir, settingsEffx?.outDir ?? ".effx/generated")
      : path.resolve(config.outDir);

  const rootDir = path.resolve(tsconfigDir, config.projectRoot ?? settingsEffx?.projectRoot ?? ".");

  const rootNames =
    config.entry === undefined
      ? parsed.fileNames
      : config.entry.map((file) => path.resolve(tsconfigDir, file));

  const options: ts.CompilerOptions = { ...parsed.options, noEmit: true };

  const { program, runtimeRoot, effectPackagePath, resolveEffectModule } = yield* tryTs(
    "collect",
    () => {
      const host = ts.createCompilerHost(options);
      host.readFile = snapshot.readFile;
      host.fileExists = snapshot.fileExists;
      host.directoryExists = snapshot.directoryExists;
      host.realpath = snapshot.realpath;
      host.readDirectory = snapshot.readDirectory;
      host.getDirectories = snapshot.getDirectories;
      // createCompilerHost closes over its original system: replace source acquisition too.
      host.getSourceFile = (fileName, languageVersion) => {
        const source = snapshot.readFile(fileName);

        return source === undefined
          ? undefined
          : ts.createSourceFile(fileName, source, languageVersion, true);
      };

      const created = ts.createProgram(rootNames, options, host);
      // Observe reference configuration without changing baseline program/root semantics.
      const visited = new Set<string>();
      const pending = [...(parsed.projectReferences ?? [])];

      for (let i = 0; i < pending.length; i++) {
        const reference = pending[i];

        if (reference === undefined) continue;
        const file = path.resolve(ts.resolveProjectReferencePath(reference));

        if (visited.has(file)) continue;
        visited.add(file);
        const contents = snapshot.readFile(file);

        if (contents === undefined) continue;
        const json = ts.parseConfigFileTextToJson(file, contents);

        if (json.error !== undefined) continue;

        const referenced = ts.parseJsonConfigFileContent(
          json.config,
          snapshot,
          path.dirname(file),
          undefined,
          file,
        );

        pending.push(...(referenced.projectReferences ?? []));
      }

      const containing = rootNames[0] ?? path.join(tsconfigDir, "__effx_target__.ts");
      const targetContaining = path.join(tsconfigDir, "__effx_target__.ts");

      const runtime = ts.resolveModuleName("@effx/runtime", containing, options, host)
        .resolvedModule?.resolvedFileName;

      const effectPackage = ts.resolveModuleName(
        "effect/package.json",
        targetContaining,
        { ...options, resolveJsonModule: true },
        host,
      ).resolvedModule?.resolvedFileName;

      const packageRoot = effectPackage === undefined ? undefined : path.dirname(effectPackage);

      return {
        program: created,
        runtimeRoot: runtime === undefined ? undefined : path.dirname(runtime),
        effectPackagePath: effectPackage,
        resolveEffectModule:
          packageRoot === undefined
            ? undefined
            : (specifier: string): boolean => {
                const resolved = ts.resolveModuleName(specifier, targetContaining, options, host)
                  .resolvedModule?.resolvedFileName;

                return (
                  resolved !== undefined &&
                  path.resolve(resolved).startsWith(packageRoot + path.sep)
                );
              },
      };
    },
  );

  const pin = yield* typescriptPin(tsconfigDir, snapshot);

  const diagnostics: Array<Diagnostic> = [...versionSkew(pin)];
  const location = { file: tsconfigPath, line: 1, col: 1 };

  if (Option.isNone(effx)) {
    diagnostics.push(CoreDiagnostics.EFFX2701.emit({ _tag: "Settings" }, { location }));
  }

  const packageText =
    effectPackagePath === undefined
      ? undefined
      : yield* tryTs("collect", () => snapshot.readFile(effectPackagePath));

  const installed =
    packageText === undefined ? Option.none() : Schema.decodeOption(InstalledEffect)(packageText);

  const target =
    config.target ??
    settingsEffx?.target ??
    (Option.isSome(installed) ? targetProfileFromVersion(installed.value.version) : undefined);

  if (target === undefined || Option.isNone(installed)) {
    const params: Parameters<typeof CoreDiagnostics.EFFX2701.emit>[0] = Option.isSome(installed)
      ? {
          _tag: "EffectVersion",
          version: installed.value.version,
          packagePath: String(effectPackagePath),
        }
      : effectPackagePath === undefined
        ? { _tag: "EffectUnresolved", directory: tsconfigDir }
        : { _tag: "EffectPackage", packagePath: effectPackagePath };

    diagnostics.push(CoreDiagnostics.EFFX2701.emit(params, { location }));
  }

  if (runtimeRoot === undefined) {
    diagnostics.push(
      CoreDiagnostics.EFFX1106.emit({
        _tag: "RuntimeResolution",
        from: rootNames[0] ?? tsconfigDir,
      }),
    );
  }

  return {
    program,
    checker: program.getTypeChecker(),
    rootDir,
    rootNames,
    outDir,
    runtimeRoot,
    resolveEffectModule,
    resolution:
      target === undefined || Option.isNone(installed)
        ? undefined
        : {
            target,
            emit: config.emit ?? settingsEffx?.emit ?? "all",
            strictAccess: config.strictAccess ?? settingsEffx?.strictAccess ?? false,
            allowImportingTsExtensions: parsed.options.allowImportingTsExtensions === true,
            canonicalImportBase: path.join(rootDir, ".effx", "generated"),
            outputDir: outDir,
          },
    diagnostics,
  } satisfies Project;
});
