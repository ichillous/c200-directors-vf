import { useEffect, useState } from 'react';
import { go, useApp } from './store';
import type { View } from './types';
import { Icon, ICONS } from './ui';
import { Finder } from './views/Finder';
import { Bank } from './views/Bank';
import { Shoots } from './views/Shoots';
import { Board } from './views/Board';
import { Kit, KIT_IDS } from './views/Kit';

const W = 916;
const H = 412;

function useViewport() {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const on = () => setSize(read());
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, []);
  return size;
}

export default function App() {
  const s = useApp();
  const { w, h } = useViewport();

  if (h > w) {
    return (
      <div className="stage">
        <div className="rotate">
          <h1>Turn the phone sideways</h1>
          <p>The viewfinder works in landscape, the way you hold the camera. Add it to your home screen and it opens that way every time.</p>
        </div>
      </div>
    );
  }

  const scale = Math.min(w / W, h / H);
  const kitDone = KIT_IDS.filter((id) => s.kit[id]).length;
  const items: { id: View; label: string; icon: string }[] = [
    { id: 'finder', label: 'Finder', icon: ICONS.finder },
    { id: 'bank', label: s.frames.length ? `Bank ${s.frames.length}` : 'Bank', icon: ICONS.bank },
    { id: 'shoots', label: 'Shoots', icon: ICONS.shoots },
    { id: 'kit', label: `Kit ${kitDone}/${KIT_IDS.length}`, icon: ICONS.kit },
  ];

  return (
    <div className="stage">
      <div className="app" style={{ transform: `scale(${scale})` }}>
        {/* Two buttons above the middle and two below: on the phone, the front-camera cutout sits in the gap. */}
        <nav className="rail" aria-label="Screens">
          {[items.slice(0, 2), items.slice(2)].map((group, g) => (
            <div key={g} className="rail__group">
              {group.map((it) => {
                const on = s.view === it.id || (it.id === 'shoots' && s.view === 'board');
                return (
                  <button key={it.id} type="button" className={`rail__item ${on ? 'is-on' : ''}`} aria-current={on ? 'page' : undefined} onClick={() => go(it.id)}>
                    <Icon d={it.icon} size={22} />
                    <span>{it.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        {s.view === 'finder' && <Finder />}
        {s.view === 'bank' && <Bank />}
        {s.view === 'shoots' && <Shoots />}
        {s.view === 'board' && <Board />}
        {s.view === 'kit' && <Kit />}
      </div>
    </div>
  );
}
