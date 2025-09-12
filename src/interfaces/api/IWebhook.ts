import { ITicket } from "./ITicket";

/** Info about the source of the change */
export interface WebhookSource {
  /** Name of the channel (Teams, mobile app, sensor, …) */
  _channel: string;

  /** Id of the user or service account that performed the change */
  _externalId: string;

  /** Full name of the user or service account that performed the change */
  _fullName: string;
}

/** Attachment object (image, etc.) */
export interface WebhookAttachment {
  _size: number;
  _type: "image/jpeg" | "image/png";
  path: string;
  name: string;
}

/** Allowed webhook event types */
export type TicketEventType = "CREATE_TICKET" | "UPDATE_TICKET" | "DELETE_TICKET";

/**
 * Common payload structure for all ticketing-related events
 */
export interface TicketWebhookPayload {
  /** Universal unique identifier (UUID v4) for this ticket event */
  _id: string;

  /** Type of ticketing event */
  _type: TicketEventType;

  /** Id of the ticket related to this event */
  _ticket: string; // or `number` if ticket IDs are numeric

  /** Information about the source of the change */
  _source: WebhookSource;

  /**
   * Payload data:
   * - On CREATE_TICKET: contains the whole ticket object
   * - On UPDATE/DELETE: contains only updated fields (string or partial)
   */
  data: ITicket | Partial<ITicket>;

  /** Additional attachments, if applicable */
  attachments: WebhookAttachment[] | null;
}