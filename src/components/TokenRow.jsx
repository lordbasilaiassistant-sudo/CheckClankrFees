import React from 'react';
import ClaimCell from './ClaimCell.jsx';
import { safeImageUrl } from '../lib/clanker/images.js';

// One launch's row. Links come from the plugin (each plugin contributes
// its own pill — clanker.world for Clanker, doppler.lol for Doppler, etc.).

export default function TokenRow({ launch, reward, feeOwner, onClaimed }) {
  const imgSrc = safeImageUrl(launch.image);
  return (
    <tr>
      <td>
        {imgSrc
          ? <img className="tok-img" src={imgSrc} alt=""
              referrerPolicy="no-referrer" loading="lazy"
              crossOrigin="anonymous" decoding="async" />
          : <span className="tok-img placeholder" />}
      </td>
      <td>
        <div className="tok-name">{launch.name || '—'}</div>
        <div className="dim small">
          <span className={`plugin-tag plugin-${launch.pluginId}`}>{launch.pluginId}</span>
          {' · '}{launch.symbol || ''}
          {' · '}<span className="mono">{shortAddr(launch.token)}</span>
        </div>
      </td>
      <td>
        <ClaimCell
          launch={launch}
          feeOwner={feeOwner}
          reward={reward}
          onClaimed={onClaimed}
        />
      </td>
      <td>
        {launch.links?.map((lnk) => (
          <a
            key={lnk.url}
            className={`link-pill ${lnk.kind}`}
            href={lnk.url}
            target="_blank"
            rel="noreferrer"
            title={lnk.label}
          >{lnk.label}</a>
        ))}
      </td>
    </tr>
  );
}

function shortAddr(a) { return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—'; }
