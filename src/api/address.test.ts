import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AddressError,
  addressLookupsAvailable,
  addressPath,
  addressRequest,
  probeAddressDirectory,
  reverseGeocode,
} from './address';
import { addressUrl, setAccessTokenSource, setAddressBaseUrls, setApiTarget } from './client';
import { offline, reportRequestOk } from './connectivity';

type Call = [string, RequestInit];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('address-serv URLs', () => {
  afterEach(() => setAddressBaseUrls());

  it('are off without a configured URL', () => {
    setAddressBaseUrls();
    expect(addressUrl('/healthz')).toBeNull();
    expect(addressUrl('/healthz', 'mtls')).toBeNull();
    expect(addressLookupsAvailable()).toBe(false);
  });

  it('use the mTLS URL for client certificate sessions, else the OIDC one', () => {
    setAddressBaseUrls('https://address.example/', 'https://mtls.address.example');
    expect(addressUrl('/healthz', 'oidc')).toBe('https://address.example/healthz');
    expect(addressUrl('/healthz', 'mtls')).toBe('https://mtls.address.example/healthz');

    setAddressBaseUrls('https://address.example');
    expect(addressUrl('/healthz', 'mtls')).toBe('https://address.example/healthz');
  });

  it('builds suggest paths without empty parameters', () => {
    expect(addressPath('streets', { name: 'Haupt', city: ' ', district: '' })).toBe(
      '/api/suggest/streets?name=Haupt',
    );
  });
});

describe('addressRequest', () => {
  beforeEach(() => {
    setAddressBaseUrls('https://address.example', 'https://mtls.address.example');
    setAccessTokenSource(() => 'tok');
    reportRequestOk();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setAddressBaseUrls();
    setAccessTokenSource(() => null);
    setApiTarget('oidc');
  });

  it('sends the token, but no cookies, with OIDC', async () => {
    const fetch = vi.fn(async () => json(['Bonn']));
    vi.stubGlobal('fetch', fetch);
    setApiTarget('oidc');

    await expect(addressRequest<string[]>('/api/suggest/cities?name=B')).resolves.toEqual(['Bonn']);
    const [url, init] = fetch.mock.calls[0] as unknown as Call;
    expect(url).toBe('https://address.example/api/suggest/cities?name=B');
    expect(init.credentials).toBe('omit');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' });
  });

  it('sends the client certificate, but no token, behind the mTLS proxy', async () => {
    const fetch = vi.fn(async () => json([]));
    vi.stubGlobal('fetch', fetch);
    setApiTarget('mtls');

    await addressRequest('/api/suggest/cities');
    const [url, init] = fetch.mock.calls[0] as unknown as Call;
    expect(url).toBe('https://mtls.address.example/api/suggest/cities');
    expect(init.credentials).toBe('include');
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('throws its error, and never counts the app offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'nope' }, 500)),
    );
    await expect(addressRequest('/api/suggest/cities')).rejects.toEqual(
      new AddressError(500, 'nope'),
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(addressRequest('/api/suggest/cities')).rejects.toThrow('Failed to fetch');
    expect(offline()).toBe(false);
  });
});

describe('probeAddressDirectory', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setAddressBaseUrls();
  });

  it('tells why address-serv is unusable', async () => {
    expect(await probeAddressDirectory()).toBe('no address directory configured');

    setAddressBaseUrls('https://address.example');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    expect(await probeAddressDirectory()).toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    expect(await probeAddressDirectory()).toBe('HTTP 401');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    expect(await probeAddressDirectory()).toBe('unreachable');
  });
});

describe('reverseGeocode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setAddressBaseUrls();
  });

  it('asks nothing without an address directory', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await reverseGeocode({ lat: 50, lon: 7 })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('prefers a near geo object, then a near house number', async () => {
    setAddressBaseUrls('https://address.example');
    const object = {
      name: 'Hydrant 1',
      group: 'Hydrants',
      street: 'Hauptstraße',
      house_number: '2a',
      postcode: '53111',
      district: 'Mitte',
      city: 'Bonn',
      country: 'Germany',
      latitude: 50,
      longitude: 7,
    };
    const address = { ...object, house_number: '3', distance_meters: 10 };
    const fetch = vi.fn(async () =>
      json({ addresses: [address], geo_objects: [{ ...object, distance_meters: 20 }] }),
    );
    vi.stubGlobal('fetch', fetch);

    expect(await reverseGeocode({ lat: 50, lon: 7 })).toMatchObject({
      object_name: 'Hydrant 1',
      house_number: '2a',
    });
    const [url] = fetch.mock.calls[0] as unknown as Call;
    expect(url).toBe('https://address.example/api/suggest/reverse?lat=50&lon=7&limit=1');

    fetch.mockImplementation(async () =>
      json({ addresses: [address], geo_objects: [{ ...object, distance_meters: 30 }] }),
    );
    expect(await reverseGeocode({ lat: 50, lon: 7 })).toMatchObject({
      object_name: '',
      house_number: '3',
    });
  });

  it('turns lookups off once address-serv refuses them', async () => {
    setAddressBaseUrls('https://address.example');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'read-only' }, 403)),
    );
    expect(await reverseGeocode({ lat: 50, lon: 7 })).toBeNull();
    expect(addressLookupsAvailable()).toBe(false);
  });
});
