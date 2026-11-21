import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAccessTokenSource, setApiTarget, setTilesBaseUrls, tilesUrl } from './client';
import {
  fetchOverlayBounds,
  isTileServerUrl,
  overlayTileUrl,
  probeTileServer,
  toOverlays,
} from './maps';

type Call = [string, RequestInit];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const id = '0196f3a0-0000-7000-8000-000000000001';

describe('tile server URLs', () => {
  afterEach(() => setTilesBaseUrls());

  it('are off without a configured URL', () => {
    setTilesBaseUrls();
    expect(tilesUrl('/maps')).toBeNull();
    expect(tilesUrl('/maps', 'mtls')).toBeNull();
    expect(overlayTileUrl(id)).toBeNull();
    expect(isTileServerUrl('https://tiles.example/maps')).toBe(false);
  });

  it('use the mTLS URL for client certificate sessions, else the OIDC one', () => {
    setTilesBaseUrls('https://tiles.example/', 'https://mtls.tiles.example');
    expect(tilesUrl('/maps', 'oidc')).toBe('https://tiles.example/maps');
    expect(tilesUrl('/maps', 'mtls')).toBe('https://mtls.tiles.example/maps');

    setTilesBaseUrls('https://tiles.example');
    expect(tilesUrl('/maps', 'mtls')).toBe('https://tiles.example/maps');
  });

  it("build the current version's tile template and recognise its tiles", () => {
    setTilesBaseUrls('https://tiles.example');
    expect(overlayTileUrl(id)).toBe(
      `https://tiles.example/maps/${id}/version/current/{z}/{x}/{y}.png`,
    );
    expect(isTileServerUrl(`https://tiles.example/maps/${id}/version/current/3/4/5.png`)).toBe(
      true,
    );
    expect(isTileServerUrl('https://tiles.example.evil/maps')).toBe(false);
    expect(isTileServerUrl('https://basemap.example/3/4/5.png')).toBe(false);
  });
});

describe('toOverlays', () => {
  it('leaves out maps without a current version and sorts by name, ignoring case', () => {
    expect(
      toOverlays([
        { uuid: 'b', name: 'flood', description: '2026', currentVersion: 'v1' },
        { uuid: 'c', name: 'Draft' },
        { uuid: 'a', name: 'Areas', currentVersion: 'v2' },
      ]),
    ).toEqual([
      { id: 'a', name: 'Areas', description: '' },
      { id: 'b', name: 'flood', description: '2026' },
    ]);
  });
});

describe('tile server requests', () => {
  beforeEach(() => {
    setTilesBaseUrls('https://tiles.example', 'https://mtls.tiles.example');
    setAccessTokenSource(() => 'tok');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setTilesBaseUrls();
    setAccessTokenSource(() => null);
    setApiTarget('oidc');
  });

  it('send the token, but no cookies, with OIDC and map the bounds', async () => {
    const fetch = vi.fn(async () =>
      json({ west: 7, south: 50, east: 8, north: 51, minZoom: 4, maxZoom: 18 }),
    );
    vi.stubGlobal('fetch', fetch);
    expect(await fetchOverlayBounds(id)).toEqual({
      west: 7,
      south: 50,
      east: 8,
      north: 51,
      min_zoom: 4,
      max_zoom: 18,
    });
    const [url, init] = fetch.mock.calls[0] as unknown as Call;
    expect(url).toBe(`https://tiles.example/maps/${id}/version/current/bounds`);
    expect(init.credentials).toBe('omit');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('send the client certificate and no token through the mTLS proxy', async () => {
    setApiTarget('mtls');
    const fetch = vi.fn(async () => json({ version: 'v1.2.0', commit: 'abcdef0123' }));
    vi.stubGlobal('fetch', fetch);
    expect(await probeTileServer()).toEqual({ error: null, version: 'v1.2.0' });
    const [url, init] = fetch.mock.calls[0] as unknown as Call;
    expect(url).toBe('https://mtls.tiles.example/version');
    expect(init.credentials).toBe('include');
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('probe with a short reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ commit: 'abcdef0123' })),
    );
    expect(await probeTileServer()).toEqual({ error: null, version: 'abcdef0' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('no', { status: 503 })),
    );
    expect(await probeTileServer()).toEqual({ error: 'HTTP 503', version: null });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    expect(await probeTileServer()).toEqual({ error: 'unreachable', version: null });
    setTilesBaseUrls();
    expect(await probeTileServer()).toEqual({ error: 'no tile server configured', version: null });
  });
});
