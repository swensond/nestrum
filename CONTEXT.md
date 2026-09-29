# Nestrum

Nestrum groups application-owned models and behavior into explicitly installed apps. Database names distinguish independently configured data stores throughout the application.

## Language

**Database definition**:
The selected provider and connection settings for a data store. A definition is configuration, rather than a live database client.
_Avoid_: Client, connection pool

**Database name**:
An application-local name for a configured data store. Different names may refer to the same physical store while retaining separate application identities.
_Avoid_: Model name, provider name

**Default database**:
The required data store named default, used when a model reference omits a database name.
_Avoid_: Primary database, global database

**Model identity**:
The combination of a database name and a model name that distinguishes a model within an application.
_Avoid_: Unqualified model name, table name

**Prisma fragment**:
An app-owned part of a database's data contract, contributed to one or more named databases. Ownership stays with the contributing app.
_Avoid_: Global schema, generated contract

**Assembled contract**:
The combined data contract for one named database from its installed apps' fragments.
_Avoid_: Cross-database schema, application-owned giant schema

**Model metadata**:
The framework's description of one model's fields, relationships, and data-store identity. It is distinct from records stored for that model.
_Avoid_: Model instance, record, physical table

**Schema family**:
A related set of validation contracts for a model's records, creation, changes, filtering, and ordering.
_Avoid_: Database schema, Prisma fragment

**Resource**:
A model's registered application-facing definition, with validation rules and explicitly selected public operations. Resources can participate in administration without exposing a public API.
_Avoid_: Route, model instance, admin page
