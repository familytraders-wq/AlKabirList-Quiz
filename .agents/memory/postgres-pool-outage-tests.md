---
name: PostgreSQL outage test doubles
description: Safe patterns for simulating temporary PostgreSQL outages around the shared node-postgres pool.
---

When a test temporarily overrides a shared `pg.Pool` connection method, preserve both the promise and callback overloads, or restore access before issuing any verification query.

**Why:** `pool.query` may use the callback overload internally, while Drizzle transactions acquire a connection with the promise overload. A test double that only returns a promise can leave callback-based queries waiting forever.

**How to apply:** Prefer observing connection attempts and stopping the worker before querying the database. If a pool method must be wrapped, forward all arguments to the original bound method after recovery and restore it in `finally`.