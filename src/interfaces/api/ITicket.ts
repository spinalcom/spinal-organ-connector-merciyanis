/**
 * A typical ticket structure in MerciYanis.
 */
export interface ITicket {
  /**
   * Universal unique identifier (RFC 4122 compliant UUID) for this ticket.
   */
  _id: string;

  /**
   * Registered user or service account that created this ticket.
   */
  _createdBy: any;

  /**
   * Last registered user or service account that updated this ticket, if any.
   */
  _updatedBy: any;

  /**
   * Whether this ticket has been deleted.
   */
  _isDeleted: boolean;

  /**
   * ISO 8601 formatted date and time of the ticket creation, in UTC.
   */
  _createdAt: Date;

  /**
   * ISO 8601 formatted date and time of the last ticket update, if any, in UTC.
   */
  _updatedAt: Date | null;

  /**
   * A human-readable, unique number for this ticket.
   * Automatically generated on ticket creation.
   */
  _number: number;

  /**
   * Ticket title.
   */
  title: string;

  /**
   * Provides additional details about the ticket.
   */
  description: string;

  /**
   * Ticket status in the completion workflow.
   */
  status: 'NEW' | 'IN_PROGRESS' | 'COMPLETED';

  /**
   * Final location the ticket belongs to.
   */
  location: string | Location | null;

  /**
   * Ticket category.
   */
  category: string | null;

  /**
   * A list of registered users that have been assigned to this ticket.
   * These users will be notified whenever the ticket is updated.
   */
  assignees: (any)[];

  /**
   * A list of registered users that subscribed to this ticket.
   * These users will be notified whenever the ticket is updated.
   */
  followers: (any)[];

  /**
   * A list of external followers (that did not register on the platform) for this ticket.
   * Each item is an email address. Whenever this ticket will be updated,
   * an email will be sent to all the specified followers.
   */
  externalFollowers: string[];

}
