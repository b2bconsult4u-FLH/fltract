// Industry configuration only; the intake/CRM core must not depend on this registry.
export const counties = Object.freeze({
  Brevard: { home: 'https://www.bcpao.us/', hosts: ['www.bcpao.us', 'bcpao.us'], exports: 'https://www.bcpao.us/PublicData.aspx?t=1.2' },
  'Indian River': { home: 'https://www.ircpa.org/', hosts: ['www.ircpa.org', 'ircpa.org', 'qpublic.schneidercorp.com'], exports: 'https://www.ircpa.org/site-links/pro-tools-page/' },
  'St. Lucie': { home: 'https://www.paslc.gov/', hosts: ['www.paslc.gov', 'paslc.gov', 'apps.paslc.gov', 'map.paslc.gov'] },
  Martin: { home: 'https://www.pamartinfl.gov/', hosts: ['www.pamartinfl.gov', 'pamartinfl.gov', 'www.pa.martin.fl.us', 'pa.martin.fl.us'] },
  Okeechobee: { home: 'https://www.okeechobeepa.com/', hosts: ['www.okeechobeepa.com', 'okeechobeepa.com', 'qpublic.schneidercorp.com'] }
});

export function approvedSource(county, value) {
  const config = counties[county];
  if (!config) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
    if (!config.hosts.includes(url.hostname)) return false;
    // Shared vendor hosts need a county-specific application, not just a matching hostname.
    if (url.hostname === 'qpublic.schneidercorp.com') {
      const app = county === 'Indian River' ? 'IndianRiverCountyFL' : 'OkeechobeeCountyFL';
      return url.searchParams.get('App') === app || url.pathname.startsWith(`/FileData/${app}/`);
    }
    return true;
  } catch { return false; }
}
