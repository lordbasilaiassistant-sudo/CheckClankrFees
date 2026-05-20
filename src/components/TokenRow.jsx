import React from 'react';
import ClaimCell from './ClaimCell.jsx';
import { safeImageUrl } from '../lib/clanker/images.js';

// One token's row. Pure presentational. ClaimCell encapsulates the wallet
// signing flow so this stays render-only.

export default function TokenRow({ token, reward, feeOwner, onClaimed }) {
  const imgSrc = safeImageUrl(token.image);
  return (
    <tr>
      <td>
        {imgSrc
          ? <img
              className="tok-img" src={imgSrc} alt=""
              referrerPolicy="no-referrer" loading="lazy"
              crossOrigin="anonymous" decoding="async"
            />
          : <span className="tok-img placeholder" />}
      </td>
      <td>
        <div className="tok-name">{token.name || '—'}</div>
        <div className="dim small">{token.symbol || ''} · <span className="mono">{shortAddr(token.token)}</span></div>
      </td>
      <td>
        <ClaimCell
          feeOwner={feeOwner}
          token={token.token}
          reward={reward}
          onClaimed={onClaimed}
        />
      </td>
      <td>
        <a className="link-pill clanker" href={`https://clanker.world/clanker/${token.token}`} target="_blank" rel="noreferrer" title="View on clanker.world">clanker</a>{' '}
        <a className="link-pill scan" href={`https://basescan.org/address/${token.token}`} target="_blank" rel="noreferrer" title="View on Basescan">scan</a>{' '}
        {token.txHash && (
          <a className="link-pill tx" href={`https://basescan.org/tx/${token.txHash}`} target="_blank" rel="noreferrer" title={`Deployed at block ${token.blockNumber}`}>tx</a>
        )}
      </td>
    </tr>
  );
}

function shortAddr(a) { return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—'; }
