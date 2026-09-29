# HTTP runtime and scope ownership

## Status

Accepted in Phase 8.

## Context

The HTTP boundary must compose existing application/authorization primitives without introducing Node assumptions into core. InferDI 6 offers a Hono adapter with explicit scope inputs, awaited disposal, and disposal error reporting. Streaming and background work can outlive Hono's route pipeline.

## Decision

@nestrum/hono exposes a typed Hono instance and Fetch handler. Runtime startup gates requests until application readiness; shutdown rejects new requests and drains bounded request pipelines before app shutdown and owned-root disposal. Listener/signal wiring remains outside this portable entry point.

The default InferDI root registers framework values and declares subject/environment/request inputs. Each request supplies isolated inputs through the official Hono adapter. A caller-supplied root and factory preserve concrete service types and remain caller-owned. Named public graph types use InferDI's exported Spec/ScopeInputMap/WithRequirements helpers because direct inferred declarations reference private library types.

Default identity is anonymous. Trusted resolver hooks supply subject/environment attributes; request method/path cannot be replaced. Error mapping returns stable JSON envelopes and redacts internal causes. Observer/disposal failures do not replace an existing response.

## Consequences

The runtime has no generated resource routes or session authentication yet. Core stays independent of HTTP/DI imports. Services resolved within requests are usable only until the awaited route pipeline completes; streaming bodies, waitUntil tasks, and arbitrary background work require a separately owned lifetime. Do not silently transfer request scopes into detached work. TCP listener control, cancellation/timeouts, database disconnects, and complete bootstrap hardening remain later phases.

See [Phase 8](../phases/phase-08-hono-runtime.md) and [architecture](../architecture.md).
