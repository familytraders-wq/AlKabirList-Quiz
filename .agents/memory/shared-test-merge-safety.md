---
name: Shared integration-test merge safety
description: Verification rule for task merges that touch the project's large shared API integration suite.
---

Treat broad changes to the shared API integration suite during a focused feature merge as suspicious, especially when unrelated test scenarios suddenly reference variables from the new feature.

**Why:** A focused CSV export merge substituted fragments from concurrent work into unrelated quiz, scheduling, and guest-progress tests. The feature code was sound, but the merged test file no longer typechecked and several test scenarios had changed meaning.

**How to apply:** After merging focused work that touches the shared integration suite, inspect its diff for unrelated replacements, run the API package typecheck, and execute the full shared integration test file before accepting the merge.