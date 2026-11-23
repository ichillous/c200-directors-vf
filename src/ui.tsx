import type { ReactNode } from 'react';
import { useImageUrl } from './images';
import { SENSOR } from './optics';
import type { Frame } from './types';

export const ICONS = {
  finder: 'M3 8V5h4M17 5h4v3M21 16v3h-4M7 19H3v-3M9.5 12a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0',
  bank: 'M3 4h8v7H3zM13 4h8v7h-8zM3 13h8v7H3zM13 13h8v7h-8z',
  shoots: 'M3 6h6l2 2h10v11H3z',
  kit: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0 -18M8 12.5l3 3 5-6',
  down: 'M6 9l6 6 6-6',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM8.5 13a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0',
};

export function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** A button that opens a picker sheet, showing the current choice. */
export function PickerButton({ label, onClick, small, className = '' }: { label: string; onClick: () => void; small?: boolean; className?: string }) {
  return (
    <button type="button" className={`picker ${small ? 'picker--small' : ''} ${className}`} aria-haspopup="listbox" onClick={onClick}>
      <span className="clip">{label}</span>
      <Icon d={ICONS.down} size={small ? 14 : 16} />
    </button>
  );
}

/** A panel that covers its column with a short list of choices. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet">
      <div className="sheet__head">
        <span className="sheet__title">{title}</span>
        <button type="button" className="btn btn--quiet" onClick={onClose}>Close</button>
      </div>
      <div className="sheet__body">{children}</div>
    </div>
  );
}

export function Option({ name, on, onPick }: { name: string; on: boolean; onPick: () => void }) {
  return (
    <button type="button" role="option" aria-selected={on} className={`option ${on ? 'is-on' : ''}`} onClick={onPick}>
      {name}
    </button>
  );
}

/** A frame's picture, or a to-scale outline of the frame when it has none. */
export function Thumb({ frame, className = '' }: { frame: Frame; className?: string }) {
  const url = useImageUrl(frame.id, frame.hasImage);
  return (
    <span className={`thumb ${className}`}>
      {url ? (
        <img src={url} alt="" />
      ) : (
        <span className="thumb__glyph" style={{ width: `${Math.round(frame.frac * 100)}%`, aspectRatio: String(SENSOR[frame.fmt].aspect) }} />
      )}
      <span className="thumb__mm">{frame.mm} mm</span>
    </span>
  );
}
