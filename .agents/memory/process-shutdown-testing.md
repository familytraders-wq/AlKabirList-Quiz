---
name: Process shutdown testing
description: Durable guidance for testing API signal handling and graceful shutdown without touching a live database cleanup.
---

Signal-path tests should launch the real server entrypoint in a child process, while injecting a controlled cleanup worker that can be held and released by the test.

**Why:** A worker-only unit test cannot catch regressions in signal registration, listener closure, process exit, or lingering handles. Importing the entrypoint without starting it also requires a main-module guard.

**How to apply:** Keep the production default unchanged, expose a narrow server-start seam for tests, assert the listening socket closes while cleanup is held, then release cleanup and require the child process to exit promptly.