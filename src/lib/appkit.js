// Reown AppKit (modern WalletConnect) setup. Single source of truth for
// chains, wagmi adapter, and the modal instance. Imported once from main.jsx.
//
// AppKit covers both flows:
//   - desktop with an injected wallet extension (MetaMask, Rabby, …)
//   - mobile via the WalletConnect v2 QR/deep-link
// — so the single "Connect Wallet" button handles every case the user
// asked about.

import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { base } from '@reown/appkit/networks';
import { log } from './debug.js';

export const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '';

if (!projectId) {
  // Loud but non-fatal — the connect button surfaces a friendlier message.
  log.warn('appkit', 'VITE_WALLETCONNECT_PROJECT_ID is empty. Create one free at https://cloud.reown.com and put it in .env');
}

const networks = [base];

export const wagmiAdapter = new WagmiAdapter({
  projectId: projectId || '00000000000000000000000000000000', // placeholder keeps the adapter from throwing during boot
  networks,
  ssr: false,
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;

export const appKit = createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId: projectId || '00000000000000000000000000000000',
  defaultNetwork: base,
  metadata: {
    name: 'Check Clankr Fees',
    description: 'See every Clanker token where you are creator or fee recipient, and what is claimable.',
    url: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173',
    icons: [],
  },
  features: {
    analytics: false,
    email: false,
    socials: false,
  },
  themeMode: 'dark',
});

log.info('appkit', 'AppKit initialized', { networks: networks.map(n => n.name), hasProjectId: !!projectId });
