import { go, set, useApp } from '../store';

export const KIT_IDS = ['sd', 'batt', 'nd', 'lens', 'in1', 'in2', 'cans'];

const MIC_DETAIL: Record<string, string> = {
  'Rode NTG4+': 'Shotgun on, level checked on the meters',
  'Rode Wireless PRO': 'Receiver in, transmitters charged',
};

export function Kit() {
  const s = useApp();
  const mics = s.swap ? ['Rode Wireless PRO', 'Rode NTG4+'] : ['Rode NTG4+', 'Rode Wireless PRO'];
  const done = KIT_IDS.filter((id) => s.kit[id]).length;
  const ready = done === KIT_IDS.length;

  const item = (id: string, name: string, detail: string) => {
    const on = !!s.kit[id];
    return (
      <button key={id} type="button" className={`check ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => set({ kit: { ...s.kit, [id]: !on } })}>
        <span className="check__box">{on ? '✓' : ''}</span>
        <span className="check__text"><b>{name}</b><small>{detail}</small></span>
      </button>
    );
  };

  return (
    <div className="screen">
      <div className="screen__head" style={{ gap: 14 }}>
        <h1 className="title">Pre-roll check</h1>
        <span role="status" style={{ fontSize: 14, color: 'var(--soft)' }}>{ready ? `All ${KIT_IDS.length} ready` : `${done} of ${KIT_IDS.length} ready`}</span>
        <span className="grow" />
        <button type="button" className="btn btn--ghost" onClick={() => set({ kit: {} })}>Reset</button>
        <button type="button" className={`btn ${ready ? 'btn--primary' : ''}`} onClick={() => go('finder')}>Open the viewfinder</button>
      </div>
      <div className="kit__cols">
        <div className="kit__col">
          <h2 className="kit__title">Canon C200</h2>
          {item('sd', 'SD card in, space checked', 'UHD records to SD as MP4 or XF-AVC')}
          {item('batt', 'Battery charged, spare packed', 'Check the minutes left on the body')}
          {item('nd', 'ND and white balance set', 'Built-in ND runs from 2 to 10 stops')}
        </div>
        <div className="kit__col">
          <h2 className="kit__title">Sigma 18–35mm f/1.8 Art</h2>
          {item('lens', 'Mounted, front element clean', 'Zoom ring matched to the viewfinder')}
        </div>
        <div className="kit__col">
          <h2 className="kit__title">Audio, two XLR inputs</h2>
          {item('in1', `Input 1: ${mics[0]}`, MIC_DETAIL[mics[0]])}
          {item('in2', `Input 2: ${mics[1]}`, MIC_DETAIL[mics[1]])}
          {item('cans', 'Headphones in', 'Listening to both inputs')}
          <button type="button" className="btn" onClick={() => set({ swap: !s.swap })}>Swap inputs 1 and 2</button>
        </div>
      </div>
    </div>
  );
}
