export {
  CheckFailed,
  type Project,
  UnknownName,
  type Versions,
  build,
  check,
  graphCommand,
  inspectCommand,
  resolveProject,
  rereadProject,
  type ResolveOptions,
} from "./commands.ts";

export { defineConfig, type EffxConfig } from "./config.ts";

export { Manifest, ManifestJson, locationsOf } from "./manifest.ts";

export { inspect, renderOperation, resolveName, schemaDisplay } from "./inspect.ts";

export { graph } from "./graph.ts";

export { count, formatDiagnostic, report, summary } from "./report.ts";

export { writeSurface } from "./surface-file.ts";

export { surfaceCheck } from "./surface.ts";

export { dev, type DevOptions } from "./watch.ts";

export { lsp, type LspOptions } from "./lsp.ts";

export {
  LiftAnalysisFailed,
  LiftExit,
  liftCommand,
  prepareLift,
  type LiftCommandOptions,
  type LiftSelection,
  type PreparedLift,
} from "./lift-command.ts";

export {
  defaultLiftCheckBounds,
  liftCheckPassed,
  runLiftCheck,
  type LiftCheckBounds,
  type LiftCheckRequest,
} from "./lift-check.ts";

export { LiftForm, LiftJsonReport, LiftUsageError, type LiftRunParams } from "./lift.ts";

export { ExecutableInventory } from "./config-runtime.ts";

export {
  acquireLspTransport,
  RpcFailure,
  TransportError,
  ClientProbeError,
  LspPlatform,
  type LspIO,
  type LspCallbackRuntime,
  type LspTransport,
} from "./lsp-transport.ts";

export { main, Services } from "./main.ts";
