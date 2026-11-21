import { useCallback, useSyncExternalStore } from 'react';
import { addressUrl, subscribeServiceUrls, tilesUrl } from './client';
import { probeAddressDirectory } from './address';
import { probeTileServer } from './maps';
import { useResource } from './resource';
import { useServiceUrlsVersion } from './serviceUrls';

// GET /api/v1/connections: the API instance's connections to the external
// services it is configured with. The units server's is its live event stream
// (reloaded on the event type `units`), the others are probed by the API every
// 30 s (event type `connections`), so neither is polled here. The address
// directory and the tile server are the exceptions: the browser calls them
// itself, so it probes them itself (useAddressConnection, useTilesConnection)
// and useConnections adds them to the list.
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

// The service name of the tile server, as the API once reported it.
export const tilesService = 'tiles';

// How often a shown browser-side connection is checked.
const probeInterval = 30_000;

type ProbeResult = { error: string | null; version: string | null };

// The browser's own connection to service, probed with check while any
// component shows it: one probe for all of them.
function createProbe(service: string, check: () => Promise<ProbeResult>) {
  let state: ServiceConnection | null = null;
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | null = null;

  const set = (next: ServiceConnection) => {
    state = next;
    listeners.forEach((l) => l());
  };

  const probe = () => {
    running ??= check()
      .then(({ error, version }) => {
        const next = error === null ? 'connected' : 'disconnected';
        // since is when the state began, so a repeated one keeps it.
        const keep = state !== null && state.state === next;
        set({
          service,
          state: next,
          since: keep && state ? state.since : new Date().toISOString(),
          error,
          // Kept while it is down, as the API does.
          version: version ?? state?.version ?? null,
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
          state = { service, state: 'pending', since: '', error: null, version: null };
        }
        void probe();
        timer = setInterval(() => void probe(), probeInterval);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) clearInterval(timer);
      };
    },
    state: () => state,
    probe,
    // Another URL: its state starts over, checked at once if shown.
    reset() {
      state =
        listeners.size > 0
          ? { service, state: 'pending', since: '', error: null, version: null }
          : null;
      listeners.forEach((l) => l());
      if (listeners.size > 0) void probe();
    },
  };
}

const addressProbe = createProbe(addressService, async () => ({
  error: await probeAddressDirectory(),
  version: null,
}));

const tilesProbe = createProbe(tilesService, () => probeTileServer());

subscribeServiceUrls(() => {
  addressProbe.reset();
  tilesProbe.reset();
});

const noSubscribe = () => () => undefined;
const noState = () => null;

function useProbe(probe: ReturnType<typeof createProbe>, configured: boolean) {
  useServiceUrlsVersion();
  return useSyncExternalStore(
    configured ? probe.subscribe : noSubscribe,
    configured ? probe.state : noState,
  );
}

// The browser's connection to address-serv; null without one configured.
export function useAddressConnection(): ServiceConnection | null {
  return useProbe(addressProbe, addressUrl('') !== null);
}

// The browser's connection to the tile server; null without one configured.
export function useTilesConnection(): ServiceConnection | null {
  return useProbe(tilesProbe, tilesUrl('') !== null);
}

// The API's connections with the browser's own (address directory, tile
// server) in place of the ones an older API still reports.
export function mergeConnections(
  api: ServiceConnection[] | undefined,
  ...own: (ServiceConnection | null)[]
): ServiceConnection[] | undefined {
  const mine = own.filter((c): c is ServiceConnection => c !== null);
  if (mine.length === 0) return api;
  const services = new Set(mine.map((c) => c.service));
  return [...(api ?? []).filter((c) => !services.has(c.service)), ...mine];
}

// Not kept offline: a stored copy would show states that no longer hold.
export function useConnections() {
  const api = useResource<ConnectionList>(connectionsPath, undefined, { persist: false });
  const address = useAddressConnection();
  const tiles = useTilesConnection();
  const { reload: reloadApi } = api;
  const reload = useCallback(async () => {
    await Promise.all([
      reloadApi(),
      addressUrl('') !== null ? addressProbe.probe() : null,
      tilesUrl('') !== null ? tilesProbe.probe() : null,
    ]);
  }, [reloadApi]);
  const connections = mergeConnections(api.data?.connections, address, tiles);
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
