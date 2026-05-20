import React, { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import Header from './components/Header.jsx';
import EmptyState from './components/EmptyState.jsx';
import TokenList from './components/TokenList.jsx';
import DebugPanel from './components/DebugPanel.jsx';
import { log, debugPanelEnabled } from './lib/debug.js';

export default function App() {
  const { address, isConnected, chain } = useAccount();
  const [debugOpen, setDebugOpen] = useState(() => debugPanelEnabled());

  useEffect(() => {
    if (isConnected) log.info('wallet', 'connected', { address, chain: chain?.name, chainId: chain?.id });
    else log.debug('wallet', 'disconnected');
  }, [isConnected, address, chain]);

  return (
    <div
      className={'app' + (debugOpen ? ' dbg-open' : '')}
      style={debugOpen ? { paddingRight: 'min(420px, 55vw)' } : undefined}
    >
      <Header debugOpen={debugOpen} onToggleDebug={() => setDebugOpen((v) => !v)} />
      <main className="main">
        {isConnected ? <TokenList address={address} /> : <EmptyState />}
      </main>
      {debugOpen && <DebugPanel onClose={() => setDebugOpen(false)} />}
    </div>
  );
}
