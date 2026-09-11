---
name: Generated client typechecking
description: Environment-specific TypeScript requirement for the OpenAPI-generated React Query client.
---

The OpenAPI React Query client uses `Headers.entries()` in its generated request helpers, so the TypeScript library set must include both `dom` and `dom.iterable`.

**Why:** The workspace's generated client typechecks against browser APIs, and the default Node/browser typings alone did not expose the iterable Headers methods.

**How to apply:** Preserve the DOM iterable library in the client package configuration when regenerating the clients; rerun the workspace typecheck after code generation.

When generated client source changes but an app still reports missing hooks or types, force-rebuild the client project before diagnosing the app import.

**Why:** The client uses a TypeScript project reference with declaration output and build metadata; stale declarations can hide newly generated exports even when the source file is current.

**How to apply:** Run the client project build with `--force`, then run the consuming artifact's typecheck.