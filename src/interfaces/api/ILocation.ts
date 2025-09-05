/**
 * A typical location structure in MerciYanis.
 */
export interface ILocation {
  /**
   * Universal unique identifier (RFC 4122 compliant UUID) for this location.
   */
  _id: string;

  /**
   * Registered user or service account that created this location.
   */
  _createdBy: any;

  /**
   * Last registered user or service account that updated this location, if any.
   */
  _updatedBy: any | null;

  /**
   * Whether this location has been deleted.
   */
  _isDeleted: boolean;

  /**
   * ISO 8601 formatted date and time of the location creation, in UTC.
   */
  _createdAt: Date;

  /**
   * ISO 8601 formatted date and time of the last location update, if any, in UTC.
   */
  _updatedAt: Date | null;

  /**
   * Location name.
   */
  name: string;

  /**
   * Parent location this location belongs to, if any.
   */
  parent: string | ILocation | null;
}
