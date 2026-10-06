/**
 * Backend-owned source syntax (spec 0024 §6). No endpoint or target Effect imports:
 * the generated projection checks the handler record, guard failures and context tuple.
 * Construction returns the supplied record unchanged, invokes no callback, records no
 * annotation and owns no resource. Effects and their cancellation remain application-owned.
 */
export const Binding = {
  group: <Group, const Binding>(_: Group, binding: Binding): Binding => binding,
};
