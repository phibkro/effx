import type { Extension, EmitMode, TargetProfile } from "@effx/compiler";

/** An explicitly selected compiler project. Relative paths are based on the config file. */
export interface EffxConfig {
  readonly project?: string;
  readonly outDir?: string;
  readonly emit?: EmitMode;
  readonly target?: TargetProfile;
  readonly strictAccess?: boolean;
  /** Complete logical executable routes relative to this config; observation, not a sandbox. */
  readonly executableCoverage?: {
    readonly files?: ReadonlyArray<string>;
    readonly directories?: ReadonlyArray<{ readonly path: string; readonly recursive: boolean }>;
  };
  /** An array appends to built-ins; a callback replaces the entire ordered list. */
  readonly extensions?:
    | ReadonlyArray<Extension>
    | ((builtin: ReadonlyArray<Extension>) => ReadonlyArray<Extension>);
  /** File emission policy only. Interpretation, analyses, and IR are unaffected. */
  readonly generators?: {
    readonly http?: boolean;
    readonly rpc?: boolean;
    readonly cli?: boolean;
    readonly client?: boolean;
    readonly foldkit?: boolean;
  };
}

/** Preserve inference for an authored config without importing the CLI executable. */
export const defineConfig = <const C extends EffxConfig>(config: C): C => config;
