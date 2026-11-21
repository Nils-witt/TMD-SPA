import { type FormEvent, useId, useState } from 'react';
import type { ServiceUrlSettings } from '@/api/client';
import { useOffline } from '@/api/connectivity';
import { serviceUrlsApi, serviceUrlsPath, useServiceUrls } from '@/api/serviceUrls';
import { useResourceCache } from '@/api/resource';
import {
  FieldRow,
  FormActions,
  FormError,
  Section,
  SectionText,
  WidgetForm,
} from '@/components/form';
import Spinner from '@/components/Spinner';
import { formatTime } from '../shared/logbookEntries';

const empty: ServiceUrlSettings = {
  address_url: '',
  mtls_address_url: '',
  tiles_url: '',
  mtls_tiles_url: '',
};

type Key = keyof ServiceUrlSettings;

const services: {
  legend: string;
  text: string;
  oidc: Key;
  mtls: Key;
  placeholder: string;
}[] = [
  {
    legend: 'Address directory',
    text: 'address-serv, asked for address suggestions. It must accept the users’ tokens read-only (OIDC_READONLY_AUDIENCES) and allow this app’s origin (CORS_ALLOWED_ORIGIN).',
    oidc: 'address_url',
    mtls: 'mtls_address_url',
    placeholder: 'https://address.example.org',
  },
  {
    legend: 'Tile server',
    text: 'tileserve-go, whose maps the map widgets offer as overlays. It must accept the users’ tokens (-oidc-access-token-audience) and allow this app’s origin (-cors-allowed-origins); its map permissions decide who sees which overlay.',
    oidc: 'tiles_url',
    mtls: 'mtls_tiles_url',
    placeholder: 'https://tiles.example.org',
  },
];

// The URLs of the services every browser calls itself. They decide where the
// browsers send the users' tokens, hence the admin group only.
function ServiceUrlsWidget() {
  const urls = useServiceUrls();
  const cache = useResourceCache();
  const offline = useOffline();
  const id = useId();
  // null: unchanged, the stored URLs show.
  const [draft, setDraft] = useState<ServiceUrlSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (urls.data === undefined && urls.error === null) return <Spinner compact />;

  const stored: ServiceUrlSettings = urls.data
    ? {
        address_url: urls.data.address_url,
        mtls_address_url: urls.data.mtls_address_url,
        tiles_url: urls.data.tiles_url,
        mtls_tiles_url: urls.data.mtls_tiles_url,
      }
    : empty;
  const shown = draft ?? stored;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft || busy) return;
    setBusy(true);
    try {
      const trimmed = Object.fromEntries(
        Object.entries(draft).map(([k, v]) => [k, v.trim()]),
      ) as ServiceUrlSettings;
      cache.put(serviceUrlsPath, await serviceUrlsApi.replace(trimmed));
      setDraft(null);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const input = (key: Key, label: string, placeholder: string) => (
    <FieldRow id={`${id}-${key}`} label={label}>
      <input
        id={`${id}-${key}`}
        className="grow"
        type="url"
        value={shown[key]}
        placeholder={placeholder}
        maxLength={2048}
        disabled={offline || busy}
        onChange={(e) => setDraft({ ...shown, [key]: e.target.value })}
      />
    </FieldRow>
  );

  return (
    <div>
      <SectionText>
        <span className="muted">
          Every browser calls these services itself. An empty URL leaves the one in the app’s
          config.json; an empty client certificate URL is the OIDC one.
        </span>
      </SectionText>
      <WidgetForm onSubmit={(e) => void submit(e)}>
        {services.map((s) => (
          <Section key={s.oidc} legend={s.legend}>
            <SectionText>
              <span className="muted">{s.text}</span>
            </SectionText>
            {input(s.oidc, 'URL', s.placeholder)}
            {input(
              s.mtls,
              'Client certificate URL',
              s.placeholder.replace('https://', 'https://mtls.'),
            )}
          </Section>
        ))}
        <FormActions
          submitLabel="Save"
          busy={busy}
          canSubmit={draft !== null && !offline}
          dirty={draft !== null}
          onDiscard={() => setDraft(null)}
        />
      </WidgetForm>
      {urls.data?.updated_at && (
        <SectionText>
          <span className="muted">
            Changed {formatTime(urls.data.updated_at)} · {urls.data.updated_by}
          </span>
        </SectionText>
      )}
      <FormError error={error ?? urls.error} onClose={() => setError(null)} />
    </div>
  );
}

export default ServiceUrlsWidget;
