# 0005 — Metadata and runtime schema representations

Nestrum compiles Prisma 8's emitted domain/storage/execution IR into portable immutable metadata, then generates Zod families at runtime. The release candidate emits codec-specific values: PostgreSQL Temporal objects, explicit JavaScript Date presets, ISO strings, and Mongo Date values are distinct. Preserving these representations avoids accepting values the ORM cannot encode; HTTP serialization belongs at the later API boundary. Unknown codecs fail instead of falling back to permissive validation. Runtime composition is available now; static per-model schema source generation is deferred.

Metadata uses canonical database.model identities rather than physical namespaces or table names. Physical mappings determine defaults and primary keys, while relations remain metadata without generating nested input schemas. Duplicate model names across namespaces fail to preserve unambiguous resource lookup.

Native Prisma 8 authoring is the default, with an explicit PostgreSQL prisma7Schema compatibility option to support the frozen MVP's cuid()/@updatedAt authoring. This sanctioned adapter avoids implementing a competing PSL translator, but maps cuid() to cuid2 and DateTime to Temporal.PlainDateTime. Applications choose the authoring mode consciously; it is not selected automatically after a native error.
