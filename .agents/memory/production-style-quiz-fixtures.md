---
name: Production-style quiz fixtures
description: Why critical quiz browser tests must exercise database defaults and legacy content shapes.
---

Critical quiz browser journeys should include minimal fixtures that rely on database defaults and at least one legacy-shaped metadata case, rather than only fully canonical fixtures.

**Why:** Canonical integration fixtures masked response-validation failures caused by legacy question source metadata. A real browser journey with production-style setup exposed failures after answer persistence and again during result completion.

**How to apply:** For launch-critical quiz checks, cover dynamic daily resolution, answer feedback, completion/results, and reporting with minimal persisted content. Include malformed or absent optional JSON metadata and verify every public response normalizes it safely.