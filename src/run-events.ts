/**
 * `md <flow> --events` — NDJSON run event stream (Flow UX Protocol v1).
 *
 * Every stdout line is one JSON object terminated by `\n`; stdout is
 * protocol-pure. Engine output travels inside `output.delta` events
 * (JSON-escaped), never interleaved raw. Diagnostics go to stderr as free
 * text. Event order contract: `protocol` first, `run.started` second,
 * exactly one terminal event (`run.completed` | `run.error` |
 * `run.cancelled`) last. `seq` starts at 0 and increments without gaps.
 */

import { randomUUID } from "node:crypto";
import { writeSync } from "node:fs";
import { FLOW_UX_PROTOCOL_VERSION } from "./roster";

export type RunEventName =
  | "protocol"
  | "run.started"
  | "output.delta"
  | "step.started"
  | "step.completed"
  | "run.completed"
  | "run.error"
  | "run.cancelled";

const TERMINAL_EVENTS = new Set<RunEventName>([
  "run.completed",
  "run.error",
  "run.cancelled",
]);

export interface RunEventEmitter {
  readonly runId: string;
  readonly terminalEmitted: boolean;
  emit(event: RunEventName, payload?: Record<string, unknown>): void;
}

/**
 * Create an event emitter that writes NDJSON lines synchronously to stdout
 * (fd 1). Synchronous writes guarantee both ordering and delivery before
 * `process.exit` — critical for the cancellation path.
 *
 * After a terminal event has been emitted, further emits are dropped so the
 * "exactly one terminal event, and it is last" contract can never be broken
 * by racing signal handlers.
 */
/** ~1ms pause between EAGAIN retries without burning a core. */
function sleepBriefly(): void {
  const bunSleep = (globalThis as { Bun?: { sleepSync?: (ms: number) => void } }).Bun?.sleepSync;
  if (bunSleep) {
    bunSleep(1);
    return;
  }
  const sab = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(sab, 0, 0, 1);
}

export function createRunEventEmitter(
  write: (line: string) => void = (line) => {
    // fd 1 is non-blocking when stdout is a pipe (observed under Bun on
    // macOS): writeSync can partially write and then throw EAGAIN when the
    // consumer lags. Either failure mid-line corrupts the NDJSON stream, so
    // loop with explicit offsets and retry EAGAIN until the full line is on
    // the wire.
    const buffer = Buffer.from(line, "utf8");
    let offset = 0;
    while (offset < buffer.length) {
      try {
        offset += writeSync(1, buffer, offset, buffer.length - offset);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "EAGAIN") {
          sleepBriefly();
          continue;
        }
        throw error;
      }
    }
  }
): RunEventEmitter {
  let seq = 0;
  let terminal = false;
  const runId = `r-${randomUUID()}`;

  return {
    runId,
    get terminalEmitted() {
      return terminal;
    },
    emit(event, payload = {}) {
      if (terminal) return;
      if (TERMINAL_EVENTS.has(event)) terminal = true;
      const envelope = {
        protocolVersion: FLOW_UX_PROTOCOL_VERSION,
        seq: seq++,
        runId,
        ts: Date.now(),
        event,
        ...payload,
      };
      write(`${JSON.stringify(envelope)}\n`);
    },
  };
}
