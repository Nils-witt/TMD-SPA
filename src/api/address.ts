import { useEffect, useState } from 'react';
import { addressUrl, apiTarget, freshAuthHeaders, subscribeServiceUrls } from './client';
import type { Coordinates, MissionFields } from './missions';

// Suggestions come from address-serv, which the browser calls itself (its
// URLs are addressBaseUrl and mtlsAddressBaseUrl of config.json), and only
// help: every address field stays free text. Its failures never make the app
// count as offline: the API is what the app needs.

type StreetSuggestion = {
  name: string;
  district: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
};

type HouseNumberSuggestion = {
  number: string; // with its addition, e.g. "12a"
  postcode: string;
  latitude: number;
  longitude: number;
};

type DistrictSuggestion = { name: string; city: string };

// A named object of the directory (a hydrant, a building, …) with its address.
type GeoObjectSuggestion = {
  name: string;
  group: string;
  street: string;
  house_number: string; // with its addition; empty if the object has none
  postcode: string;
  district: string;
  city: string;
  country: string;
  latitude: number; // the object's own position
  longitude: number;
};

export type AddressQuery = {
  object_name: string;
  street: string;
  house_number: string;
  city: string;
  district: string;
};

export type AddressSuggestions = {
  streets: StreetSuggestion[];
  houseNumbers: HouseNumberSuggestion[];
  cities: string[];
  districts: DistrictSuggestion[];
  objects: GeoObjectSuggestion[];
};

const none: AddressSuggestions = {
  streets: [],
  houseNumbers: [],
  cities: [],
  districts: [],
  objects: [],
};

const debounceMs = 250;

// A suggestion arriving later than this is of no use while typing.
const addressTimeout = 10_000;

// Turns false once address-serv answers 403 (the token may not read
// addresses) or 404 (no /api/suggest), so no more lookups are tried until the
// page reloads.
let available = true;

// Another address directory may answer.
subscribeServiceUrls(() => {
  available = true;
});

export class AddressError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'AddressError';
    this.status = status;
  }
}

// A GET of address-serv. With OIDC it sends the user's token (address-serv
// accepts it read-only) and no cookies; behind the mTLS proxy it sends the
// client certificate, which a browser only presents cross-origin with
// credentials. Throws AddressError, or what fetch throws.
export async function addressRequest<T>(path: string, signal?: AbortSignal): Promise<T> {
  return (await (await addressFetch(path, signal)).json()) as T;
}

async function addressFetch(path: string, signal?: AbortSignal): Promise<Response> {
  const url = addressUrl(path);
  if (url === null) throw new AddressError(0, 'no address directory configured');
  const mtls = apiTarget() === 'mtls';
  const timeout = AbortSignal.timeout(addressTimeout);
  const res = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    credentials: mtls ? 'include' : 'omit',
    headers: { Accept: 'application/json', ...(mtls ? {} : await freshAuthHeaders()) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new AddressError(res.status, body?.error ?? `address directory answered ${res.status}`);
  }
  return res;
}

// Checks GET /healthz, which needs the token too: null if address-serv
// answers, else a short reason.
export async function probeAddressDirectory(signal?: AbortSignal): Promise<string | null> {
  try {
    await (await addressFetch('/healthz', signal)).body?.cancel();
    return null;
  } catch (err) {
    if (err instanceof AddressError) return err.status === 0 ? err.message : `HTTP ${err.status}`;
    if (err instanceof DOMException && err.name === 'TimeoutError') return 'no answer';
    return 'unreachable';
  }
}

// Whether lookups are worth trying: an address directory is configured and
// has not refused them.
export const addressLookupsAvailable = () => available && addressUrl('') !== null;

const noteFailure = (err: unknown) => {
  if (err instanceof AddressError && (err.status === 403 || err.status === 404)) {
    available = false;
  }
};

export const addressPath = (kind: string, params: Record<string, string>) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v.trim() !== ''));
  return `/api/suggest/${kind}?${q}`;
};

// Suggestions are optional, so failures are ignored.
async function lookup<T>(path: string, params: Record<string, string>, signal: AbortSignal) {
  try {
    return await addressRequest<T[]>(addressPath(path, params), signal);
  } catch (err) {
    noteFailure(err);
    return [] as T[];
  }
}

// value, once it stayed unchanged for ms.
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// Only the answer to the latest params is kept.
function useLookup<T>(path: string, params: Record<string, string> | null): T[] {
  const key = params === null ? null : JSON.stringify(params);
  const debounced = useDebounced(key, debounceMs);
  const [state, setState] = useState<{ key: string | null; items: T[] }>({ key: null, items: [] });

  useEffect(() => {
    if (debounced === null || !addressLookupsAvailable()) return;
    const ctl = new AbortController();
    lookup<T>(path, JSON.parse(debounced) as Record<string, string>, ctl.signal).then(
      (items) => setState({ key: debounced, items }),
      () => undefined,
    );
    return () => ctl.abort();
  }, [path, debounced]);

  // Suggestions for other text are dropped at once, not when the next
  // answer arrives.
  return state.key !== null && state.key === key ? state.items : [];
}

// Only the active field is looked up. Streets are suggested from two characters
// and objects from two characters on; house numbers once a street is typed in.
export function useAddressSuggestions(
  q: AddressQuery,
  active: keyof AddressQuery | null,
): AddressSuggestions {
  const streets = useLookup<StreetSuggestion>(
    'streets',
    active === 'street' && q.street.trim().length >= 2
      ? { name: q.street, city: q.city, district: q.district }
      : null,
  );
  const houseNumbers = useLookup<HouseNumberSuggestion>(
    'house-numbers',
    active === 'house_number' && q.street.trim() !== ''
      ? { street: q.street, city: q.city, district: q.district }
      : null,
  );
  const cities = useLookup<string>('cities', active === 'city' ? { name: q.city } : null);
  const districts = useLookup<DistrictSuggestion>(
    'districts',
    active === 'district' ? { name: q.district, city: q.city } : null,
  );
  const objects = useLookup<GeoObjectSuggestion>(
    'geo-objects',
    active === 'object_name' && q.object_name.trim().length >= 2
      ? { name: q.object_name, city: q.city, district: q.district }
      : null,
  );
  return active === null ? none : { streets, houseNumbers, cities, districts, objects };
}

// The house number nearest to a coordinate, with its street.
type NearbyAddress = {
  street: string;
  house_number: string; // with its addition, e.g. "12a"
  postcode: string;
  district: string;
  city: string;
  country: string;
  latitude: number;
  longitude: number;
  distance_meters: number;
};

// The geo object nearest to a coordinate, measured to its own position.
type NearbyGeoObject = GeoObjectSuggestion & { distance_meters: number };

type ReverseResult = { addresses: NearbyAddress[]; geo_objects: NearbyGeoObject[] };

// What was found at a coordinate: a geo object's name and address, or a
// house number's address with an empty object_name.
export type ReverseAddress = {
  object_name: string;
  street: string;
  house_number: string;
  district: string;
  city: string;
};

// The directory always answers its nearest house number and geo object,
// however far away. Beyond these, a click (in a field, on a road) is at no
// listed address and a neighbour's would be wrong. Objects are points
// (a hydrant, a building's entrance), so a click names one only close by.
const maxAddressDistance = 50;
const maxObjectDistance = 25;

async function reverse(p: Coordinates, limit: number, signal?: AbortSignal) {
  if (!addressLookupsAvailable()) return null;
  try {
    const q = new URLSearchParams({ lat: String(p.lat), lon: String(p.lon), limit: String(limit) });
    return await addressRequest<ReverseResult>(`/api/suggest/reverse?${q}`, signal);
  } catch (err) {
    noteFailure(err);
    return null;
  }
}

// The address at p, or null if none is near or the lookup fails: the
// address only helps, the coordinates are kept either way. A nearby geo
// object wins over the nearest house number, as it names the place.
export async function reverseGeocode(
  p: Coordinates,
  signal?: AbortSignal,
): Promise<ReverseAddress | null> {
  const found = await reverse(p, 1, signal);
  if (found === null) return null;
  const [object] = found.geo_objects;
  if (object && object.distance_meters <= maxObjectDistance) {
    return { ...object, object_name: object.name };
  }
  const [address] = found.addresses;
  if (address && address.distance_meters <= maxAddressDistance) {
    return { ...address, object_name: '' };
  }
  return null;
}

// A place near a coordinate, to be picked by the user: unlike
// reverseGeocode, nothing is too far away, the distance is shown instead.
export type NearbyPlace = {
  kind: 'object' | 'address';
  address: ReverseAddress;
  group: string; // a geo object's; empty for an address
  postcode: string;
  distance: number; // meters
};

// The geo objects and the house numbers nearest to p, at most limit of
// each, nearest first; null if the lookup fails or there is no directory.
export async function nearbyPlaces(
  p: Coordinates,
  limit: number,
  signal?: AbortSignal,
): Promise<{ objects: NearbyPlace[]; addresses: NearbyPlace[] } | null> {
  const found = await reverse(p, limit, signal);
  if (found === null) return null;
  return {
    objects: found.geo_objects.slice(0, limit).map((o) => ({
      kind: 'object',
      address: { ...o, object_name: o.name },
      group: o.group,
      postcode: o.postcode,
      distance: o.distance_meters,
    })),
    addresses: found.addresses.slice(0, limit).map((a) => ({
      kind: 'address',
      address: { ...a, object_name: '' },
      group: '',
      postcode: a.postcode,
      distance: a.distance_meters,
    })),
  };
}

// What a mission takes from a found address. Without an object nearby, its
// object name is left as it is.
export const addressFields = (a: ReverseAddress): MissionFields => ({
  ...(a.object_name !== '' && { address_object_name: a.object_name }),
  address_street: a.street,
  address_house_number: a.house_number,
  address_city: a.city,
  address_district: a.district,
});

export const formatAddress = (a: ReverseAddress) =>
  [a.object_name, [a.street, a.house_number].filter(Boolean).join(' '), a.city]
    .filter(Boolean)
    .join(', ');
