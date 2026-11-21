import { useEffect, useSyncExternalStore } from 'react';
import {
  applyServiceUrls,
  request,
  serviceUrlsVersion,
  subscribeServiceUrls,
  type ServiceUrlSettings,
} from './client';
import type { Timestamp } from './entity';
import { useResource } from './resource';

// Where the SPA finds address-serv and the tile server, set by the admin group
// in the API and readable by everyone. An empty URL leaves config.json's; an
// empty mTLS URL is the OIDC one.
export type ServiceUrls = ServiceUrlSettings & {
  created_at?: Timestamp;
  created_by?: string;
  updated_at?: Timestamp;
  updated_by?: string;
};

export const serviceUrlsPath = '/api/v1/service-urls';

// Kept offline like other resources, so an offline start still finds the
// services.
export const useServiceUrls = () => useResource<ServiceUrls>(serviceUrlsPath);

export const serviceUrlsApi = {
  replace: (u: ServiceUrlSettings) =>
    request<ServiceUrls>(serviceUrlsPath, { method: 'PUT', body: JSON.stringify(u) }),
};

// Applies the API's URLs to client.ts while signed in (mounted in both
// shells); an older API without them (404) keeps config.json's.
export function ServiceUrlsSync() {
  const { data } = useServiceUrls();
  useEffect(() => {
    applyServiceUrls(data);
  }, [data]);
  // Signing out (the shell unmounts) leaves config.json's again.
  useEffect(() => () => applyServiceUrls(undefined), []);
  return null;
}

// Re-renders the caller when a service URL changes.
export function useServiceUrlsVersion(): number {
  return useSyncExternalStore(subscribeServiceUrls, serviceUrlsVersion);
}
