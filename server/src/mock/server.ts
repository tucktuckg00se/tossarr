import { RADARR_API_KEY, buildRadarrMock } from './radarr.js';
import { SONARR_API_KEY, buildSonarrMock } from './sonarr.js';

const [sonarr, radarr] = await Promise.all([
  buildSonarrMock().app.listen({ port: 8989, host: '0.0.0.0' }),
  buildRadarrMock().app.listen({ port: 8787, host: '0.0.0.0' }),
]);

console.log(`Sonarr mock on ${sonarr} (API key: ${SONARR_API_KEY})`);
console.log(`Radarr mock on ${radarr} (API key: ${RADARR_API_KEY})`);
console.log('Introspect state at /__mock/state on either port.');
