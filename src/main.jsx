import React from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.jsx';
import { wagmiConfig } from './lib/appkit.js';
import { log } from './lib/debug.js';
import { rpc } from './lib/rpc/index.js';
import './styles.css';

// Log only origin+pathname (strip search and hash) so an attacker-crafted
// `?secret=…` URL the user was tricked into pasting can't leak via a shared
// debug-panel screenshot.
const _loc = window.location;
log.info('boot', 'CheckClankrFees starting', {
  url: _loc.origin + _loc.pathname,
  ua: navigator.userAgent.slice(0, 80),
});

// CORS pre-flight: probe every RPC once at boot. Endpoints that CORS-fail
// from this origin get permanently disabled for the session — we won't
// waste retry slots on them. Non-blocking; the rest of the app boots in
// parallel and uses whatever endpoints are already healthy.
rpc.preflight().catch((e) => log.warn('boot', 'preflight error', { msg: e?.message }));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>
);
