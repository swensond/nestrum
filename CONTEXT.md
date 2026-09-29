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

**QuerySet**:
A model-specific description of a collection query that can be refined before it is evaluated. Branches describe independent selections of records.
_Avoid_: Result array, Prisma collection

**Manager**:
A named entry point into a resource's queries, often starting with a conventional selection. The objects manager is the resource's unqualified entry point.
_Avoid_: Database client, fetched collection

**Subject**:
The actor whose attributes are considered when deciding whether an action is permitted. A subject may represent an anonymous actor.
_Avoid_: Auth user, session, request

**Action**:
A named operation for which a subject seeks permission on a resource, including domain operations such as archive or approve.
_Avoid_: HTTP method, role

**Policy**:
The rules deciding whether a subject may perform an action on a resource in its surrounding environment.
_Avoid_: Manager filter, role list

**Collection scope**:
The policy-defined boundary of records eligible for an action. It is distinct from a caller's selection within that boundary.
_Avoid_: Pagination, result filtering

**Object decision**:
A policy decision about an action on one particular record or proposed record.
_Avoid_: Field permission, collection scope

**Request scope**:
The lifetime boundary of work performed for one handled HTTP request. It is separate from a policy's boundary of eligible records.
_Avoid_: Collection scope, global service lifetime

**Authorization environment**:
Attributes of the context in which an action is requested, such as the request method, path, or trusted contextual facts.
_Avoid_: Subject, process environment variables
