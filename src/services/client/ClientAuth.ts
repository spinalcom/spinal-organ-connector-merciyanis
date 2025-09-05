import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import fs from 'fs';
import path from 'path';
import { ILocationResponse } from '../../interfaces/api/ILocationResponse';
import { ITicketResponse } from '../../interfaces/api/ITicketResponse';


interface TokenData {
  accessToken: string;
  expireAt: number;                 // ms epoch
  refreshToken: string;
  refreshTokenExpiration: string;   // ISO string
}

export class ClientApi {
  private static instance: ClientApi;

  private axios: AxiosInstance;
  private tokenPath: string;

  private accessToken?: string;
  private expireAt?: number;
  private refreshToken?: string;
  private refreshTokenExpiration?: string;

  // single-flight locks
  private ensurePromise?: Promise<void>;
  private refreshPromise?: Promise<void>;

  private static readonly SKEW_MS = 90_000; // refresh 90s early

  private constructor() {
    const baseURL = `${process.env.CLIENT_API_BASE_URL}/${process.env.CLIENT_API_VERSION}`;
    if (!process.env.CLIENT_API_BASE_URL || !process.env.CLIENT_API_VERSION) {
      throw new Error('Missing CLIENT_API_BASE_URL/CLIENT_API_VERSION');
    }
    if (!process.env.CLIENT_API_WORKSPACE || !process.env.CLIENT_API_USER_AGENT) {
      throw new Error('Missing CLIENT_API_WORKSPACE/CLIENT_API_USER_AGENT');
    }
    if (!process.env.CLIENT_API_KEY) {
      // needed for first-time generate
      throw new Error('Missing CLIENT_API_KEY');
    }

    this.axios = axios.create({ baseURL });
    this.tokenPath = path.resolve(process.cwd(), 'merciyanis_token.json');
    this.loadTokenFromFile();

    // Attach common headers & auth automatically
    this.axios.interceptors.request.use((cfg) => {
      cfg.headers = cfg.headers ?? {};
      cfg.headers['X-MerciYanis-Workspace'] = process.env.CLIENT_API_WORKSPACE!;
      cfg.headers['User-Agent'] = process.env.CLIENT_API_USER_AGENT!;
      if (this.accessToken) {
        cfg.headers['Authorization'] = `Bearer ${this.accessToken}`;
      }
      return cfg;
    });
  }

  public static getInstance(): ClientApi {
    if (!ClientApi.instance) ClientApi.instance = new ClientApi();
    return ClientApi.instance;
  }

  private loadTokenFromFile() {
    if (!fs.existsSync(this.tokenPath)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.tokenPath, 'utf-8')) as TokenData;
      this.accessToken = data.accessToken;
      this.expireAt = data.expireAt;
      this.refreshToken = data.refreshToken;
      this.refreshTokenExpiration = data.refreshTokenExpiration;
      console.log('Token loaded from file');
    } catch (e) {
      console.error('Error reading token file:', e);
    }
  }

  private saveTokenToFile() {
    const data: TokenData = {
      accessToken: this.accessToken!,
      expireAt: this.expireAt!,
      refreshToken: this.refreshToken!,
      refreshTokenExpiration: this.refreshTokenExpiration!,
    };
    try {
      // atomic-ish write
      const tmp = `${this.tokenPath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data), { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(tmp, this.tokenPath);
    } catch (e) {
      console.error('Error writing token file:', e);
    }
  }

  private async generateToken(): Promise<void> {
    console.log('Generating new token ...');
    const body = { secret: process.env.CLIENT_API_KEY! };
    const cfg: AxiosRequestConfig = {
      headers: { 'Content-Type': 'application/json' },
    };
    const r = await this.axios.post('/auth/token', body, cfg);
    this.accessToken = r.data.accessToken;
    this.expireAt = Date.now() + r.data.expiresIn * 1000;
    this.refreshToken = r.data.refreshToken;
    this.refreshTokenExpiration = r.data.refreshTokenExpiration;
    this.saveTokenToFile();
    console.log('Generating token ... Done!');
  }

  private async refreshTokenFlow(): Promise<void> {
    if (!this.refreshToken) {
      await this.generateToken();
      return;
    }
    // If we kept the ISO timestamp, optionally check it:
    if (this.refreshTokenExpiration && Date.parse(this.refreshTokenExpiration) <= Date.now()) {
      console.warn('Refresh token expired, generating a new access token.');
      await this.generateToken();
      return;
    }

    console.log('Refreshing token ...');
    const body = { refreshToken: this.refreshToken };
    const cfg: AxiosRequestConfig = {
      headers: { 'Content-Type': 'application/json' },
    };
    try {
      const r = await this.axios.post('/auth/token/refresh', body, cfg);
      this.accessToken = r.data.accessToken;
      this.expireAt = Date.now() + r.data.expiresIn * 1000;
      this.refreshToken = r.data.refreshToken;
      this.refreshTokenExpiration = r.data.refreshTokenExpiration;
      this.saveTokenToFile();
      console.log('Refreshing token ... Done!');
    } catch (e: any) {
      const status = e?.response?.status;
      console.warn('Refresh failed, status:', status, '— generating a new token.');
      await this.generateToken();
    }
  }

  private isExpiringSoon(): boolean {
    if (!this.expireAt) return true;
    return Date.now() + ClientApi.SKEW_MS >= this.expireAt;
  }

  private async ensureTokenValid(): Promise<void> {
    if (!this.ensurePromise) {
      this.ensurePromise = (async () => {
        if (!this.accessToken) {
          await this.generateToken();
        } else if (this.isExpiringSoon()) {
          // de-dupe refreshes
          if (!this.refreshPromise) {
            this.refreshPromise = this.refreshTokenFlow().finally(() => {
              this.refreshPromise = undefined;
            });
          }
          await this.refreshPromise;
        }
      })().finally(() => {
        this.ensurePromise = undefined;
      });
    }
    await this.ensurePromise;
  }

  private async getWithRetry<T>(url: string): Promise<T> {
    await this.ensureTokenValid();
    try {
      const r = await this.axios.get<T>(url);
      return r.data;
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 401) {
        // token may be invalid -> refresh/generate then retry once
        await this.refreshTokenFlow();
        const r2 = await this.axios.get<T>(url);
        return r2.data;
      }
      // bubble up with more context
      const body = e?.response?.data;
      throw new Error(`GET ${url} failed: ${status ?? 'no-status'} ${JSON.stringify(body ?? {})}`);
    }
  }

  async getTickets() {
    return this.getWithRetry<ITicketResponse>('/tickets');
  }

  async getLocations() {
    return this.getWithRetry<ILocationResponse>('/locations?fields=_id,name,parent,_parent2,_parent3,_parent4,_isDeleted');
  }
}
