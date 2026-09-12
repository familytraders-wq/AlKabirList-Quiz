---
name: Access audit semantics
description: The meaning of audit records for idempotent reviewer and administrator role changes.
---

Record a role-granted or role-revoked audit event only when the corresponding role row is actually inserted or deleted. Repeated idempotent requests should return the current access record without creating a false state-change event.

**Why:** An audit log is used to reconstruct who changed access and when; logging successful no-op retries as mutations makes that history misleading.

**How to apply:** Make the role mutation and its audit insert part of one transaction, and determine whether the role row changed before writing the event.