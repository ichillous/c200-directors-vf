import { cameraShots, destinations, frameShot, go, set, useApp } from '../store';
import type { Shot } from '../types';
import { Icon, ICONS } from '../ui';

const lensText = (sh: Shot) => sh.lensNote ?? (sh.lo === sh.hi ? `${sh.lo} mm` : `${sh.lo} to ${sh.hi} mm`);

function listNumbers(nos: string[]): string {
  if (nos.length <= 1) return nos.join('');
  return `${nos.slice(0, -1).join(', ')} and ${nos[nos.length - 1]}`;
}

export function Board() {
  const s = useApp();
  const list = s.data?.shotLists.find((l) => l.id === s.boardList) ?? s.data?.shotLists[0];

  if (!list) {
    return (
      <div className="screen">
        <div className="blank">
          <span className="blank__title">No shot list on this phone</span>
          <span className="blank__text">Import your data file from the Shoots screen and its shot lists show up here.</span>
          <button type="button" className="btn btn--primary" onClick={() => go('shoots')}>Go to Shoots</button>
        </div>
      </div>
    );
  }

  const cams = cameraShots(list);
  const shot = cams.find((sh) => sh.no === s.shot) ?? cams[0];
  const dest = destinations(s).find((d) => d.shotListId === list.id);
  const refs = (no: string) => (dest ? s.frames.filter((f) => f.dest === dest.id && f.shot === no).length : 0);
  const positions = [...new Set(cams.map((sh) => sh.pos))].sort((a, b) => a - b);
  const noCamera = list.shots.filter((sh) => sh.pos === 0).map((sh) => sh.no);

  return (
    <div className="screen" style={{ paddingBottom: 8 }}>
      <div className="screen__head">
        <button type="button" className="btn btn--quiet" style={{ paddingLeft: 8 }} onClick={() => go('shoots')}>
          <Icon d={ICONS.left} />
          <span>Shoots</span>
        </button>
        <h1 className="title">{list.title}</h1>
        <div className="board__meta">
          {list.summary && <span>{list.summary}</span>}
          {list.note && <span>{list.note}</span>}
        </div>
      </div>

      <div className="screen__body">
        <div className="board">
          {positions.flatMap((p) => {
            const row = cams.filter((sh) => sh.pos === p);
            const lines = Math.max(1, Math.ceil(row.length / 7));
            return Array.from({ length: lines }, (_, line) => [
              line === 0 ? (
                <span key={`p${p}`} className="board__pos"><b>{p}</b><span>{list.positions[p] ?? `Position ${p}`}</span></span>
              ) : (
                <span key={`p${p}-${line}`} />
              ),
              ...Array.from({ length: 7 }, (_, i) => {
                const sh = row[line * 7 + i];
                if (!sh) return <span key={`b${p}-${line}-${i}`} />;
                const framed = refs(sh.no) > 0;
                const on = sh.no === shot?.no;
                return (
                  <button key={sh.no} type="button" className={`shot ${on ? 'is-on' : framed ? 'is-framed' : ''}`} aria-pressed={on} aria-label={`Shot ${sh.no}, ${sh.name}, ${framed ? 'framed' : 'not framed yet'}`} onClick={() => set({ shot: sh.no })}>
                    <b>{sh.no}</b>
                    <small>{sh.lo === sh.hi ? sh.lo : `${sh.lo}–${sh.hi}`}</small>
                  </button>
                );
              }),
            ]).flat();
          })}
        </div>

        {shot && (
          <div className="shotcard">
            <span className="shotcard__no">Shot {shot.no}</span>
            <span className="shotcard__name">{shot.name}</span>
            <div className="fact"><span>Position</span><span>{shot.pos}{list.positions[shot.pos] ? `, ${list.positions[shot.pos].toLowerCase()}` : ''}</span></div>
            {shot.start && <div className="fact"><span>Starts</span><span>{shot.start}</span></div>}
            {shot.sec !== undefined && <div className="fact"><span>Runs</span><span>{shot.sec} s</span></div>}
            <div className="fact"><span>Lens</span><span>{lensText(shot)}</span></div>
            <div className="fact"><span>Reference frames</span><span>{refs(shot.no) === 0 ? 'None yet' : refs(shot.no)}</span></div>
            <div className="grow" />
            {noCamera.length > 0 && <span className="shotcard__foot">{noCamera.length === 1 ? 'Entry' : 'Entries'} {listNumbers(noCamera)} {noCamera.length === 1 ? 'has' : 'have'} no camera position.</span>}
            <button type="button" className="btn btn--primary" style={{ height: 48, fontSize: 15 }} disabled={!dest} onClick={() => frameShot(list.id, shot.no, shot.first)}>Frame this shot</button>
          </div>
        )}
      </div>
    </div>
  );
}
