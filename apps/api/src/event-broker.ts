import type { ServerResponse } from "node:http";

import { isTerminal, type CourtRun, type RunEvent } from "@patchcourt/core";

function writeEvent(response: ServerResponse, event: string, data: unknown, id?: string): void {
  if (id) response.write(`id: ${id}\n`);
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

export class EventBroker {
  readonly #subscribers = new Map<string, Set<ServerResponse>>();

  publish(event: RunEvent, run: CourtRun): void {
    for (const response of this.#subscribers.get(run.id) ?? []) writeEvent(response, event.type, event, String(event.sequence));
  }

  receiptReady(run: CourtRun): void {
    if (!isTerminal(run.status) || !run.receipt) return;
    for (const response of this.#subscribers.get(run.id) ?? []) {
      writeEvent(response, "receipt_ready", { runId: run.id, status: run.status, receiptId: run.receipt.receiptId, receiptUrl: `/api/runs/${run.id}/receipt` });
      response.end();
    }
    this.#subscribers.delete(run.id);
  }

  subscribe(run: CourtRun, response: ServerResponse): () => void {
    for (const event of run.events) writeEvent(response, event.type, event, String(event.sequence));
    if (isTerminal(run.status) && run.receipt) {
      writeEvent(response, "receipt_ready", { runId: run.id, status: run.status, receiptId: run.receipt.receiptId, receiptUrl: `/api/runs/${run.id}/receipt` });
      response.end();
      return () => undefined;
    }
    const subscribers = this.#subscribers.get(run.id) ?? new Set<ServerResponse>();
    subscribers.add(response);
    this.#subscribers.set(run.id, subscribers);
    return () => {
      subscribers.delete(response);
      if (subscribers.size === 0) this.#subscribers.delete(run.id);
    };
  }

  subscriberCount(runId: string): number {
    return this.#subscribers.get(runId)?.size ?? 0;
  }
}
