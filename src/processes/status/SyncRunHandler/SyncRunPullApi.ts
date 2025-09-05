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

import type OrganConfigModel from '../../../model/OrganConfigModel';

import serviceDocumentation, { attributeService } from 'spinal-env-viewer-plugin-documentation-service';


import { ClientApi } from '../../../services/client/ClientAuth';



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



  async init(): Promise<void> {
    console.log('Initiating SyncRunPull');
    try {
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
