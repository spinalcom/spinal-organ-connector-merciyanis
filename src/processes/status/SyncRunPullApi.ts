/*
 * Copyright 2021 SpinalCom - www.spinalcom.com
 *
 * This file is part of SpinalCore.
 *
 * Please read all of the following terms and conditions
 * of the Free Software license Agreement ("Agreement")
 * carefully.
 *
 * This Agreement is a legally binding contract between
 * the Licensee (as defined below) and SpinalCom that
 * sets forth the terms and conditions that govern your
 * use of the Program. By installing and/or using the
 * Program, you agree to abide by all the terms and
 * conditions stated or referenced herein.
 *
 * If you do not agree to abide by these terms and
 * conditions, do not demonstrate your acceptance and do
 * not install or use the Program.
 * You should have received a copy of the license along
 * with this file. If not, see
 * <http://resources.spinalcom.com/licenses.pdf>.
 */

import moment = require('moment');
import {
  SpinalContext,
  SpinalGraph,
  SpinalGraphService,
  SpinalNode,
  SpinalNodeRef,
  SPINAL_RELATION_PTR_LST_TYPE,
} from 'spinal-env-viewer-graph-service';

import type OrganConfigModel from '../../model/OrganConfigModel';

import serviceDocumentation, {
  attributeService,
} from 'spinal-env-viewer-plugin-documentation-service';

import { bus, WebhookEvent } from '../../utils/bus';

import { ClientApi } from '../../services/client/ClientAuth';

import { serviceTicketPersonalized, spinalServiceTicket } from 'spinal-service-ticket';
import { ITicket } from '../../interfaces/api/ITicket';
import { TicketWebhookPayload } from '../../interfaces/api/IWebhook';
import { SpinalAttribute } from 'spinal-models-documentation';
import { ILocation } from '../../interfaces/api/ILocation';

/**
 * Main purpose of this class is to pull data from client.
 *
 * @export
 * @class SyncRunPull
 */
export class SyncRunPullApi {
  graph: SpinalGraph<any>;
  config: OrganConfigModel;
  interval: number;
  running: boolean;
  private apiClient: ClientApi;
  private spatialContextNode: SpinalNode<any>;
  private ticketContextNode: SpinalNode<any>;
  private ticketProcessNodeProprete: SpinalNode<any>;
  private ticketProcessNodePlomberie: SpinalNode<any>;
  private ticketProcessNodeElectricite: SpinalNode<any>;
  private ticketPropreteStepNodes: SpinalNodeRef[];
  private ticketPlomberieStepNodes: SpinalNodeRef[];
  private ticketElectriciteStepNodes: SpinalNodeRef[];

  private seenDeliveries = new Set<string>(); // basic idempotency
  private mappingSteps = new Map<string, 'NEW' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'>(); // map<stepName, clientStepName>
  private mappingTicketNames = new Map<string, { ticketName: string, processName: string }>();
  private mappingTicketNameToMYCategoryId = new Map<string, string>(); // map<MY ticket name, MY category id>
  private allStepNames = ['Attente de lect.avant Execution', 'Attente de réalisation', 'Réalisation partielle', 'Clôturée', 'Refusée']
  private allClientStepNames = ['NEW', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'COMPLETED']
  private ticketNamesProprete = ['Consommables', 'Propreté', 'Comptage de passage']
  private ticketNamesPlomberie = ["Fuite d'eau / Robinetterie"]
  private ticketNamesElectricite = ["Eclairage"]

  private roomNodes: SpinalNode<any>[] = [];

  private MYLocations: any[] = [];

  private currentlyPushingTickets = new Set<string>(); // guards against webhook race during syncPush







  constructor(graph: SpinalGraph<any>, config: OrganConfigModel) {
    this.graph = graph;
    this.config = config;
    this.running = false;
    this.apiClient = ClientApi.getInstance();
    this.mappingSteps.set('Attente de lect.avant Execution', 'NEW');
    this.mappingSteps.set('Attente de réalisation', 'PENDING');
    this.mappingSteps.set('Réalisation partielle', 'IN_PROGRESS');
    this.mappingSteps.set('Clôturée', 'COMPLETED');
    this.mappingSteps.set('Refusée', 'COMPLETED');

    this.mappingTicketNames.set('Consommables', { ticketName: 'CNP-Consommable sanitaires', processName: process.env.TICKET_PROCESS_PROPRETE });
    this.mappingTicketNames.set('Propreté', { ticketName: 'CNP-Problème propreté', processName: process.env.TICKET_PROCESS_PROPRETE });
    this.mappingTicketNames.set('Comptage de passage', { ticketName: 'CNP-Comptage de passage', processName: process.env.TICKET_PROCESS_PROPRETE });
    this.mappingTicketNames.set("Fuite d'eau / Robinetterie", { ticketName: "CNP-Fuite d'eau", processName: process.env.TICKET_PROCESS_PLOMBERIE });
    this.mappingTicketNames.set('Eclairage', { ticketName: "CNP-Défaut d'éclairage", processName: process.env.TICKET_PROCESS_ELEC });
    this.mappingTicketNames.set('Problème tablettes sanitaires', { ticketName: "CNP-Problème tablettes sanitaires", processName: process.env.TICKET_PROCESS_PROPRETE });
    //  This should not really be used since these tickets will never be created from MY but rather from Spinal, but we put it here for consistency and in case we want to create them from MY in the future
    this.mappingTicketNames.set('Poubelles - traitement des déchets', { ticketName: "CNP-Poubelles - traitement des déchets", processName: process.env.TICKET_PROCESS_PROPRETE });

    this.mappingTicketNameToMYCategoryId.set('Consommables sanitaires', '019a0b26-e3b3-71fc-98b7-991a1228178c');
    this.mappingTicketNameToMYCategoryId.set('Problème propreté', '019a0b27-0e95-708c-b91a-9a36f6855712');
    // this.mappingTicketNameToMYCategoryId.set('Comptage de passage', '019a0b27-0e95-708c-b91a-9a36f6855712');
    // this.mappingTicketNameToMYCategoryId.set("Fuite d'eau / Robinetterie", '019a0b27-6cdb-700b-a505-29b35a59aaf5');
    // this.mappingTicketNameToMYCategoryId.set('Eclairage', '019a0b27-a18f-7038-987f-3481e854da9e');
    this.mappingTicketNameToMYCategoryId.set('Poubelles - traitement des déchets', '019d956d-98b0-76c9-8f75-3d5d238fde54')



  }


  async getNodeFromTicket(
    ticketNode: SpinalNode
  ): Promise<SpinalNode | undefined> {
    const parentNodes = await ticketNode.getParents([
      'SpinalSystemServiceTicketHasTicket',
    ]);
    for (const parent of parentNodes) {
      if (
        !['SpinalSystemServiceTicketTypeStep', 'analyticOutputs'].includes(
          parent.info.type.get()
        )
      ) {
        return parent;
      }
    }

    return undefined;
  }


  async getSpatialContext(): Promise<SpinalNode<any>> {
    const contexts = await this.graph.getChildren();
    for (const context of contexts) {
      if (context.info.name.get() === 'spatial') {
        // @ts-ignore
        SpinalGraphService._addNode(context);
        return context;
      }
    }
    throw new Error('Spatial Context Not found');
  }

  private waitFct(nb: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(
        () => {
          resolve();
        },
        nb >= 0 ? nb : 0
      );
    });
  }

  async getTicketContext(): Promise<SpinalNode<any>> {
    const contexts = await this.graph.getChildren();
    for (const context of contexts) {
      if (context.info.name.get() === process.env.TICKET_CONTEXT_NAME) {
        // @ts-ignore
        SpinalGraphService._addNode(context);
        return context;
      }
    }
    throw new Error('Ticket Context Not found');
  }

  async getTicketProcess(processName): Promise<SpinalNode<any>> {
    const context = await this.getTicketContext();
    const processes = await context.getChildren(
      'SpinalSystemServiceTicketHasProcess'
    );
    const ticketProcess = processes.find((proc) => {
      // @ts-ignore
      SpinalGraphService._addNode(proc);
      return proc.getName().get() === processName;
    });
    if (!ticketProcess) {
      throw new Error('Ticket Process Not found');
    }
    return ticketProcess;
  }

  async getRoomNodes(): Promise<SpinalNode<any>[]> {
    const contexts = await this.graph.getChildren();
    const context = contexts.find((context) => {
      return context.getName().get() === process.env.ROOM_CONTEXT_NAME;
    })
    if (!context) {
      throw new Error('Room Context Not found');
    }
    const categories = await context.getChildren('hasCategory')
    const category = categories.find((cat) => {
      return cat.getName().get() === process.env.ROOM_CATEGORY_NAME;
    });
    if (!category) {
      throw new Error('Room Category Not found');
    }
    const groups = await category.getChildren('hasGroup');
    const group = groups.find((grp) => {
      return grp.getName().get() === process.env.ROOM_GROUP_NAME;
    });
    if (!group) {
      throw new Error('Room Group Not found');
    }

    const rooms = await group.getChildren('groupHasgeographicRoom')

    for (const room of rooms) {
      SpinalGraphService._addNode(room);
    }
    return rooms;


  }

  getRoomNodeFromLocationName(locationName: string): SpinalNode<any> {
    const roomNode = this.roomNodes.find((room) => {
      return room.getName().get().includes(locationName);
    });
    if (!roomNode) {
      //console.warn(`Room node not found for location name: ${locationName}`);
      return null;
    }
    return roomNode;
  }

  private getProcessNodeFromTicketName(ticketName: string): SpinalNode<any> {
    const processNode = [this.ticketProcessNodeProprete, this.ticketProcessNodePlomberie, this.ticketProcessNodeElectricite].find((node) => {
      return node.getName().get() === this.mappingTicketNames.get(ticketName)?.processName
    });

    if (!processNode) {
      console.warn(`Process node not found for ticket name: ${ticketName}, defaulting to Proprete process node.`);
      return this.ticketProcessNodeProprete;
    }

    return processNode;
  }

  private getStepsFromTicketName(ticketName: string): SpinalNodeRef[] {
    if (this.ticketNamesPlomberie.includes(ticketName)) {
      return this.ticketPlomberieStepNodes;
    }
    else if (this.ticketNamesElectricite.includes(ticketName)) {
      return this.ticketElectriciteStepNodes;
    }
    // default
    else {
      return this.ticketPropreteStepNodes;
    }
  }


  private onCreateTicket = async (evt: WebhookEvent<TicketWebhookPayload>) => {
    if (this.seenDeliveries.has(evt.deliveryId)) return;
    this.seenDeliveries.add(evt.deliveryId);
    const ticketMerciYanis: ITicket = evt.payload.data as ITicket; // full ticket on creation

    try {
      if (ticketMerciYanis.title.trim() === 'Comptage de passage') {
        console.log('Ignoring CREATE_TICKET for Comptage de passage');
        return;
      }

      // Skip if this ticket is being pushed by syncPush (race condition guard)
      const pushKey = `${ticketMerciYanis.title.trim()}|${ticketMerciYanis.location}`;
      if (this.currentlyPushingTickets.has(pushKey)) {
        console.log(`Ignoring CREATE_TICKET webhook for "${ticketMerciYanis.title}" — already being pushed by syncPush`);
        return;
      }

      const location_child = this.MYLocations.find(loc => loc._id === ticketMerciYanis.location);
      if (!location_child) {
        console.error(`Location with id ${ticketMerciYanis.location} not found in MYLocations.`);
        return;
      }

      const parent_location = this.MYLocations.find(loc => loc._id === location_child.parent);

      console.log('Handling CREATE_TICKET from bus:', ticketMerciYanis.title);

      const ticketInfo = {
        name: this.mappingTicketNames.get(ticketMerciYanis.title.trim())?.ticketName || ticketMerciYanis.title.trim(),
        description: ticketMerciYanis.description || '',
        MYId: ticketMerciYanis._id,
        MYNumber: ticketMerciYanis._number,
        date: moment(ticketMerciYanis._createdAt).format('YYYY-MM-DD HH:mm:ss'),
        location: parent_location.name,
        declarer_id: 'MerciYanis'
      };

      if (
        ['Propreté', 'Consommables'].includes(ticketMerciYanis.title.trim())
      ) {
        ticketInfo['gmaoId'] = -1;
      }

      const roomNode = this.getRoomNodeFromLocationName(ticketInfo.location);
      if (!roomNode) {
        return;
      }



      const ticketNodeId = await spinalServiceTicket.addTicket(
        ticketInfo,
        this.getProcessNodeFromTicketName(ticketMerciYanis.title.trim()).getId().get(),
        this.ticketContextNode.getId().get(),
        roomNode.getId().get()
      );
      console.log('Ticket created:', ticketNodeId);
    } catch (e) {
      console.error('CREATE_TICKET handler failed:', e);
      // optional: remove from seenDeliveries to allow retry logic
    }
  };

  /**
   * This function handles the UPDATE_TICKET webhook event.
   * It updates the corresponding ticket in Spinal if the status has changed
   */
  private onUpdateTicket = async (evt: WebhookEvent<TicketWebhookPayload>) => {
    if (this.seenDeliveries.has(evt.deliveryId)) return;
    this.seenDeliveries.add(evt.deliveryId);
    const payload: TicketWebhookPayload = evt.payload;
    const ticketMerciYanis: Partial<ITicket> = evt.payload.data; // only contains updated fields

    try {
      console.log(
        'Handling UPDATE_TICKET from bus:',
        evt.deliveryId,
        '| ID ticket :',
        payload._ticket
      );
      // console.log("CHANGED FIELDS:", ticketMerciYanis);
      const ticketStatus = ticketMerciYanis.status;
      if (!ticketStatus) {
        console.log('No status change detected, skipping update.');
        return;
      }
      const allTicketNodes = await this.ticketProcessNodeProprete.findInContextByType(this.ticketContextNode, 'SpinalSystemServiceTicketTypeTicket');
      const matchingNode = allTicketNodes.find((ticketNode) => {
        return ticketNode.info.MYId?.get() === payload._ticket;
      });
      if (!matchingNode) {
        throw new Error(`Ticket with MYId ${payload._ticket} not found.`);
      }
      if (matchingNode.getName().get().includes('Comptage de passage')) {
        return;
      }
      SpinalGraphService._addNode(matchingNode);

      const currentStepId = matchingNode.info.stepId.get();
      if (!currentStepId) {
        throw new Error(`Step information not found for ticket with MYId ${payload._ticket}.`);
      }
      const currentStep = this.ticketPropreteStepNodes.find((step) => {
        return step.id.get() === currentStepId;
      });

      const targetStep = this.ticketPropreteStepNodes.find((step) => {
        return step.name.get() === this.getSpinalStepFromClientStep(ticketStatus);
      });

      await spinalServiceTicket.moveTicket(
        matchingNode.getId().get(),
        currentStep.id.get(),
        targetStep.id.get(),
        this.ticketContextNode.getId().get()
      );

      console.log(
        'Ticket updated:',
        payload._ticket,
        ' to status:',
        targetStep.name.get()
      );
    } catch (e) {
      console.error('UPDATE_TICKET handler failed:', e);
      // optional: remove from seenDeliveries to allow retry logic
    }
  };

  private getSpinalStepFromClientStep(clientStepName: string): string {
    for (const [spinalStep, clientStep] of this.mappingSteps.entries()) {
      if (clientStep === clientStepName) return spinalStep;
    }
    return undefined;
  }

  checkTicketInfoObject(obj: { [key: string]: string }): boolean {
    return obj.hasOwnProperty('clientId') && obj.hasOwnProperty('stepId');
  }


  /**
   * This function updates MerciYanis when the ticket in hub is more up-to-date than in MY.
   * Requirement 1 : We have to be sure that the clientTicket recieved by this function is the most up-to-date
   * MY status for this ticket
   */
  private async updateMerciYanisTicketToCorrectStep(clientTicket: ITicket, matchingNode: SpinalNode<any>) {
    const stepId = matchingNode.info.stepId.get();

    const currentStep = this.getStepsFromTicketName(clientTicket.title).find((step) => {
      return step.id.get() === stepId;
    });

    // Check if client status is inferior to current step
    const currentStepIndex = this.allStepNames.indexOf(currentStep.name.get());
    const currentClientStepIndex = this.allClientStepNames.lastIndexOf(clientTicket.status);
    if (currentClientStepIndex === -1) {
      console.error(`Unknown client ticket status: ${clientTicket.status} for ticket ID: ${clientTicket._id}`);
      return;
    }

    if (currentClientStepIndex < currentStepIndex) {
      console.log(`Ticket (ID: ${clientTicket._id} | ${clientTicket._number}) 
        GMAO_ID : ${matchingNode.info.gmaoId?.get()} 
        SERVER_ID : ${matchingNode._serverId} 
        status in MerciYanis is behind the current step in Spinal 
        (${clientTicket.status} < ${currentStep.name.get()}). 
        Sending update to step ${this.mappingSteps.get(currentStep.name.get())}`);
      this.apiClient.updateTicket(clientTicket._id, { status: this.mappingSteps.get(currentStep.name.get()) });
    }

    return;
  }


  private getMyTicketNameFromSpinalName(spinalName: string): string | undefined {
    const entries = Array.from(this.mappingTicketNames.entries());
    for (const [myName, mapping] of entries) {
      if (mapping.ticketName === spinalName) return myName;
    }
    return undefined;
  }

  private getMYLocationIdFromRoomName(locationName: string): string | undefined {
    const parentLocation = this.MYLocations.find(loc => loc.name?.includes(locationName));
    // if (!parentLocation) return undefined;
    // return parentLocation._id;
    // // We need a child location under this parent to match the MY ticket structure
    const childLocation = this.MYLocations.find(loc => loc.parent === parentLocation._id);
    return childLocation?._id || parentLocation?._id || undefined;
  }

  private async syncPush() {
    const propreteTickets = await this.ticketProcessNodeProprete.findInContext(this.ticketContextNode, (node) => {
      return (node.getType().get() === 'SpinalSystemServiceTicketTypeTicket');
    });

    for (const ticket of propreteTickets) {
      const MYId = ticket.info.MYId?.get();
      if (MYId) continue; // ticket is already in MY

      //const creationDate = ticket.info.creationDate?.get();
      //if (creationDate && creationDate < Date.now() - (7 * 24 * 60 * 60 * 1000)) continue;

      const stepId = ticket.info.stepId?.get();
      const stepNodeRef = this.ticketPropreteStepNodes.find((step) => {
        return step.id.get() === stepId;
      });
      const stepName = stepNodeRef?.name.get();
      if (!stepName || ['Clôturée', 'Refusée'].includes(stepName)) continue;

      const elementOfTicket = await this.getNodeFromTicket(ticket);
      // if ticket attached to room node we fetch the MY location from the room name
      // if ticket attached to BIM object, we fetch the parent room then get the MY location from the room name.

      let locationName = undefined;
      let libelle = undefined;
      if (elementOfTicket && elementOfTicket.info.type.get() === 'geographicRoom') {
        locationName = elementOfTicket.getName().get().substring(0, 8);
        libelle = locationName;
      }
      if (elementOfTicket && elementOfTicket.info.type.get() === 'BIMObject') {
        const attr = await serviceDocumentation.findOneAttributeInCategory(elementOfTicket, 'REFERENTIEL', 'libelle');
        if (attr != -1) {
          libelle = attr.value.get();
        }

        const parentNodes = await elementOfTicket.getParentsInContext(this.spatialContextNode, 'hasBimObject');
        const roomNode = parentNodes.find((node) => {
          return node.info.type.get() === 'geographicRoom';
        });

        if (roomNode) {
          locationName = roomNode.getName().get().substring(0, 8);
        }
      }

      if (!locationName || !libelle) {
        console.warn(`syncPush: Could not determine location name for ticket ${ticket.getName().get()} (ID: ${ticket._server_id}))`);
        continue;
      }




      // Get the MY location ID from the room name
      const locationId = this.getMYLocationIdFromRoomName(locationName);
      if (!locationId) {
        console.warn(`syncPush: Could not find MY location for room name: ${locationName}`);
        continue;
      }

      // Reverse the CNP ticket name back to the MY ticket name
      const spinalTicketName = ticket.info.name.get();
      if (!spinalTicketName.startsWith('CNP-')) continue; // only sync tickets that follow the CNP naming convention

      const myTicketName = spinalTicketName.substring(4); // remove 'CNP-' prefix to get the MY ticket name to push

      if (!myTicketName) {
        console.warn(`syncPush: Could not find/process MY ticket name for Spinal name: ${spinalTicketName}`);
        continue;
      }

      // Get category ID from the ticket name
      const categoryId = this.mappingTicketNameToMYCategoryId.get(myTicketName);
      if (!categoryId) {
        console.warn(`syncPush: Could not find MY category for ticket name: ${myTicketName}`);
        continue;
      }



      // MY only allows ticket creation with status 'NEW' — we update to the target status right after
      const targetStatus = this.mappingSteps.get(stepName) || 'NEW';

      const ticketPayload = {
        title: myTicketName,
        category: categoryId,
        location: locationId,
        assignees: [],
        followers: [],
        externalFollowers: [],
        status: 'NEW',
        description: `${ticket.info.declarer_id?.get() || 'unknown declarer'} / Localisation : ${libelle} \n ${ticket.info.description?.get()}` || ''
      };

      const pushKey = `${myTicketName}|${locationId}`;
      this.currentlyPushingTickets.add(pushKey);
      try {
        console.log(`syncPush: Creating ticket in MY for Spinal ticket "${spinalTicketName}" with payload:`, ticketPayload);
        const created = await this.apiClient.createTicket(ticketPayload);
        console.log(`syncPush: Ticket created in MY (ID: ${created._id} | #${created._number}) for Spinal ticket: ${spinalTicketName}`);
        ticket.info.add_attr({
          MYId: created._id,
          MYNumber: created._number,
          date: moment(created._createdAt).format('YYYY-MM-DD HH:mm:ss'),
          location: locationName
        });
        await serviceDocumentation.createOrUpdateAttrsAndCategories(ticket, 'default',
          {
            'MYId': created._id,
            'MYNumber': '' + created._number,
            'date': moment(created._createdAt).format('YYYY-MM-DD HH:mm:ss'),
            'location': locationName
          }
        )

        // If the Spinal ticket is already past 'NEW', update the MY ticket to the correct status
        if (targetStatus !== 'NEW') {
          try {
            await this.apiClient.updateTicket(created._id, { status: targetStatus });
            console.log(`syncPush: Updated MY ticket ${created._id} to status ${targetStatus}`);
          } catch (e) {
            console.error(`syncPush: Failed to update status on MY ticket ${created._id}:`, e);
          }
        }
      } catch (e) {
        console.error(`syncPush: Failed to create ticket in MY for ${spinalTicketName}:`, e);
      } finally {
        this.currentlyPushingTickets.delete(pushKey);
      }
    }
  }



  /**
   * Sync tickets from API fetch
   * This function should check if tickets already exist in the database
   * If they do, update them (if need be), or create them.
   * As I see it, this function should be called only once at init then the rest is handled by webhooks
   * @param tickets Array of tickets fetched from API
   */
  private async syncFromFetch(tickets: ITicket[], updateOnly = false) {
    const propreteTickets = await this.ticketProcessNodeProprete.findInContext(this.ticketContextNode, (node) => {
      return (node.getType().get() === 'SpinalSystemServiceTicketTypeTicket' && node.info.MYId?.get() != undefined);
    });

    const plomberieTickets = await this.ticketProcessNodePlomberie.findInContext(this.ticketContextNode, (node) => {
      return (node.getType().get() === 'SpinalSystemServiceTicketTypeTicket' && node.info.MYId?.get() != undefined);
    });

    const electriciteTickets = await this.ticketProcessNodeElectricite.findInContext(this.ticketContextNode, (node) => {
      return (node.getType().get() === 'SpinalSystemServiceTicketTypeTicket' && node.info.MYId?.get() != undefined);
    });


    const allTicketNodes = [...propreteTickets, ...plomberieTickets, ...electriciteTickets];

    for (const clientTicket of tickets) {
      const matchingNode = allTicketNodes.find((ticketNode) => {
        return ticketNode.info.MYId?.get() === clientTicket._id;
      })
      if (matchingNode) {
        // console.log(`Ticket ${clientTicket.title} (ID: ${clientTicket._id}) already exists. Checking for updates...`);
        await this.updateMerciYanisTicketToCorrectStep(clientTicket, matchingNode);
        continue; // move to next ticket after handling the move
      }

      if (updateOnly) {
        continue;
      }

      // Ticket does not exist, create it
      // console.log(
      //   `Creating ticket from fetch: ${clientTicket.title} (ID: ${clientTicket._id})`
      // );
      const ticketInfo = {
        name: this.mappingTicketNames.get(clientTicket.title.trim())?.ticketName || clientTicket.title.trim(),
        description: clientTicket.description || '',
        MYId: clientTicket._id,
        MYNumber: clientTicket._number,
        date: moment(clientTicket._createdAt).format('YYYY-MM-DD HH:mm:ss'),
        location: clientTicket.location.parent.name,
        declarer_id: 'MerciYanis'
      };

      if (['Propreté', 'Consommables'].includes(clientTicket.title.trim())) {
        ticketInfo['gmaoId'] = -1;
      }

      try {
        const roomNode = this.getRoomNodeFromLocationName(ticketInfo.location);
        if (!roomNode) {
          continue;
        }
        const ticketNodeId = await spinalServiceTicket.addTicket(
          ticketInfo,
          this.getProcessNodeFromTicketName(clientTicket.title.trim()).getId().get(),
          this.ticketContextNode.getId().get(),
          roomNode.getId().get()
        );
        //console.log('Ticket created from fetch: ', ticketNodeId);
        if (typeof ticketNodeId !== 'string') {
          throw new Error('The spinal ticket creation did not return a valid ticket node id');
        }

        if (clientTicket.status != 'NEW') {
          await spinalServiceTicket.moveTicket(
            ticketNodeId,
            this.getStepsFromTicketName(clientTicket.title.trim())[0]?.id.get(),
            this.getStepsFromTicketName(clientTicket.title.trim()).find(step => step.name.get() === this.getSpinalStepFromClientStep(clientTicket.status))?.id.get(),
            this.ticketContextNode.getId().get()
          );
        }

      } catch (e) {
        console.error('Error creating ticket from fetch:', e);
      }
    }
  }

  async init(): Promise<void> {
    console.log('Initiating SyncRunPull');
    try {
      // Init useful nodes
      this.ticketContextNode = await this.getTicketContext();
      this.spatialContextNode = await this.getSpatialContext();
      this.ticketProcessNodeProprete = await this.getTicketProcess(
        process.env.TICKET_PROCESS_PROPRETE
      );
      this.ticketProcessNodePlomberie = await this.getTicketProcess(
        process.env.TICKET_PROCESS_PLOMBERIE
      );

      this.ticketProcessNodeElectricite = await this.getTicketProcess(
        process.env.TICKET_PROCESS_ELEC
      );

      this.ticketPropreteStepNodes = await spinalServiceTicket.getStepsFromProcess(
        this.ticketProcessNodeProprete.getId().get(),
        this.ticketContextNode.getId().get()
      );
      this.ticketPlomberieStepNodes = await spinalServiceTicket.getStepsFromProcess(
        this.ticketProcessNodePlomberie.getId().get(),
        this.ticketContextNode.getId().get()
      );
      this.ticketElectriciteStepNodes = await spinalServiceTicket.getStepsFromProcess(
        this.ticketProcessNodeElectricite.getId().get(),
        this.ticketContextNode.getId().get()
      );

      this.roomNodes = await this.getRoomNodes();


      bus.on('CREATE_TICKET', this.onCreateTicket);
      bus.on('UPDATE_TICKET', this.onUpdateTicket);

      // bus.on("DELETE_TICKET", this.onDeleteTicket)


      this.MYLocations = await this.apiClient.getAllLocations();
      const tickets = await this.apiClient.getAllTickets();
      const filteredTickets = tickets.filter(ticket => { // we only keep non 'Comptage de passage' tickets
        return ticket.title.trim() !== 'Comptage de passage';
      })
      console.log(`API tickets fetched: ${filteredTickets.length}`);

      await this.syncFromFetch(filteredTickets);

      await this.syncPush();
      this.config.lastSync.set(Date.now());
      console.log('Init DONE !');
    } catch (e) {
      console.error(e);
    }
  }

  async run(): Promise<void> {
    console.log('Starting run...');
    this.running = true;
    const timeout = parseInt(process.env.PULL_INTERVAL!);
    await this.waitFct(timeout);
    while (true) {
      if (!this.running) break;
      const before = Date.now();
      try {
        console.log('Run...');
        const tickets = await this.apiClient.getAllTickets();
        const filteredTickets = tickets.filter(ticket => { // we only keep non 'Comptage de passage' tickets
          return ticket.title.trim() !== 'Comptage de passage';
        })

        console.log(`API tickets fetched: ${filteredTickets.length}`);
        await this.syncFromFetch(filteredTickets, true);

        await this.syncPush();

        console.log('... Run finished !');
        this.config.lastSync.set(Date.now());
      } catch (e) {
        console.error(e);
        await this.waitFct(1000 * 60);
      } finally {
        const delta = Date.now() - before;
        const timeout = parseInt(process.env.PULL_INTERVAL!) - delta;
        await this.waitFct(timeout);
      }
    }
  }

  stop(): void {
    this.running = false;
  }
}
export default SyncRunPullApi;
