const iconPaths = { close: 'm6 6 12 12M6 18 18 6', check: 'm5 12 4 4 10-10', plus: 'M12 5v14M5 12h14', sparkles: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4M18 4h4', speaker: 'M11 5 6 9H3v6h3l5 4V5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14', chevronLeft: 'm14 6-6 6 6 6', chevronRight: 'm10 6 6 6-6 6' }

export function StatusIcon({ name, size = 16 }: { name: keyof typeof iconPaths; size?: number }) {
  return <svg className="status-icon" aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={iconPaths[name]} />
  </svg>
}
