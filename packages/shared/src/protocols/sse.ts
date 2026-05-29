import { z } from 'zod';

export const SseEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('token'), content: z.string() }),
  z.object({ type: z.literal('thinking'), content: z.string() }),
  z.object({
    type: z.literal('tool_call'),
    name: z.string(),
    args: z.record(z.unknown()),
    callId: z.string(),
  }),
  z.object({
    type: z.literal('tool_result'),
    callId: z.string(),
    output: z.unknown(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal('agent_action'),
    action: z.enum(['create_node', 'update_node', 'connect_nodes', 'delete_node']),
    payload: z.unknown(),
  }),
  z.object({
    type: z.literal('flow_triggered'),
    runId: z.string(),
    wsId: z.string(),
  }),
  z.object({ type: z.literal('heartbeat'), ts: z.number() }),
  z.object({
    type: z.literal('done'),
    runId: z.string(),
    sessionId: z.string(),
  }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
  }),
]);
export type SseEvent = z.infer<typeof SseEventSchema>;
