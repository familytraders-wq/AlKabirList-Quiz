---
name: Content operations invariants
description: Security and data-integrity rules for question review and quiz scheduling.
---

Protect every state-changing content, review, generation, scheduling, and access route with the same origin and double-submit CSRF controls used elsewhere.

**Why:** Reviewer and administrator sessions use browser cookies; role checks alone do not prevent a forged request from changing approved religious content or schedules.

**How to apply:** Any new unsafe operator route must include authorization and CSRF middleware, with rejection and success coverage.

Validate that scheduled question versions are both approved and current inside the same locked transaction that writes quiz membership. Carry canonical version points through list, edit, schedule, and preview contracts without UI defaults overwriting them.

**Why:** Pre-transaction checks can race with review/version updates, and omitted point fields caused a participant preview to silently use the wrong value.

**How to apply:** Lock referenced question/version rows during scheduling, reject stale membership, and test a non-default point value end to end.