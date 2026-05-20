import React from 'react';
import { useAccount, useDisconnect } from 'wagmi';
import { appKit, projectId } from '../lib/appkit.js';

export default function Header({ debugOpen, onToggleDebug }) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  return (
    <header className="hdr">
      <div className="hdr-left">
        <span className="logo">💰 Check Clankr Fees</span>
        <span className="sub">See every token you've created and what's claimable</span>
      </div>
      <div className="hdr-right">
        {!projectId && (
          <span className="warn-pill" title="Set VITE_WALLETCONNECT_PROJECT_ID in .env">
            ⚠ no WC project ID
          </span>
        )}
        {isConnected ? (
          <>
            <span className="addr-pill">{shortAddr(address)}</span>
            <button className="btn ghost" onClick={() => disconnect()}>Disconnect</button>
          </>
        ) : (
          <button className="btn primary" onClick={() => appKit.open()}>
            Connect Wallet
          </button>
        )}
        <button
          className="btn ghost"
          onClick={onToggleDebug}
          title="Toggle debug panel (or add ?debug=1)"
        >
          🐛 {debugOpen ? 'Hide' : 'Debug'}
        </button>
      </div>
    </header>
  );
}

function shortAddr(a) { return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : ''; }
