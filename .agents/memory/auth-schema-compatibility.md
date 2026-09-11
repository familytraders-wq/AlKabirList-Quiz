---
name: Auth and quiz schema compatibility
description: Identity tables are merged with the reviewed quiz schema without changing legacy quiz author fields.
---

Keep Clerk identity and guest ownership in the auth tables, while preserving the existing quiz schema's legacy author-field types unless an explicit migration is planned.

**Why:** The development database already contains reviewed-quiz tables and data; changing those author columns during auth integration makes automatic schema push attempt unsafe casts.

**How to apply:** Add new identity foreign keys only where the existing database types match, and treat legacy author metadata as a separate compatibility surface.