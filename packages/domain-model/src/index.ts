export {
  DomainDescription,
  Guard,
  CheckRepresentation,
  SubjectExpression,
  SubjectSet,
  Command,
  Read,
  Grant,
  MachineContext,
  Transition,
  CalculatedTransition,
  Machine,
} from "./DomainDescription.ts";

export { AlloySymbols, generateAlloy } from "./Alloy.ts";

export type {
  AlloyGuardCompiler,
  AlloyGuardField,
  AlloyMachineSymbols,
  AlloyModel,
  AlloyOptions,
} from "./Alloy.ts";

export {
  alloyBasename,
  alloyStaticBasename,
  domainFromIR,
  domainModel,
  domainNodes,
} from "./extension.ts";

export {
  AlloyReceiptJson,
  ConformanceVectors,
  ConformanceVectorsJson,
  receiptCommandMatches,
  snapshotsFromSolutions,
  vectorsFromReceipt,
} from "./vectors.ts";

export type { AlloyReceipt, AlloySolution, VectorSnapshot } from "./vectors.ts";
