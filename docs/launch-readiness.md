# Production launch readiness

This checklist is for a development verification pass. It does not claim that
production launch steps have been performed.

## Go/no-go checklist

- [ ] Production publishing applies the reviewed database schema migrations
      (`0004_production_launch_beta.sql` and
      `0005_attempt_idempotency_hardening.sql`) before API rollout.
- [ ] The intended administrator signs in with the production Clerk tenant, then
      `pnpm --filter @workspace/api-server bootstrap-admin <clerk-user-id>` is
      run against the production database.
- [ ] Clerk production publishable/secret keys, allowed origins, redirect URLs,
      and proxy configuration are configured and verified.
- [ ] Analytics is explicitly enabled in Publishing settings with the approved
      privacy and retention settings, then the app is published or republished.
- [ ] The content calendar has approved questions and UTC scheduled dates for
      the beta window.
- [ ] Load balancer probes use `/api/livez` for process liveness and
      `/api/readyz` for bounded database readiness; `/api/healthz` remains
      available for existing callers.
- [ ] A backup and a restore have been confirmed in a non-production
      environment, including the feedback and append-only audit tables.
- [ ] Rollback and incident contacts, escalation, and communication steps are
      recorded and rehearsed.

## Rollback and incident steps

1. Stop promotion and preserve request/audit correlation IDs.
2. Disable the affected beta operation or revert the application deployment.
3. Do not run destructive or ad-hoc startup DDL; restore from the verified
   backup only through the normal database change process.
4. Record the incident, customer impact, UTC timeline, and follow-up owner.
5. Re-enable traffic only after health probes, data integrity, and audit
   visibility are confirmed.