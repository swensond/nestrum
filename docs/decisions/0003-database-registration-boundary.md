# 0003 — Database registration boundary

Phase 2 introduces database configuration before Prisma contract/client generation. Core owns the explicit Prisma definition shape and validates named registration; @nestrum/prisma owns prismaDatabase() and depends on core, rather than creating a circular core-to-Prisma dependency. This accepts Prisma-specific core metadata, consistent with Prisma being foundational, while keeping provider runtime packages out of the portable registry.

Definitions carry kind, provider, and connection. The Phase 2 provider contract is PostgreSQL and MongoDB, the MVP integration targets. These values are configuration only: no Prisma ORM runtime is installed or invoked yet. Prisma 8's provider-specific configuration uses db.connection; later contract/runtime phases will translate definitions to the verified provider APIs.

Configuration and the required own default entry validate eagerly before app graph/hook execution. Typed application configuration requires databases.default. Definitions and names are snapshotted/frozen; names and model identities use identifier segments without dots, making database.model unambiguous. Low-level entry arrays permit duplicate detection before object construction would overwrite keys; already overwritten JavaScript object keys cannot be recovered.

Root test/type checking uses the workspace-only nestrum-source export condition so public package imports resolve current TypeScript source without requiring prior builds. Package builds and ordinary Node imports retain emitted dist exports and topological build order. These packages remain private; source export conditions require revisiting before publishing.

See [Phase 2](../phases/phase-02-databases.md), [Prisma 8 configuration](https://www.prisma.io/docs/cli/configuration), and [Prisma 8 supported databases](https://www.prisma.io/docs/orm/supported-databases).
