# 0010 — Public API transport and mutation boundary

## Status

Accepted — Phase 9.

## Context

Resource API flags, runtime schema families, QuerySets, ABAC, and a request-scoped Hono runtime already exist. Native Prisma values include Date, bigint, and Temporal, which cannot be treated as ordinary JSON input. QuerySet mutations return affected counts and deliberately deny arbitrary per-object checks; a subsequent read would need an independent read grant and could fail after a successful write.

Composed Where schemas may transform caller filters. An item route cannot let such a transform remove its primary-key predicate. Generated routes and documentation must also agree on which operations exist.

## Decision

Build a single plan from enabled registered resource operations. Use that plan to register Hono handlers and @hono/zod-openapi registry entries, validate document generation before mounting, and expose a generated-only OpenAPI snapshot. Default paths use regular plural kebab-case model names; named databases add a path segment. Reject ambiguous or overlapping routes and unsupported item identities during startup. Gate traffic until this registration succeeds; roll back already-ready apps on failure.

Decode native scalar values using metadata, then validate composed runtime schemas once through QuerySets. Encode Read-validated data as JSON, preserving ISO temporal strings and decimal bigint strings. Input schemas are strict at the public boundary. Keep runtime validators authoritative when native/custom rules cannot be expressed faithfully in OpenAPI. Allow a Temporal input factory map when the matching implementation is not globally installed.

Use QuerySet.filterPrimaryKey to validate and retain one scalar identity predicate independently of Where transformations. Keep collection authorization scopes as separate conjunctive predicates. Map GET to read and POST/PATCH/DELETE to their respective write actions; require no implicit read grant for writes.

POST returns Read-validated data with 201. PATCH and DELETE return 204 without a record; zero affected rows return 404. Do not implement a read-modify-write workaround for object policies: retain the existing denial until atomic object mutation orchestration is added within MVP. Read schema and serialization failures are internal errors, with original causes available to server observers.

## Consequences

Ordinary resource additions require no Hono or OpenAPI files. Disabled/admin-only resources contribute nothing to public metadata. API writes have unambiguous count-based success and cannot leak records through an extra read. They presently support resource/input grants and collection scopes, while object-based update/delete policies remain denied.

Apps still own database clients and HTTP listeners. Live SQL/Mongo verification belongs to Phase 16; final lifecycle barriers belong to Phase 15. Composite-key URLs, richer query APIs, aliases, UI documentation, and full custom-validator documentation are deferred. The document intentionally describes generated resource routes; manual OpenAPI registrations are outside that snapshot.

## References

- [Phase 9](../phases/phase-09-public-api.md)
- [Authorization query boundary](0008-authorization-query-boundary.md)
- [HTTP runtime ownership](0009-http-runtime-and-scope-ownership.md)
- [Official @hono/zod-openapi documentation](https://github.com/honojs/middleware/tree/main/packages/zod-openapi)
