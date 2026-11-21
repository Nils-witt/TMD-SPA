import { useCallback, useSyncExternalStore } from 'react';
import { addressUrl } from './client';
import { probeAddressDirectory } from './address';
import { useResource } from './resource';

// GET /api/v1/connections: the API instance's connections to the external
// services it is configured with. The units server's is its live event stream
// (reloaded on the event type `units`), the others are probed by the API every
// 30 s (event type `connections`), so neither is polled here. The address
// directory is the exception: the browser calls it itself, so it probes it
// itself (useAddressConnection) and useConnections adds it to the list.
export const connectionsPath = '/api/v1/connections';

// pending: not checked yet since the API started.
export type ConnectionState = 'pending' | 'connected' | 'disconnected';

export type ServiceConnection = {
  service: string;
  state: ConnectionState;
  // When the API saw the state begin.
  since: string;
  // A short reason while a probed service is disconnected; null otherwise.
  error: string | null;
  // The service's release (or short commit); null when it tells none,
  // absent from an older API.
  version?: string | null;
};

export type ConnectionList = { connections: ServiceConnection[] };

// The service name of the address directory, as the API once reported it.
export const addressService = 'addresses';

// How often the shown address directory connection is checked.
const addressProbeInterval = 30_000;

// The browser's connection to address-serv, probed while any component shows
// it: one probe for all of them.
const addressProbe = (() => {
  let state: ServiceConnection | null = null;
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | null = null;

  const set = (next: ServiceConnection) => {
    state = next;
    listeners.forEach((l) => l());
  };

  const probe = () => {
    running ??= probeAddressDirectory()
      .then((error) => {
        const next = error === null ? 'connected' : 'disconnected';
        // since is when the state began, so a repeated one keeps it.
        const keep = state !== null && state.state === next;
        set({
          service: addressService,
          state: next,
          since: keep && state ? state.since : new Date().toISOString(),
          error,
          version: null,
        });
      })
      .finally(() => {
        running = null;
      });
    return running;
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        if (state === null) {
          state = {
            service: addressService,
            state: 'pending',
            since: '',
            error: null,
            version: null,
          };
        }
        void probe();
        timer = setInterval(() => void probe(), addressProbeInterval);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) clearInterval(timer);
      };
    },
    state: () => state,
    probe,
  };
})();

const noSubscribe = () => () => undefined;
const noState = () => null;

// The browser's connection to address-serv; null without one configured.
export function useAddressConnection(): ServiceConnection | null {
  const configured = addressUrl('') !== null;
  return useSyncExternalStore(
    configured ? addressProbe.subscribe : noSubscribe,
    configured ? addressProbe.state : noState,
  );
}

// The API's connections with the browser's own to the address directory in
// place of the one an older API still reports.
export function mergeConnections(
  api: ServiceConnection[] | undefined,
  address: ServiceConnection | null,
): ServiceConnection[] | undefined {
  if (address === null) return api;
  return [...(api ?? []).filter((c) => c.service !== addressService), address];
}

// Not kept offline: a stored copy would show states that no longer hold.
export function useConnections() {
  const api = useResource<ConnectionList>(connectionsPath, undefined, { persist: false });
  const address = useAddressConnection();
  const { reload: reloadApi } = api;
  const reload = useCallback(async () => {
    await Promise.all([reloadApi(), addressUrl('') !== null ? addressProbe.probe() : null]);
  }, [reloadApi]);
  const connections = mergeConnections(api.data?.connections, address);
  return { ...api, data: connections && { connections }, reload };
}

const serviceLabels: Record<string, string> = {
  units: 'Units server',
  addresses: 'Address directory',
  tiles: 'Tile server',
  pdf: 'PDF export (Gotenberg)',
};

// A service added to the API later shows its name.
export const serviceLabel = (service: string) => serviceLabels[service] ?? service;

// good: every service connected; degraded: some disconnected; failed: all
// disconnected; pending: none disconnected, some not checked yet.
export type ConnectionsLevel = 'good' | 'pending' | 'degraded' | 'failed';

export function summarizeConnections(connections: ServiceConnection[]): ConnectionsLevel {
  const down = connections.filter((c) => c.state === 'disconnected').length;
  if (down > 0) return down === connections.length ? 'failed' : 'degraded';
  return connections.some((c) => c.state === 'pending') ? 'pending' : 'good';
}
