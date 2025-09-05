import { ILocation } from "./ILocation";

/**
 * GET /locations response in MerciYanis.
 */
export interface ILocationResponse {
  total : number;
  results : ILocation[];
}
