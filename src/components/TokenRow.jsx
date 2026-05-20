import React from 'react';
import ClaimCell from './ClaimCell.jsx';
import { safeImageUrl } from '../lib/clanker/images.js';

// One launch's row. Links come from the plugin (each plugin contributes
// its own pill — clanker.world for Clanker, doppler.lol for Doppler, etc.).

export default function TokenRow({ launch, reward, feeOwner, onClaimed }) {
  const imgSrc = safeImageUrl(launch.image);
  const isPaired = !!launch.meta?.isPaired;
  return (
    <tr className={isPaired ? 'row-paired' : undefined}>
      <td>
        {imgSrc
          ? <img className="tok-img" src={imgSrc} alt=""
              referrerPolicy="no-referrer" loading="lazy"
              crossOrigin="anonymous" decoding="async" />
          : <span className={'tok-img placeholder' + (isPaired ? ' paired-icon' : '')} aria-hidden="true">{isPaired ? '⇄' : null}</span>}
      </td>
      <td>
        <div className="tok-name">
          {launch.name || '—'}
          {isPaired && <span className="paired-pill" title={`Aggregate balance across ${launch.meta.sourceLaunchCount} pool${launch.meta.sourceLaunchCount === 1 ? '' : 's'} where ${launch.meta.rawSymbol || launch.symbol} is the paired currency.`}>paired side</span>}
        </div>
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
