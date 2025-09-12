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

import serviceDocumentation, { attributeService } from 'spinal-env-viewer-plugin-documentation-service';

import { bus, WebhookEvent } from "../../utils/bus";

import { ClientApi } from '../../services/client/ClientAuth';

import { spinalServiceTicket } from 'spinal-service-ticket';
import { ITicket } from '../../interfaces/api/ITicket';
import { TicketWebhookPayload } from '../../interfaces/api/IWebhook';


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
  typologies : any =  [];

  private seenDeliveries = new Set<string>(); // basic idempotency

  constructor(
    graph: SpinalGraph<any>,
    config: OrganConfigModel
  ) {
    this.graph = graph;
    this.config = config;
    this.running = false;
    this.apiClient = ClientApi.getInstance();
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
    const processes = await context.getChildren('SpinalSystemServiceTicketHasProcess');
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
    const ticketMerciYanis : ITicket = evt.payload.data as ITicket; // full ticket on creation

    try {
      console.log("Handling CREATE_TICKET from bus:", ticketMerciYanis.title);
      const ticketContext = await this.getTicketContext();
      const ticketProcess = await this.getTicketProcess(process.env.TICKET_PROCESS_DI_NAME);
      const ticketInfo = {
        name : `${ticketMerciYanis.title}`,
        description: ticketMerciYanis.description,
        clientId: ticketMerciYanis._id,
        clientNumber: ticketMerciYanis._number,
        date: moment(ticketMerciYanis._createdAt).format('YYYY-MM-DD HH:mm:ss'),
        location: ticketMerciYanis.location,

      };
      console.log('Creating ticket ...');
        const ticketNode = await spinalServiceTicket.addTicket(
          ticketInfo,
          ticketProcess.getId().get(),
          ticketContext.getId().get(),
          process.env.TMP_SPINAL_NODE_ID
        );
        console.log('Ticket created:', ticketNode);
      this.config.lastSync.set(Date.now());
      
    } catch (e) {
      console.error("CREATE_TICKET handler failed:", e);
      // optional: remove from seenDeliveries to allow retry logic
    }
  };

  private onUpdateTicket = async (evt: WebhookEvent<TicketWebhookPayload>) => {
    if (this.seenDeliveries.has(evt.deliveryId)) return;
    this.seenDeliveries.add(evt.deliveryId);
    const ticketMerciYanis : Partial<ITicket> = evt.payload.data; // only contains updated fields
    const payload : TicketWebhookPayload = evt.payload;

    try {
      console.log("Handling UPDATE_TICKET from bus:", evt.deliveryId);
      const ticketContext = await this.getTicketContext();
      const ticketProcess = await this.getTicketProcess(process.env.TICKET_PROCESS_DI_NAME);
      const ticketStatus = ticketMerciYanis.status;

      
      const steps = await spinalServiceTicket.getStepsFromProcess(ticketProcess.getId().get(),ticketContext.getId().get());
      const step_NEW = steps.find(step => step.getName().get() === 'NEW');
      const step_IN_PROGRESS = steps.find(step => step.getName().get() === 'IN PROGRESS');
      const step_COMPLETED = steps.find(step => step.getName().get() === 'COMPLETED');

      // !! If ticket doesn't exist maybe create it ? -- or let the pulling do it ? 
      if (!step_NEW || !step_IN_PROGRESS || !step_COMPLETED) {
        throw new Error('One or more required steps (NEW, IN PROGRESS, COMPLETED) not found in the ticket process.');
      }
      const newTicketNodes = await step_NEW.getChildren('SpinalSystemServiceTicketHasTicket');
      const inProgressTicketNodes = await step_IN_PROGRESS.getChildren('SpinalSystemServiceTicketHasTicket');
      const completedTicketNodes = await step_COMPLETED.getChildren('SpinalSystemServiceTicketHasTicket');
      const allTicketNodes = [...newTicketNodes, ...inProgressTicketNodes, ...completedTicketNodes];


      const ticketNode = allTicketNodes.find(async (ticketNode) => {
        ticketNode.info.clientId = ticketMerciYanis._id 
      });
      if (!ticketNode) {
        throw new Error(`Ticket with clientId ${ticketMerciYanis._id} not found.`);
      };

      const currentStep = steps.find(step => {
        return step.getId().get() === ticketNode.info.stepId.get();
      });

      const targetStep = steps.find(step => {
        step.getName().get() === ticketStatus
      });

      await spinalServiceTicket.moveTicket(ticketNode.getId().get(),currentStep.getId().get(),targetStep.getId().get(), ticketContext.getId().get());

      console.log('Ticket updated:', ticketMerciYanis._id , " to status:", ticketStatus);

      this.config.lastSync.set(Date.now());
      
    } catch (e) {
      console.error("UPDATE_TICKET handler failed:", e);
      // optional: remove from seenDeliveries to allow retry logic
    }
  };

  async init(): Promise<void> {
    console.log('Initiating SyncRunPull');
    try {

      bus.on("CREATE_TICKET", this.onCreateTicket);
      bus.on("UPDATE_TICKET", this.onUpdateTicket);
      //bus.on("DELETE_TICKET", this.onDeleteTicket)
      
      //const locations = await this.apiClient.getLocations();
      //console.log(locations);
      this.config.lastSync.set(Date.now());
      console.log('Init DONE !')
    } catch (e) {
      console.error(e);
    }
  }

  async run(): Promise<void> {
    console.log("Starting run...")
    this.running = true;
    const timeout = parseInt(process.env.PULL_INTERVAL)
    await this.waitFct(timeout);
    while (true) {
      if (!this.running) break;
      const before = Date.now();
      try {
        console.log("Run...");
        
        console.log("... Run finished !")
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
