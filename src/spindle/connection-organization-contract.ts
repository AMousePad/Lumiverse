import type { ConnectionOrganizationAPI, ConnectionOrganizationKind, ConnectionOrganizationSnapshot, ConnectionOrganizationError } from '../shared/connection-organization';
export interface BackendOrganizationOptions { kind: ConnectionOrganizationKind; userId?: string }
export interface BackendOrganizationAPI {
  get(options: BackendOrganizationOptions): Promise<ConnectionOrganizationSnapshot>;
  watch(options: BackendOrganizationOptions, handler: Parameters<ConnectionOrganizationAPI['watch']>[1],
    onError?: (error: ConnectionOrganizationError) => void): () => void;
}
export type OrganizationWorkerMessage =
  | { type: 'connection_organization_get'; requestId: string; options: BackendOrganizationOptions }
  | { type: 'connection_organization_watch'; requestId: string; subscriptionId: string; options: BackendOrganizationOptions }
  | { type: 'connection_organization_unwatch'; subscriptionId: string };
export type OrganizationHostMessage = { type: 'connection_organization_snapshot'; subscriptionId: string;
  snapshot?: ConnectionOrganizationSnapshot; error?: string };
