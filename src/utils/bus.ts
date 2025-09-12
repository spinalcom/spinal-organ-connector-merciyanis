import { EventEmitter } from "events";

export type MerciYanisEventName = "CREATE_TICKET" | string;

export interface WebhookEvent<T = any> {
  name: MerciYanisEventName;
  deliveryId: string;
  hookId: string;
  payload: T;
  receivedAt: number;
}

class WebhookBus extends EventEmitter {
  emitEvent<T = any>(evt: WebhookEvent<T>) {
    this.emit(evt.name, evt);
    this.emit("*", evt); // optional wildcard
  }
}

export const bus = new WebhookBus(); // <-- singleton instance