/*
 * Feature: runtime-to-SSE event mapping.
 * Notes: preserves the internal event names and serializes JSON payloads for streaming clients.
 * Recent changes: initial scaffold implementation.
 */

import type { RuntimeEvent } from "../runtime/runtimeTypes.js";

export type SseEvent = {
  event: string;
  data: string;
};

export function mapRuntimeEvent(event: RuntimeEvent): SseEvent {
  return {
    event: event.type,
    data: JSON.stringify(event)
  };
}
