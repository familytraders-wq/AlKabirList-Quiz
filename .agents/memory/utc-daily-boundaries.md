---
name: UTC daily boundary contract
description: Rules for keeping daily challenge dates stable across issuance, completion, linking, and generated API clients.
---

The canonical daily value is a date-only `YYYY-MM-DD` string derived from the UTC representation of an instant. It must remain a string in API contracts and generated clients; converting it to a JavaScript `Date` reintroduces timezone-dependent behavior.

**Why:** The challenge date belongs to the issued attempt, not to completion time, account-link time, or a viewer's timezone. Date-only fields generated as `Date` objects can shift when rendered or serialized.

**How to apply:** Derive the date with UTC ISO output at issuance, persist it in a PostgreSQL `date` column, key completion/reward uniqueness by member plus that date, and use an OpenAPI pattern without `format: date` when the client generator would coerce formatted dates.