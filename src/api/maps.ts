import { useMemo } from 'react';
import type { OverlayState } from '@/pages/dashboard/widgets/Map/overlayState';
import { useCollection } from './collection';
import { apiTarget, freshAuthHeaders, request, tilesUrl } from './client';
import type { EntityMeta } from './entity';
import { listFetcher } from './list';
import { useResource } from './resource';

// A basemap: url is a MapLibre style JSON, an absolute https URL the browser
// loads itself, without the token. Names are unique; at most one style is the
// default.
export type MapStyle = EntityMeta & {
  id: string;
  name: string;
  url: string;
  is_default: boolean;
};

export const mapStylesPath = '/api/v1/map-styles';

const fetchMapStyles = listFetcher<MapStyle>('map_styles');

// Shared through the resource cache, so the admin widget's reload after a
// write updates every map.
export const useMapStyles = () => useCollection(mapStylesPath, fetchMapStyles);

// Map widgets name their style by ID; an empty or deleted ID resolves to the
// default style, else the first. undefined only without styles.
export function resolveMapStyle(styles: readonly MapStyle[], id: string): MapStyle | undefined {
  return (
    styles.find((s) => id !== '' && s.id === id) ?? styles.find((s) => s.is_default) ?? styles[0]
  );
}

export type MapStyleInput = { name: string; url: string; is_default?: boolean };

// The writes need the admin group. Making a style the default clears the
// previous one.
export const mapStylesApi = {
  create: (input: MapStyleInput) =>
    request<MapStyle>(mapStylesPath, { method: 'POST', body: JSON.stringify(input) }),
  patch: (id: string, input: Partial<MapStyleInput>) =>
    request<MapStyle>(`${mapStylesPath}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    request<void>(`${mapStylesPath}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

// A map of the tile server (tileserve-go), drawn over the basemap. The browser
// loads the list, bounds and tiles from the tile server itself (tilesBaseUrl
// and mtlsTilesBaseUrl of config.json), which decides who sees which map.
export type Overlay = { id: string; name: string; description: string };

// enabled is false, and the list empty, without a tile server.
export type Overlays = { enabled: boolean; overlays: Overlay[] };

export type OverlayBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
  min_zoom: number;
  max_zoom: number;
};

// The version shown of each map: its current one.
const tileVersion = 'current';

// A JSON answer the tile server needs longer for is of no use to the map.
const tilesTimeout = 10_000;

export class TileServerError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'TileServerError';
    this.status = status;
  }
}

// With OIDC the tile server gets the user's token and no cookies; behind the
// mTLS proxy the client certificate, which a browser only presents
// cross-origin with credentials.
export async function tilesAuth(): Promise<Pick<RequestInit, 'credentials' | 'headers'>> {
  return apiTarget() === 'mtls'
    ? { credentials: 'include', headers: {} }
    : { credentials: 'omit', headers: await freshAuthHeaders() };
}

// A GET of the tile server. Throws TileServerError (status 0 without a tile
// server), or what fetch throws.
async function tilesFetch(path: string, signal?: AbortSignal): Promise<Response> {
  const url = tilesUrl(path);
  if (url === null) throw new TileServerError(0, 'no tile server configured');
  const timeout = AbortSignal.timeout(tilesTimeout);
  const { credentials, headers } = await tilesAuth();
  const res = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    credentials,
    headers: { Accept: 'application/json', ...headers },
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new TileServerError(
      res.status,
      res.status === 404 ? 'overlay not found' : `the tile server answered ${res.status}`,
    );
  }
  return res;
}

const tilesJson = async <T>(path: string) => (await (await tilesFetch(path)).json()) as T;

// A map as the tile server lists it.
type TileMap = { uuid: string; name: string; description?: string; currentVersion?: string };

// Maps without a current version have no tiles to show and are left out; the
// rest sorted by name, ignoring case.
export function toOverlays(maps: readonly TileMap[]): Overlay[] {
  return maps
    .filter((m) => m.currentVersion)
    .map((m) => ({ id: m.uuid, name: m.name, description: m.description ?? '' }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

// The resource cache's key; the fetcher asks the tile server.
const overlaysKey = 'tiles:/maps';

const fetchOverlays = async (): Promise<Overlays> =>
  tilesUrl('') === null
    ? { enabled: false, overlays: [] }
    : { enabled: true, overlays: toOverlays(await tilesJson<TileMap[]>('/maps')) };

// Read from the tile server once per page load.
export function useOverlays() {
  const { data, error } = useResource<Overlays>(overlaysKey, fetchOverlays);
  return { overlays: data, error };
}

const mapPath = (id: string) => `/maps/${encodeURIComponent(id)}/version/${tileVersion}`;

// MapLibre requests the tiles itself; Map's transformRequest adds the
// credentials. null without a tile server.
export const overlayTileUrl = (id: string) => tilesUrl(`${mapPath(id)}/{z}/{x}/{y}.png`);

// Whether MapLibre's request for url goes to the tile server.
export function isTileServerUrl(url: string): boolean {
  const base = tilesUrl('/');
  return base !== null && url.startsWith(new URL(base, globalThis.location?.href).href);
}

type TileBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
  minZoom: number;
  maxZoom: number;
};

export const fetchOverlayBounds = async (id: string): Promise<OverlayBounds> => {
  const b = await tilesJson<TileBounds>(`${mapPath(id)}/bounds`);
  return {
    west: b.west,
    south: b.south,
    east: b.east,
    north: b.north,
    min_zoom: b.minZoom,
    max_zoom: b.maxZoom,
  };
};

// Checks the tile server's /version: null and its version if it answers,
// else a short reason.
export async function probeTileServer(
  signal?: AbortSignal,
): Promise<{ error: string | null; version: string | null }> {
  try {
    const v = (await (await tilesFetch('/version', signal)).json()) as {
      version?: string;
      commit?: string;
    };
    return { error: null, version: v.version || v.commit?.slice(0, 7) || null };
  } catch (err) {
    if (err instanceof TileServerError) {
      return { error: err.status === 0 ? err.message : `HTTP ${err.status}`, version: null };
    }
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return { error: 'no answer', version: null };
    }
    return { error: 'unreachable', version: null };
  }
}

// The defaults every map starts with, set by admins: the overlays switched on
// until a map (or /m's Settings) switches them itself. The metadata is absent
// before the first change. The default basemap is the map style marked
// is_default.
export type MapSettings = { default_overlays: string[] } & Partial<EntityMeta>;

export const mapSettingsPath = '/api/v1/map-settings';

export function useMapSettings() {
  const { data, error, reload } = useResource<MapSettings>(mapSettingsPath);
  return { settings: data, error, reload };
}

// Writing them needs the admin group.
export const mapSettingsApi = {
  replace: (input: { default_overlays: string[] }) =>
    request<MapSettings>(mapSettingsPath, { method: 'PUT', body: JSON.stringify(input) }),
};

const noDefaults: Readonly<Record<string, OverlayState>> = {};

// The overlay states a map starts with, beneath its own. Without the settings
// (not loaded yet, an API without them) no overlay is on.
export function useDefaultOverlayStates(): Readonly<Record<string, OverlayState>> {
  const { settings } = useMapSettings();
  const ids = settings?.default_overlays;
  return useMemo(
    () =>
      ids && ids.length > 0
        ? Object.fromEntries(ids.map((id) => [id, { on: true, opacity: 1 }]))
        : noDefaults,
    [ids],
  );
}
