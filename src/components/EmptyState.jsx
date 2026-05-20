import React from 'react';

export default function EmptyState() {
  return (
    <div className="empty">
      <h1>Connect your wallet</h1>
      <p>
        We'll scan Base mainnet for every Clanker v4 token where this address is
        the <code>tokenAdmin</code> at creation, then ask the FeeLocker how much
        each token has waiting for you.
      </p>
      <p className="dim small">
        Works with browser wallets (MetaMask, Rabby, Frame…) and mobile via the
        WalletConnect QR — same button, AppKit picks the right flow.
      </p>
    </div>
  );
}
