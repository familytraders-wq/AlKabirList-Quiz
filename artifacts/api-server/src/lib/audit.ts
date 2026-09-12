import { operatorAuditEvents } from "@workspace/db/schema";

export type SafeAuditMetadata = Record<string, string | number | boolean | null>;
const structuralKeys = new Set([
  "fromStatus",
  "toStatus",
  "status",
  "role",
  "scheduledDate",
  "questionCount",
  "outputCount",
]);

/**
 * Insert an allow-listed, non-PII operator event. Call from the surrounding
 * transaction so the event cannot outlive a failed mutation.
 */
export async function writeAuditEvent(
  tx: { insert: (table: typeof operatorAuditEvents) => any },
  input: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: SafeAuditMetadata;
  },
) {
  const metadata = Object.fromEntries(
    Object.entries(input.metadata ?? {}).filter(([key, value]) =>
      structuralKeys.has(key) &&
      (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null),
    ),
  );
  return tx.insert(operatorAuditEvents).values({
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata,
  });
}