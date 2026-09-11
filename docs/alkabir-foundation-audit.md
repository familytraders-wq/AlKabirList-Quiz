# AlKabirList Foundation Audit

Date: 2026-09-11

## Executive summary

This workspace does not contain an existing production AlKabirList application. It contains:

- a design-only React/Vite mockup sandbox with several AlKabir Challenge variants;
- a deployable static web artifact with a polished but client-only quiz prototype;
- a skeletal Express API with one health endpoint;
- an empty PostgreSQL/Drizzle schema package;
- an OpenAPI-first contract and generated React Query/Zod client pipeline; and
- Replit artifact and build scaffolding.

The static web artifact is deployable in the technical sense, but it is not production groundwork yet: its questions and answer key ship in the browser bundle, scoring is calculated locally, all progress is ephemeral, and it has no API, authentication, database, or admin integration. It must be treated as a visual prototype until those boundaries are replaced.

The recommended path is to keep the current monorepo conventions, retain `artifacts/alkabir-challenge` as the product UI shell, and replace its local data/scoring through the existing OpenAPI, generated client, Express, and Drizzle layers. Authentication and the source of truth for admin roles must be selected before schema or API implementation begins.

## Audit scope

Reviewed:

- frontend and design entry points;
- backend entry points and route registration;
- database package and schema status;
- authentication, sessions, and admin authorization;
- API contract and generated-client conventions;
- styling and mockup behavior;
- build, workflow, and deployment configuration; and
- the supplied AlKabirList Islamic Knowledge Challenge brief.

No schema, API, authentication, or production UI changes were made during this audit.

## Current foundation

### Design-preview entry point

The design artifact under `artifacts/mockup-sandbox` remains a component-preview environment.

- `artifacts/mockup-sandbox/src/main.tsx` renders the sandbox `App`.
- `artifacts/mockup-sandbox/src/App.tsx` is a component gallery/preview shell, not a product router.
- Preview components are dynamically discovered and rendered at sandbox paths such as `/preview/<component>`.
- `artifacts/mockup-sandbox/src/components/mockups/alkabir-challenge/QuizFlow.tsx` is the main end-to-end AlKabir mockup.

The quiz mockup uses local React state for home, audience selection, question, feedback, results, and admin views. Its question, choices, answer, explanations, counts, and review data are hardcoded. It has no product URLs, persistence, authentication, API calls, or generated-client usage. The visible admin approval action changes local state only.

**Conclusion:** this artifact is a visual exploration environment, not the production frontend.

### Web artifact entry point and classification

The routed browser app is `artifacts/alkabir-challenge`.

- `artifacts/alkabir-challenge/src/main.tsx` mounts the application and global styles.
- `artifacts/alkabir-challenge/src/App.tsx` configures Wouter, React Query, error boundaries, and the two product routes `/` and `/quiz`.
- `artifacts/alkabir-challenge/src/pages/Home.tsx` is the landing page.
- `artifacts/alkabir-challenge/src/pages/Quiz.tsx` runs the quiz flow.
- `artifacts/alkabir-challenge/src/data/quiz.ts` contains five hardcoded questions, choices, explanations, source labels, and `isCorrect` flags.
- Artifact metadata defines a static Vite build with SPA fallback and root preview path, so it is technically deployable.

The implementation makes no API queries or mutations even though React Query and `@workspace/api-client-react` are installed. Sign-in is explicitly disabled, level/topic controls do not affect quiz selection, several controls are visual-only, and quiz state is lost on refresh.

The browser receives the complete answer key and calculates score locally. This is acceptable only for a prototype; it cannot be authoritative for production results, points, or streaks.

**Classification:** `artifacts/alkabir-challenge` is a **deployable visual prototype**, not production-ready and not yet production architecture. It may be retained as the UI shell only after local question data, answer validation, scoring, and progress state are replaced by server-backed flows.

### Backend entry point

The backend artifact is `artifacts/api-server`.

- `artifacts/api-server/src/index.ts` is the executable entry point. It requires a valid `PORT` and starts the Express app.
- `artifacts/api-server/src/app.ts` creates the app, installs request logging, CORS, and body parsers, then mounts routes under `/api`.
- `artifacts/api-server/src/routes/index.ts` is the route aggregator.
- `artifacts/api-server/src/routes/health.ts` implements the only route: `GET /api/healthz`.

There are no quiz, question, attempt, result, user, authentication, content-review, or admin routes.

### API and client conventions

The intended contract flow is already clear and should be retained:

1. `lib/api-spec/openapi.yaml` is the API contract source of truth.
2. Orval generates runtime Zod schemas and the React Query client.
3. Express routes import generated Zod schemas for validation.
4. Product frontend code should consume the generated React client rather than introducing handwritten endpoint types or a parallel fetch layer.

The OpenAPI server base is `/api`. It currently defines only `GET /healthz`.

`lib/api-client-react` supports a configurable base URL and optional bearer-token getter. The web artifact declares it as a dependency but does not initialize or consume it. Bearer support is transport capability, not proof that server authentication exists.

### Database approach

The intended data layer is PostgreSQL with Drizzle ORM.

- `lib/db/src/index.ts` requires `DATABASE_URL`, creates a `pg` pool, and exports the Drizzle client.
- `lib/db/src/schema/index.ts` is empty scaffolding and exports no tables.
- `lib/db/drizzle.config.ts` configures Drizzle Kit for PostgreSQL.
- Development scripts expose direct schema push commands.

There are no users, roles, categories, questions, choices, quizzes, attempts, answers, review records, migrations, or seed data. No API route currently imports or uses the database.

Direct schema push is documented as development-only. A production migration generation, review, apply, rollback, and backup process has not been established.

### Authentication and sessions

Authentication is not implemented.

The repository contains no:

- login, logout, callback, or current-user endpoints;
- identity-provider integration;
- session middleware or session store;
- server-side bearer verification;
- authenticated request context;
- user/account table; or
- CSRF strategy.

`cookie-parser` is listed as an API dependency but is not configured. The generated client can attach bearer tokens, but the API does not verify them.

The available `SESSION_SECRET` indicates that session support may be intended, but it does not establish an authentication design and was not inspected.

### Admin permissions

Admin permissions are not implemented and therefore cannot be verified as an existing convention.

- There is no user or role model.
- There is no authentication middleware.
- There is no server-side `requireAdmin` or equivalent authorization guard.
- The mockup exposes its review screen to any visitor.
- Mock approval is local UI state and has no persistence or audit trail.

All future admin authorization must be enforced by the server. Hiding admin navigation in the frontend is not an authorization boundary.

### Routing conventions

Current conventions that can be verified:

- API routes are mounted below `/api`.
- Route registration is centralized in `artifacts/api-server/src/routes/index.ts`.
- API shapes originate in `lib/api-spec/openapi.yaml`.
- The design sandbox's `/preview/...` paths are tooling routes and must not become product routes.
- The web artifact uses Wouter and currently implements `/` and `/quiz`, with an SPA fallback.

The web artifact now establishes Wouter as the product routing library, but the brief's additional user routes (`/quiz/daily`, `/quiz/results/:id`, `/quiz/history`, `/quiz/achievements`) and admin routes (`/admin/quiz/...`) remain requirements rather than implemented routes.

### Styling

The sandbox uses:

- React and Vite;
- Tailwind CSS v4;
- shared CSS variables/tokens in `artifacts/mockup-sandbox/src/index.css`;
- shadcn/Radix-style UI components;
- `clsx` and `tailwind-merge`;
- Framer Motion; and
- Lucide icons.

The AlKabir variants use custom utility classes and variant-specific palettes. These are useful design inputs, but the sandbox's generic theme is not evidence of the production AlKabirList design system. The selected visual direction should be converted into product-level tokens/components rather than copying a mockup wholesale.

The web artifact has already converted one direction into an ivory, dark-emerald, and gold theme using Tailwind and shared CSS variables. It uses Playfair Display and Plus Jakarta Sans from Google Fonts, generated imagery, Lucide icons, and shadcn-style components. This is the current product-shell styling, subject to visual approval and a decision on externally hosted versus self-hosted fonts.

### Build, workflow, and deployment setup

- The workspace uses pnpm, Node.js 24, and TypeScript.
- Root scripts orchestrate typechecking and package builds.
- The API is bundled with esbuild and configured to bind to `PORT`.
- Replit is configured for autoscale application routing.
- The API has an artifact-level health path at `/api/healthz`.
- The mockup sandbox is a design artifact, not a deployable product.
- The web artifact has a static Vite production build, static file server, and SPA rewrite, and is mounted at `/`.

Missing production setup includes:

- server-backed product data and scoring in the existing web artifact;
- production migration execution and rollback;
- an environment-variable contract beyond `DATABASE_URL` and `PORT`;
- an authentication provider and callback/origin configuration;
- restricted CORS and credential policy;
- security headers, rate limiting, CSRF/session policy, and body-size policy;
- database-aware readiness checks and graceful shutdown;
- backup/restore and operational runbooks; and
- product-level tests and release checks.

## Requirements from the supplied brief

The brief expects the quiz to be an AlKabirList feature, not a replacement for the community-list product. It also asks implementers to reuse existing authentication, navigation, database, API, components, and admin permissions. Because those systems are absent here, that instruction becomes a discovery and decision gate rather than an implementation shortcut.

Important production requirements include:

- database-driven categories, audiences, difficulty, and question types;
- normalized answer choices;
- reusable questions separated from quizzes through an ordered join;
- anonymous and authenticated attempts;
- server-owned correctness, scoring, completion, points, and streaks;
- idempotent submission/completion and duplicate-reward prevention;
- human-reviewed religious content with explicit status transitions;
- server-side, admin-only AI generation that always enters `pending_review`;
- approved-only public selection enforced server-side;
- source/reference and AI-generation metadata;
- review and version history sufficient to preserve historical correctness;
- transactional writes, foreign keys, unique constraints, and query indexes;
- accessible, mobile-first quiz interactions; and
- no AI calls during public quiz play.

## Recommended integration plan

### Gate 0: obtain or explicitly replace the missing production context

Before schema or API changes, decide which of these is true:

1. **An existing AlKabirList production repository exists elsewhere.** Import or connect it and repeat the auth, user, role, navigation, schema, and deployment portions of this audit against that source.
2. **This workspace will become the new AlKabirList application.** Explicitly approve the creation of new authentication, user/admin, product routing, and deployment conventions here.

Do not claim compatibility with existing AlKabirList accounts or admins until this gate is resolved.

### Gate 1: define identity and authorization contracts

Document before implementation:

- authentication provider and browser session/token strategy;
- canonical user identifier;
- whether anonymous attempts use signed cookies or another server-issued identifier;
- admin role source of truth;
- server middleware behavior for optional user, required user, and required admin;
- account-linking behavior for anonymous progress;
- session lifetime, CSRF protection, allowed origins, and cookie settings; and
- privacy/consent rules for child and family use.

Admin status must come from trusted server-side identity data. It must never be accepted from request payloads or client state.

### Gate 2: establish production data and migration conventions

Design the schema in `lib/db` and generate checked-in migrations rather than relying on production schema push.

Model at minimum:

- users or an external-identity mapping, plus roles/permissions if not provider-owned;
- categories and configurable audience/difficulty taxonomies;
- questions, normalized choices, sources, versions, and status history;
- quizzes and ordered quiz-question membership;
- attempts and submitted answers;
- review decisions and AI-generation audit metadata; and
- points/streak ledger or other idempotent reward records.

Use foreign keys, status constraints, indexes, and unique/idempotency constraints. Preserve a snapshot or version reference on submitted answers so later edits do not rewrite historical results.

#### Concrete entity relationships

The first production schema should use these relationships:

- `users` or `user_identities` 1-to-many `quiz_attempts`; attempts may instead reference one server-issued `anonymous_session_id`, with a constraint requiring exactly one owner form.
- `users` many-to-many `roles` through `user_roles` if roles are not owned by the authentication provider.
- `categories` 1-to-many `questions`; categories are deactivated rather than deleted when referenced.
- `audience_levels` many-to-many `questions` through `question_audiences`.
- `questions` 1-to-many immutable `question_versions`; the question row carries lifecycle state and points to the current version.
- `question_versions` 1-to-many `question_choices`; exactly one active choice is correct for multiple-choice questions.
- `question_versions` 1-to-many `question_sources` so a reviewed version can retain one or more references.
- `quizzes` many-to-many `question_versions` through `quiz_questions`, which stores stable order and points.
- `quiz_attempts` many-to-1 `quizzes` and 1-to-many `attempt_answers`.
- `attempt_answers` references the exact `quiz_question`, selected choice, awarded points, response time, and a correctness snapshot.
- `questions` 1-to-many `review_events`; each event references the reviewer, from/to status, decision note, and timestamp.
- `questions` 1-to-many `generation_runs` or one generation record per generated version, containing provider/model/prompt-version metadata and validation outcome but no secret.
- `users` 1-to-many `reward_ledger_entries`; each completion reward has a unique event key so retries cannot award twice.

Required integrity rules include:

- unique category slugs and ordered active category positions;
- unique question choice order within a version;
- one quiz question per quiz/version and unique position per quiz;
- one answer per attempt/quiz-question;
- one daily quiz per configured timezone date and audience, if audience-specific;
- one completion event and one reward event per attempt;
- status changes recorded transactionally with review events; and
- indexes for public approved/active selection, review queue filtering, daily lookup, user history, and incomplete-attempt resume.

### Gate 3: extend the existing OpenAPI-first backend

Add contracts to `lib/api-spec/openapi.yaml`, regenerate Zod/client packages, and implement routes beneath `/api`.

Minimum endpoint contracts:

| Method and path | Access | Contract and server responsibility |
| --- | --- | --- |
| `GET /api/quiz/config` | Public | Return active categories, audiences, difficulties, feature name, and daily timezone metadata. |
| `POST /api/quiz/attempts` | Optional user | Accept audience/category context and an optional idempotency key; select only approved active question versions, create/resume an attempt, and return question text/choices without correctness. |
| `GET /api/quiz/attempts/{attemptId}` | Attempt owner | Return resumable state without unrevealed answers; authorize by user or signed anonymous-session identity. |
| `POST /api/quiz/attempts/{attemptId}/answers` | Attempt owner | Accept question and selected choice plus idempotency key; verify membership/current state, score on the server, persist once, then return correctness, explanation, and reviewed sources for that answer. |
| `POST /api/quiz/attempts/{attemptId}/complete` | Attempt owner | Complete transactionally once, calculate totals/streak/reward, and return the result identifier. |
| `GET /api/quiz/results/{attemptId}` | Attempt owner | Return final score, reviewed explanations/sources, and authenticated reward summary. |
| `GET /api/me/quiz/history` | User | Return paginated completed attempts owned by the authenticated user. |
| `GET /api/me/quiz/progress` | User | Return points, current streak, and last qualifying date from authoritative ledger data. |
| `GET /api/admin/quiz/questions` | Admin/reviewer | Return paginated/filterable question-bank or review-queue records. |
| `POST /api/admin/quiz/questions` | Admin/reviewer | Create a manual draft version with normalized choices and sources. |
| `PATCH /api/admin/quiz/questions/{questionId}` | Admin/reviewer | Edit by creating a new version; do not mutate versions used by completed attempts. |
| `POST /api/admin/quiz/questions/{questionId}/reviews` | Authorized reviewer | Apply approve/reject/archive transitions with a required audit event and optimistic concurrency/version check. |
| `POST /api/admin/quiz/generation-runs` | Admin | Start bounded server-side generation; validate/deduplicate output and persist only pending-review questions. |
| `GET /api/admin/quiz/analytics` | Admin | Return aggregate counts only; never expose anonymous session secrets or unnecessary child/user data. |

All writes should use generated validation schemas. Start/answer/complete operations need idempotency protection and transactions. Public responses must not expose correct answers before submission.

### Gate 4: convert the existing web prototype into the production client

Keep `artifacts/alkabir-challenge` as the product shell and keep `artifacts/mockup-sandbox` as design tooling.

The conversion should:

- retain Wouter and add real daily, result, history, and protected admin routes;
- initialize and use `lib/api-client-react`;
- integrate the chosen authentication client;
- apply an approved AlKabirList token set and reusable components;
- keep admin pages behind both frontend affordances and server enforcement;
- handle loading, error, expired, resumed, and duplicate-submit states; and
- remove `src/data/quiz.ts` from production flow so no answer key or scoring authority remains in the bundle; and
- retain the community-list product's primary purpose when that product context becomes available.

The current local question/scoring code is explicitly prototype-only and must not be used as a fallback if API requests fail. Fail visibly and preserve resumable server state instead.

### Gate 5: harden content and operations before release

Before public release:

- enforce approved-and-active-only question selection in server queries;
- require human review for every AI-generated religious question;
- validate generated output, references, duplicates, and taxonomy values;
- add rate limits and timeouts to generation and submission endpoints;
- restrict CORS and configure session/CSRF/security headers;
- add database readiness, graceful shutdown, structured error handling, and monitoring;
- run reviewed migrations through a documented release step;
- test anonymous and authenticated completion, admin denial, review/publish flow, refresh/resume, and duplicate submission; and
- verify accessibility and mobile behavior in the production app, not only the mockup.

## Phase-by-phase delivery and verification plan

### Phase A: identity, authorization, and operational contract

**Database:** decide whether users/roles are local mappings or provider-owned; do not create quiz tables yet if identity keys are unresolved.

**Backend:** implement authenticated request context and optional-user/required-user/required-admin guards; restrict CORS and define session/CSRF behavior.

**Frontend:** wire sign-in/session state but keep the local quiz clearly marked as prototype-only or unavailable behind a feature flag.

**Verification:** prove anonymous access cannot reach admin routes; non-admin authenticated users receive `403`; session expiry and origin rejection behave as documented; sensitive headers remain redacted.

### Phase B: reviewed content foundation

**Database:** add taxonomy, questions, immutable versions, normalized choices, sources, generation metadata, and review events through checked-in migrations.

**Backend:** add manual CRUD, queue/filtering, review transitions, and bounded AI generation. Public selection must query approved, active versions only.

**Frontend:** build reviewer queue/editor against generated hooks; no direct database or handwritten API access.

**Verification:** test invalid state transitions, stale concurrent edits, rejection/archive behavior, generated-content validation, duplicate detection, and a hard assertion that draft/pending/rejected content never appears publicly.

### Phase C: daily attempts and authoritative scoring

**Database:** add quizzes, ordered quiz questions, anonymous/user-owned attempts, answers, and idempotency constraints.

**Backend:** implement start/resume, answer, complete, and result endpoints with transactions and server-side scoring.

**Frontend:** replace `src/data/quiz.ts` and local score calculation with generated API hooks; add loading, retry, expiry, offline/error, and resume states.

**Verification:** test answer-key omission before submission, duplicate answer/completion requests, refresh resume, unauthorized attempt access, deactivated questions after start, transactional rollback, and unchanged historical results after question edits.

### Phase D: authenticated progress and release hardening

**Database:** add reward ledger and streak state derived from unique completion events; add production indexes and retention rules.

**Backend:** add history/progress and aggregate admin analytics; add database readiness, graceful shutdown, rate limits, security headers, and structured errors.

**Frontend:** add history/progress views and protected admin navigation; complete keyboard, screen-reader, touch-target, contrast, and mobile behavior.

**Verification:** test timezone boundaries, anonymous-to-account linking if supported, no duplicate rewards, pagination, privacy of analytics, accessibility, mobile layout, migration apply/rollback rehearsal, backup/restore procedure, and deployment health.

## Decisions required before implementation

1. Is there an external AlKabirList production repository or is this the new source of truth?
2. Which authentication system will be used?
3. Where is the canonical admin role stored and who can grant it?
4. What identifies an anonymous attempt, and can it later link to an account?
5. What timezone defines the daily challenge and streak boundary?
6. What child/family privacy and consent policy applies?
7. Which visual variant is approved for conversion into product tokens?
8. Which AI provider/model, retention policy, budget, and source-verification policy are approved?
9. Who is authorized to review religious content, and what audit evidence must be retained?
10. What is the production migration, backup, rollback, and release process?

## Final recommendation

Proceed with production work only after Gates 0 and 1 are resolved. Then implement through the existing monorepo layers in this order:

1. identity/admin contract;
2. reviewed schema and migrations;
3. OpenAPI contracts and generated clients;
4. transactional Express services and authorization;
5. conversion of the existing web prototype into a server-backed production client; and
6. security, operational, accessibility, and end-to-end release checks.

This avoids a parallel architecture while acknowledging that the actual AlKabirList production architecture is not present in the current workspace.
