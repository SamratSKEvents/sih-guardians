/**
 * Layer swatches.
 *
 * Each draws the way its layer actually draws on the map, so a layers panel is
 * a legend and a control at once. Shared across routes: the same slick reads
 * the same in every surface, which is the point of having one system.
 *
 * These are geometry, not icons, so they are drawn here rather than pulled
 * from the icon set. An icon library has no glyph for "a dashed reconstructed
 * region".
 */

export function LayerSwatch({ kind }: { kind: string }) {
  const box = { width: 24, height: 16, 'aria-hidden': true, viewBox: '0 0 24 16' } as const;

  if (kind === 'slick')
    return (
      <svg {...box}>
        <path d="M3 9c2-4 6-5 9-3s6 1 9-2v9H3Z" fill="var(--slick-fill)" stroke="var(--slick)" strokeWidth="1.5" />
      </svg>
    );

  if (kind === 'reconstructed')
    return (
      <svg {...box}>
        <ellipse cx="12" cy="8" rx="9" ry="5" fill="none" stroke="var(--watch)" strokeWidth="1.5" strokeDasharray="5 3" />
      </svg>
    );

  if (kind === 'predicted')
    return (
      <svg {...box}>
        <path d="M2 12c6 0 8-8 14-8h6" fill="none" stroke="var(--critical)" strokeWidth="1.5" strokeDasharray="2 3" />
      </svg>
    );

  if (kind === 'heat')
    return (
      <svg {...box}>
        <defs>
          <radialGradient id="swatch-heat">
            <stop offset="0" stopColor="#ff2814" />
            <stop offset="0.4" stopColor="#ffdc00" />
            <stop offset="0.75" stopColor="#00c8e6" />
            <stop offset="1" stopColor="#1e3cc8" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="12" cy="8" rx="11" ry="7" fill="url(#swatch-heat)" />
      </svg>
    );

  if (kind === 'ais')
    return (
      <svg {...box}>
        <path d="M2 12h20" stroke="var(--clear)" strokeWidth="1.25" />
        <path d="M12 3l3 6h-6Z" fill="var(--clear)" />
      </svg>
    );

  return (
    <svg {...box}>
      {[3, 9, 15].map((x) => (
        <path key={x} d={`M${x} 11c2-3 3-5 5-6`} fill="none" stroke="var(--map-ink)" strokeWidth="1.1" opacity="0.7" />
      ))}
    </svg>
  );
}
