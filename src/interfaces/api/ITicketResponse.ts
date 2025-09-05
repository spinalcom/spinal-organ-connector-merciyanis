import { ITicket } from "./ITicket";

/**
 * GET /tickets response in MerciYanis.
 */
export interface ITicketResponse {
  total : number;
  results : ITicket[];
}
