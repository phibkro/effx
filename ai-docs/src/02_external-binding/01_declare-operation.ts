/**
 * @title Declaration-only operation
 *
 * `.declare()` ends a builder chain without a handler. The operation enters the IR
 * with `binding: "external"` and your application binds the behaviour itself.
 */
import { Http, Operation } from "@effx/runtime";
import {
  BillingApi,
  GetInvoiceInput,
  InvoiceNotFound,
  InvoiceResponse,
  VoidInvoiceInput,
  VoidInvoiceParams,
} from "./fixtures/billing.ts";

// An external HTTP operation needs a group declaration with a concrete root
// symbol. The group is a separate exported value and one `HttpGroup` IR node.
export const InvoiceGroup = Http.group({
  root: BillingApi,
  group: "invoices",
  title: "Invoices",
  description: "Read and void invoices.",
  displayName: "Invoices",
});

// `.in(group)` associates the operation with the group: it supplies
// `root` and `group` to `.http.contract(...)` so you do not repeat them.
export const getInvoice = Operation.query({
  name: "invoices.get",
  input: GetInvoiceInput,
  success: InvoiceResponse,
})
  .in(InvoiceGroup)
  .http.get("/api/invoices/:id")
  .http.contract({
    params: GetInvoiceInput,
    // External HTTP operations MUST state `metadata.operationId` as exactly
    // `<group>.<endpointKey>`. The key (`get`) names the endpoint, the raw
    // binding record entry and the guard record entry (EFFX2403 otherwise).
    metadata: { operationId: "invoices.get", summary: "Read an invoice", tags: ["Invoices"] },
  })
  // No handler exists in this file; the backend binds `get` itself.
  .declare();

export const voidInvoice = Operation.command({
  name: "invoices.void",
  input: VoidInvoiceInput,
  success: InvoiceResponse,
})
  .in(InvoiceGroup)
  .http.post("/api/invoices/:id/void")
  .http.contract({
    // The path parameter and the JSON body are separate request channels.
    params: VoidInvoiceParams,
    payload: VoidInvoiceInput,
    metadata: { operationId: "invoices.void", summary: "Void an invoice" },
  })
  // With no handler to infer from, `.errors(...)` is a declaration of the
  // failures the bound implementation may raise (and stays in the IR).
  .errors(InvoiceNotFound)
  .declare();
