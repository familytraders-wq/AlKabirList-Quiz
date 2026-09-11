---
name: Result retry error semantics
description: Distinguishes query refetch results that settle with an error from promises that reject during retry UI tests.
---

Result retry tests should model the query library’s normal failed-result response as a settled refetch that leaves the query in an error state; reserve rejected promises for a separately handled error path.

**Why:** The retry UI must clear its local progress state when a result request settles, while an unhandled rejected mock can make a passing interaction test fail independently of the visible error state.

**How to apply:** When extending completed-result retry coverage, assert both the disabled progress state and the persistent error after the refetch settles; add explicit rejection handling before testing a truly rejected promise.