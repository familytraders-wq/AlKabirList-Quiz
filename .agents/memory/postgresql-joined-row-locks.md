---
name: PostgreSQL joined row locks
description: Concurrency behavior to account for when checking a mutable parent and its current child version.
---

When a transaction must compare a parent’s current child version after waiting on a concurrent update, lock the parent rows in a standalone statement, then read the joined current-version state in a subsequent statement.

**Why:** A joined `FOR UPDATE` query can resume after a concurrent parent update with a stale join snapshot and incorrectly report the parent as missing instead of observing the new version.

**How to apply:** Use this two-step pattern for optimistic expected-version checks on content imports and similar parent/current-child mutations; keep the conflict response tied to the row and version column.