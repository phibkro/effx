# ADR 0010: Explicit Query over POST

Status: accepted (2026-10-03)

## Context

ADR 0006 makes `Query` an observational-semantics claim, not a proof of handler purity. Its default HTTP check rejects non-GET exposure. Some reads accept private inputs such as an exact email address: putting that value in a URL would disclose it through URL logging and history. The unmerged mono-web `lookupAppointmentCandidate` endpoint uses POST with an explicit request payload for this reason, while retaining snapshot-read authority.

## Decision

A `Query` may use HTTP POST **only** when its `Http.Contract` explicitly sets `payloadIsQuery: true` and declares a `payload` schema. The flag defaults to `false` in the contract IR. `EFFX2402` rejects the flag on a Command, on any method other than POST, or without an explicit payload; `EFFX2401` still rejects every other non-GET Query exposure. The POST payload remains in the HTTP request body, not the URL or the query-string channel.

This is an opt-in declaration of intent, not permission to write, an authorization decision, or a purity guarantee. ADR 0006 continues to govern the semantic claim and its limitations. An application handler remains responsible for honoring read-only semantics and for running authorization within its own read snapshot.

## Consequences

- Existing Query-over-POST declarations without the flag still fail; no method or payload is inferred from an input schema.
- Explicitly flagged Query POST contracts can carry private lookup inputs without exposing them in a URL.
- Other mutating methods never inherit this exception.
