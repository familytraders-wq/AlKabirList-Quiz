---
name: Auth and quiz schema compatibility
description: Identity tables are merged with the reviewed quiz schema without changing legacy quiz author fields.
---

Keep Clerk identity and guest ownership in the auth tables, while preserving the existing quiz schema's legacy author-field types unless an explicit migration is planned.

**Why:** The development database already contains reviewed-quiz tables and data; changing those author columns during auth integration makes automatic schema push attempt unsafe casts.

**How to apply:** Add new identity foreign keys only where the existing database types match, and treat legacy author metadata as a separate compatibility surface.

Keep internal user IDs and every user-reference column text-compatible. New users receive generated UUID-shaped text IDs, while legacy rows whose text ID is already a Clerk subject must be claimed atomically on first login rather than duplicated.

**Why:** Forcing UUID types can break legacy ownership data, while treating every text ID as a new account can detach existing attempts and roles from the returning Clerk user.

**How to apply:** Use additive, idempotent reconciliation migrations; map Clerk identity in a separate unique column; accept bounded opaque internal IDs at API boundaries; and claim exact legacy Clerk-subject IDs before inserting.