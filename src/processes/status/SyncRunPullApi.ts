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

import { spinalServiceTicket } from 'spinal-service-ticket';
import { ITicket } from '../../interfaces/api/ITicket';
import { TicketWebhookPayload } from '../../interfaces/api/IWebhook';
import { SpinalAttribute } from 'spinal-models-documentation';

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
  ticketContextNode: SpinalNode<any>;
  ticketProcessNode: SpinalNode<any>;
  // ticketStepNewNode: SpinalNodeRef;
  // ticketStepInProgressNode: SpinalNodeRef;
  // ticketStepCompletedNode: SpinalNodeRef;

  ticketStepNodes: SpinalNodeRef[];
  private seenDeliveries = new Set<string>(); // basic idempotency
  private mappingSteps = new Map<string, 'NEW' | 'IN_PROGRESS' | 'COMPLETED'>(); // map<stepName, clientStepName>

  constructor(graph: SpinalGraph<any>, config: OrganConfigModel) {
    this.graph = graph;
    this.config = config;
    this.running = false;
    this.apiClient = ClientApi.getInstance();
    this.mappingSteps.set('Attente de lect.avant Execution', 'NEW');
    this.mappingSteps.set('Attente de réalisation', 'IN_PROGRESS');
    this.mappingSteps.set('Clôturée', 'COMPLETED');
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

  // Handler
  private onCreateTicket = async (evt: WebhookEvent<TicketWebhookPayload>) => {
    if (this.seenDeliveries.has(evt.deliveryId)) return;
    this.seenDeliveries.add(evt.deliveryId);
    const ticketMerciYanis: ITicket = evt.payload.data as ITicket; // full ticket on creation

    try {
      console.log('Handling CREATE_TICKET from bus:', ticketMerciYanis.title);
      const ticketInfo = {
        name: `${ticketMerciYanis.title}`,
        description: ticketMerciYanis.description,
        clientId: ticketMerciYanis._id,
        clientNumber: ticketMerciYanis._number,
        date: moment(ticketMerciYanis._createdAt).format('YYYY-MM-DD HH:mm:ss'),
        location: ticketMerciYanis.location,
      };

      console.log('Creating ticket ...');
      const ticketNode = await spinalServiceTicket.addTicket(
        ticketInfo,
        this.ticketProcessNode.getId().get(),
        this.ticketContextNode.getId().get(),
        process.env.TMP_SPINAL_NODE_ID
      );
      console.log('Ticket created:', ticketNode);
      this.config.lastSync.set(Date.now());
    } catch (e) {
      console.error('CREATE_TICKET handler failed:', e);
      // optional: remove from seenDeliveries to allow retry logic
    }
  };

  //In reality this function should not be called, as tickets are updated on Mission side
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
      const allTicketNodes = await this.ticketProcessNode.findInContextByType(this.ticketContextNode, 'SpinalSystemServiceTicketTypeTicket');
      const allTicketNodesInfo = await Promise.all(allTicketNodes.map( async (node) => {
      const attrs = await serviceDocumentation.getAttributesByCategory(node, 'default');
      return {
        node: node,
        info: attrs
      }
    }));
      const {node :matchingNode, info :matchingNodeInfo} = allTicketNodesInfo.find((ticketNode) => {
        const clientId = ticketNode.info.find((attr) => attr.label.get() === 'clientId');
        return clientId?.value.get() === payload._ticket;
      });
      if (!matchingNode) {
        throw new Error(`Ticket with clientId ${payload._ticket} not found.`);
      }
      SpinalGraphService._addNode(matchingNode);
      console.log('matchingNode:', matchingNode.getName().get());

      const stepInfo = matchingNodeInfo.find((attr) => attr.label.get() === 'stepId');
      if (!stepInfo) {
        throw new Error(`Step information not found for ticket with clientId ${payload._ticket}.`);
      }
      const currentStep = this.ticketStepNodes.find((step) => {
        return step.id.get() === stepInfo?.value.get();
      });

      const targetStep = this.ticketStepNodes.find((step) => {
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

      this.config.lastSync.set(Date.now());
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

  private convertSpinalAttributesToOject(attrs: SpinalAttribute[]): { [key: string]: string } {
    const obj = {};
    for(const attr of attrs) {
      obj[attr.label.get()] = attr.value.get();
    }
    return obj;
  }

  checkTicketInfoObject(obj: { [key: string]: string }): boolean {
    return obj.hasOwnProperty('clientId') && obj.hasOwnProperty('stepId');
  }
  

  /**
   *  Get the spinal ticket node that matches the client ticket id
   */
  private getMatchingTicketNode(clientTicketId: string , allSpinalTickets : {node : SpinalNode<any> , info : { [key: string]: string }}[]): {node : SpinalNode<any> , info : { [key: string]: string }} | undefined {
    for(const spinalTicket of allSpinalTickets) {
      if (spinalTicket.info['clientId'] === clientTicketId) {
        
        return {node: spinalTicket.node, info: spinalTicket.info};
      }
    }
    return undefined;
  }


 private async moveTicketToCorrectStep(clientTicket: ITicket, matchingNode: SpinalNode<any>, matchingNodeInfo: { [key: string]: string }) {
    const stepId = matchingNodeInfo['stepId'];
    const currentStep = this.ticketStepNodes.find((step) => {
      return step.id.get() === stepId;
    });

    if(currentStep.name.get() == this.getSpinalStepFromClientStep(clientTicket.status)){
      // Ticket is already in the correct step, no action needed
      console.log(`Ticket ${clientTicket.title} (ID: ${clientTicket._id}) is already in the correct step ${currentStep.name.get()}.`);
      return;
    }
    if(currentStep.name.get() == 'Attente de lect.avant Execution' && clientTicket.status !== this.mappingSteps.get('Attente de lect.avant Execution')) {
      //this.apiClient.updateTicket(clientTicket._id, {status: this.mappingSteps.get('Attente de lect.avant Execution')});
      return;
    }
    if(currentStep.name.get() == 'Attente de réalisation' && clientTicket.status !== this.mappingSteps.get('Attente de réalisation')) {
      //this.apiClient.updateTicket(clientTicket._id, {status: this.mappingSteps.get('Attente de réalisation')});
      return;
    }
    if(currentStep.name.get() == 'Clôturée' && clientTicket.status !== this.mappingSteps.get('Clôturée')) {
      //this.apiClient.updateTicket(clientTicket._id, {status: this.mappingSteps.get('Clôturée')});
      return;
      
    }

    // if we reach here, it means the ticket exists but is in a different step than expected (This situation is not normal, could it be it was moved manually ? idk)
    console.log(`Moving ticket ${clientTicket.title} (ID: ${clientTicket._id}) from step ${currentStep.getName().get()} to ${this.getSpinalStepFromClientStep(clientTicket.status)}`);
    const targetStepNode = this.ticketStepNodes.find((step) => {
      return step.name.get() === this.getSpinalStepFromClientStep(clientTicket.status);
    });
    if (!targetStepNode) {
      console.error(`Target step ${this.getSpinalStepFromClientStep(clientTicket.status)} not found for ticket ${clientTicket.title} (ID: ${clientTicket._id})`);
      return;
    }
    try {
      SpinalGraphService._addNode(matchingNode);
      await spinalServiceTicket.moveTicket(
        matchingNode.getId().get(),
        currentStep.id.get(),
        targetStepNode.id.get(),
        this.ticketContextNode.getId().get()
      );
      console.log(`Ticket ${clientTicket.title} (ID: ${clientTicket._id}) moved successfully.`);
    } catch (e) {
      console.error(`Error moving ticket ${clientTicket.title} (ID: ${clientTicket._id}):`, e);
    }
  }


  /**
   * Sync tickets from API fetch
   * This function should check if tickets already exist in the database
   * If they do, update them (if need be), or create them.
   * As I see it, this function should be called only once at init then the rest is handled by webhooks
   * @param tickets Array of tickets fetched from API
   */
  private async syncFromFetch(tickets: ITicket[]) {

    const allTicketNodes = await this.ticketProcessNode.findInContextByType(this.ticketContextNode, 'SpinalSystemServiceTicketTypeTicket');
    const allTicketNodesInfo = await Promise.all(allTicketNodes.map( async (node) => {
      const attrs = await serviceDocumentation.getAttributesByCategory(node, 'default');
      return {
        node: node,
        info: this.convertSpinalAttributesToOject(attrs)
      }
    }));
    for (const clientTicket of tickets) {
      const {node :matchingNode, info :matchingNodeInfo} = this.getMatchingTicketNode(clientTicket._id, allTicketNodesInfo) || {node: undefined, info: undefined};
      if (matchingNode) {
        console.log(`Ticket ${clientTicket.title} (ID: ${clientTicket._id}) already exists. Checking for updates...`);
        await this.moveTicketToCorrectStep(clientTicket, matchingNode, matchingNodeInfo);
        continue; // move to next ticket after handling the move
      }

      // Ticket does not exist, create it
      console.log(
        `Creating ticket from fetch: ${clientTicket.title} (ID: ${clientTicket._id})`
      );
      const ticketInfo = {
        name: `${clientTicket.title}`,
        description: clientTicket.description,
        clientId: clientTicket._id,
        clientNumber: clientTicket._number,
        date: moment(clientTicket._createdAt).format('YYYY-MM-DD HH:mm:ss'),
        location: clientTicket.location,
      };
    
      try {
        const ticketNodeId = await spinalServiceTicket.addTicket(
          ticketInfo,
          this.ticketProcessNode.getId().get(),
          this.ticketContextNode.getId().get(),
          process.env.TMP_SPINAL_NODE_ID
        );
        console.log('Ticket created from fetch:', ticketNodeId);
        await spinalServiceTicket.moveTicket(
          ticketNodeId,
          this.ticketStepNodes[0].id.get(), // assuming first step is 'NEW'
          this.ticketStepNodes.find(step => step.name.get() === this.getSpinalStepFromClientStep(clientTicket.status)).id.get(),
          this.ticketContextNode.getId().get()
        );

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
      this.ticketProcessNode = await this.getTicketProcess(
        process.env.TICKET_PROCESS_NAME
      );
      this.ticketStepNodes = await spinalServiceTicket.getStepsFromProcess(
        this.ticketProcessNode.getId().get(),
        this.ticketContextNode.getId().get()
      );
      

      // This code is temporary, in production we will load the rooms from a group
      const spatialContext = await this.getSpatialContext();
      const buildings = await spatialContext.getChildren('hasGeographicBuilding');
      if (buildings.length === 0) {
        throw new Error('No building found in spatial context');
      }
      for(const building of buildings) {
        SpinalGraphService._addNode(building);
      }
      


      bus.on('CREATE_TICKET', this.onCreateTicket);
      bus.on('UPDATE_TICKET', this.onUpdateTicket);
      //bus.on("DELETE_TICKET", this.onDeleteTicket)

      // const tickets = await this.apiClient.getTickets();
      const tickets = await this.apiClient.getAllTickets();
      console.log(`API tickets fetched: ${tickets.length}`);
      await this.syncFromFetch(tickets);

      // const locations = await this.apiClient.getLocations();
      // console.log(locations);
      this.config.lastSync.set(Date.now());
      console.log('Init DONE !');
    } catch (e) {
      console.error(e);
    }
  }

  async run(): Promise<void> {
    console.log('Starting run...');
    this.running = true;
    const timeout = parseInt(process.env.PULL_INTERVAL);
    await this.waitFct(timeout);
    while (true) {
      if (!this.running) break;
      const before = Date.now();
      try {
        console.log('Run...');

        console.log('... Run finished !');
        this.config.lastSync.set(Date.now());
      } catch (e) {
        console.error(e);
        await this.waitFct(1000 * 60);
      } finally {
        const delta = Date.now() - before;
        const timeout = parseInt(process.env.PULL_INTERVAL) - delta;
        await this.waitFct(timeout);
      }
    }
  }

  stop(): void {
    this.running = false;
  }
}
export default SyncRunPullApi;
