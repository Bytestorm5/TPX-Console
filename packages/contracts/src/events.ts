/**
 * The event bus. Queue names and event schemas live here, beside the RPC
 * types, so the producer and every consumer type-check against the same
 * definition. Products do not call each other by binding; cross-product
 * effects are events on these queues.
 */
import { z } from "zod";
import { IdSchema, ScopeSchema } from "./scope.ts";

export const QUEUES = {
  /** Integrator emits contract-change events here; any sink may subscribe. */
  integratorEvents: "tpx-integrator-events",
  /** Dispatcher consumes ticket intents from here (it is one sink among several). */
  dispatcherIntake: "tpx-dispatcher-intake",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

const Envelope = z.object({
  id: z.uuid(),
  at: z.number().int(),
  scope: ScopeSchema,
  actorUserId: IdSchema.nullable(),
});

export const ContractChangedEventSchema = Envelope.extend({
  type: z.literal("integrator.contract.changed"),
  payload: z.object({
    contractId: IdSchema,
    summary: z.string().max(2000),
    severity: z.enum(["info", "warning", "breaking"]),
    diffUrl: z.string().url().optional(),
  }),
});

export const TicketRequestedEventSchema = Envelope.extend({
  type: z.literal("dispatcher.ticket.requested"),
  payload: z.object({
    title: z.string().max(200),
    body: z.string().max(20000),
    source: z.string().max(100),
    labels: z.array(z.string().max(50)).max(20),
  }),
});

export const ConnectionAuditedEventSchema = Envelope.extend({
  type: z.literal("connections.audit"),
  payload: z.object({
    action: z.string(),
    target: z.string(),
    level: z.string().nullable(),
  }),
});

export const TpxEventSchema = z.discriminatedUnion("type", [
  ContractChangedEventSchema,
  TicketRequestedEventSchema,
  ConnectionAuditedEventSchema,
]);
export type TpxEvent = z.infer<typeof TpxEventSchema>;
export type ContractChangedEvent = z.infer<typeof ContractChangedEventSchema>;
export type TicketRequestedEvent = z.infer<typeof TicketRequestedEventSchema>;

export function parseEvent(raw: unknown): TpxEvent {
  return TpxEventSchema.parse(raw);
}
