import React, { useState } from 'react';
import { useAccount } from 'wagmi';
import { useDonate } from '../hooks/useDonate.js';
import { DONATE_ADDRESS, DONATE_PRESETS_ETH } from '../constants.js';

// Small support-dev panel. Only shows when a wallet is connected (otherwise
// the user has no way to send). Native ETH, fixed public address, single tx
// per click — same UX shape as the claim button.

export default function DonateBox() {
  const { isConnected } = useAccount();
  const [amount, setAmount] = useState('0.005');
  const { donate, status, txHash, error } = useDonate();

  if (!isConnected) return null;

  return (
    <aside className="donate">
      <div className="donate-row">
        <span className="donate-label">💚 Support dev</span>
        <span className="dim small">
          Free tool, no ads. If it saved you a click, a tiny tip on Base helps keep it maintained.
        </span>
      </div>
      <div className="donate-row">
        <div className="donate-presets">
          {DONATE_PRESETS_ETH.map((p) => (
            <button
              key={p}
              type="button"
              className={'preset' + (amount === p ? ' active' : '')}
              onClick={() => setAmount(p)}
            >{p}</button>
          ))}
        </div>
        <div className="donate-custom">
          <input
            type="text"
            inputMode="decimal"
            pattern="^\d*(\.\d+)?$"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="0.0"
            aria-label="Donation amount in ETH"
          />
          <span className="dim small">ETH</span>
        </div>
        <DonateButton
          status={status}
          txHash={txHash}
          error={error}
          onClick={() => donate(amount)}
          disabled={!amount || Number(amount) <= 0}
        />
      </div>
      <div className="donate-row">
        <a className="dim small mono" href={`https://basescan.org/address/${DONATE_ADDRESS}`} target="_blank" rel="noreferrer">
          {shortAddr(DONATE_ADDRESS)} ↗
        </a>
      </div>
    </aside>
  );
}

function DonateButton({ status, txHash, error, onClick, disabled }) {
  if (status === 'pending')    return <span className="claim-pill pending">signing…</span>;
  if (status === 'confirming') return <a className="claim-pill confirming" href={txHash ? `https://basescan.org/tx/${txHash}` : undefined} target="_blank" rel="noreferrer">confirming…</a>;
  if (status === 'done')       return <a className="claim-pill done" href={txHash ? `https://basescan.org/tx/${txHash}` : undefined} target="_blank" rel="noreferrer">thanks ✓</a>;
  if (status === 'error')      return <span className="claim-pill err" title={error?.shortMessage || error?.message || 'error'}>error</span>;
  return (
    <button className="claim-pill claim-btn" onClick={onClick} disabled={disabled}>
      support dev →
    </button>
  );
}

function shortAddr(a) { return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : ''; }
