import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addressUrl,
  applyServiceUrls,
  serviceUrlsVersion,
  setAddressBaseUrls,
  setTilesBaseUrls,
  subscribeServiceUrls,
  tilesUrl,
} from './client';

const none = { address_url: '', mtls_address_url: '', tiles_url: '', mtls_tiles_url: '' };

describe('service URLs', () => {
  afterEach(() => {
    applyServiceUrls(undefined);
    setAddressBaseUrls();
    setTilesBaseUrls();
  });

  it("use the API's URLs over config.json's, per service", () => {
    setAddressBaseUrls('https://address.config');
    setTilesBaseUrls('https://tiles.config', 'https://mtls.tiles.config');
    applyServiceUrls({ ...none, tiles_url: ' https://tiles.api/ ' });

    // The API left the address directory empty: config.json's stays.
    expect(addressUrl('/healthz')).toBe('https://address.config/healthz');
    // The API's pair wins whole: its empty mTLS URL is its OIDC one.
    expect(tilesUrl('/maps')).toBe('https://tiles.api/maps');
    expect(tilesUrl('/maps', 'mtls')).toBe('https://tiles.api/maps');

    applyServiceUrls({
      ...none,
      tiles_url: 'https://tiles.api',
      mtls_tiles_url: 'https://mtls.tiles.api',
    });
    expect(tilesUrl('/maps', 'mtls')).toBe('https://mtls.tiles.api/maps');

    // Without the API's (signed out, an older API), config.json's again.
    applyServiceUrls(undefined);
    expect(tilesUrl('/maps', 'mtls')).toBe('https://mtls.tiles.config/maps');
  });

  it('are off when neither sets one', () => {
    applyServiceUrls(none);
    expect(addressUrl('/healthz')).toBeNull();
    expect(tilesUrl('/maps', 'mtls')).toBeNull();
  });

  it('notify only on a change', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeServiceUrls(listener);
    const before = serviceUrlsVersion();

    applyServiceUrls({ ...none, address_url: 'https://address.api' });
    expect(listener).toHaveBeenCalledTimes(1);
    applyServiceUrls({ ...none, address_url: 'https://address.api/' });
    expect(listener).toHaveBeenCalledTimes(1);
    setTilesBaseUrls('https://tiles.config');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(serviceUrlsVersion()).toBe(before + 2);

    unsubscribe();
    applyServiceUrls(undefined);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
