// Plugin registry. Add a new launcher here and the rest of the app picks
// it up automatically.
//
// Each plugin's `supportsClaim` defaults to true (claim button shown when
// claimable > 0). Set it to `false` in the plugin's claim.js export to
// hide the button (e.g. Doppler in this version).

import clanker from './clanker/index.js';
import doppler from './doppler/index.js';

export const PLUGINS = [clanker, doppler];

export function pluginById(id) {
  return PLUGINS.find((p) => p.id === id);
}

export function pluginsForChain(chainId) {
  return PLUGINS.filter((p) => p.chains.includes(chainId));
}
