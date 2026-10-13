import { useEffect, useState } from 'react';
import api from '../api/client';
import { SEGMENT_ORDER_DEFAULT } from '../constants/hostnamePattern.js';

// Falls back to an all-empty shape (never null) while loading/on error, so
// every caller can destructure straight away — buildHostname() etc. already
// treat missing codes as "can't suggest one yet" the same way they treat a
// blank Team/Tier select.
const EMPTY_CONFIG = {
  site_codes: {}, team_codes: [], tier_codes: [], applicable_asset_types: [],
  segment_order: SEGMENT_ORDER_DEFAULT,
};

// Shared by AssetForm / PhysicalEsxiForm (and whichever inventory forms pick
// up the Suggested Hostname panel next) and the Dropdown Master admin panel
// that edits this same config.
export default function useHostnamePatternConfig() {
  const [config, setConfig] = useState(EMPTY_CONFIG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get('/hostname-pattern-config')
      .then(({ data }) => { if (!cancelled) setConfig(data.config || EMPTY_CONFIG); })
      .catch(() => { /* keep EMPTY_CONFIG — panel just shows "fill in" copy */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { config, loading };
}
