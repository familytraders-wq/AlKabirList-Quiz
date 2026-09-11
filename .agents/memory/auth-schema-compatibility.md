---
name: Auth and quiz schema compatibility
description: Identity tables are merged with the reviewed quiz schema without changing legacy quiz author fields.
---

Keep Clerk identity and guest ownership in the auth tables, while preserving the existing quiz schema's legacy author-field types unless an explicit migration is planned.

**Why:** The development database already contains reviewed-quiz tables and data; changing those author columns during auth integration makes automatic schema push attempt unsafe casts.

**How to apply:** Add new identity foreign keys only where the existing database types match, and treat legacy author metadata as a separate compatibility surface.

The development `users` identity and quiz ownership columns may retain text IDs even when newer Drizzle declarations describe UUIDs. Reconcile missing Clerk columns additively; do not force-cast established identity columns during an automatic schema push.

**Why:** Merged auth code can arrive before the development database gains its additive Clerk columns, while changing the underlying ID type would cascade through existing quiz ownership data.

**How to apply:** Inspect the live development schema before auth-related pushes. Add missing identity columns, indexes, and safe defaults without replacing or casting existing ID columns.