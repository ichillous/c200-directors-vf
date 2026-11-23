import { useState } from 'react';
import { frameGeometry } from '../optics';
import { deleteFrame, destinations, destName, go, patchFrame, reframe, set, undoDelete, useApp, type State } from '../store';
import { TAGS, type Frame } from '../types';
import { Option, PickerButton, Sheet, Thumb } from '../ui';
import { exportFrames, saveFile } from '../userdata';

function describe(s: State, f: Frame): string {
  if (f.shot) {
    const dest = destinations(s).find((d) => d.id === f.dest);
    const list = s.data?.shotLists.find((l) => l.id === dest?.shotListId);
    const shot = list?.shots.find((x) => x.no === f.shot);
    return `Shot ${f.shot}${shot ? `, ${shot.name}` : ''}`;
  }
  return f.tag || 'No tag';
}

export function Bank() {
  const s = useApp();
  const [exportNote, setExportNote] = useState('');
  const dests = destinations(s);

  const shown = s.frames.filter((f) => {
    const inPlace = s.showing === 'all' || f.dest === s.showing;
    const inTag = s.tagFilter === '' ? true : s.tagFilter === 'none' ? !f.tag && !f.shot : f.tag === s.tagFilter;
    return inPlace && inTag;
  });
  const sel = s.frames.find((f) => f.id === s.sel) ?? null;
  const geo = sel ? frameGeometry(sel.mm, sel.fmt, s.fov) : null;
  const showingName = s.showing === 'all' ? 'Every frame' : s.showing === 'bank' ? 'Loose in the Shot Bank' : destName(s, s.showing);

  async function onExport() {
    setExportNote('Packing the frames.');
    try {
      const out = await exportFrames();
      const how = await saveFile(out.blob, out.name);
      setExportNote(how === 'shared' ? `Sent ${out.name}.` : `Saved ${out.name}. Attach it to a chat and Claude can label or pull from it.`);
    } catch {
      setExportNote('The export did not go out. Try again.');
    }
  }

  return (
    <div className="screen">
      <div className="screen__head">
        <h1 className="title">Shot Bank</h1>
        <div style={{ width: 210 }}><PickerButton label={showingName} onClick={() => set({ menu: 'showing' })} /></div>
        <div className="bank__filters" role="group" aria-label="Filter by tag">
          {[...TAGS.map((t) => [t, t]), ['none', 'No tag']].map(([id, name]) => (
            <button key={id} type="button" className={`chip chip--round ${s.tagFilter === id ? 'is-on' : ''}`} aria-pressed={s.tagFilter === id} onClick={() => set({ tagFilter: s.tagFilter === id ? '' : id })}>{name}</button>
          ))}
        </div>
      </div>

      <div className="screen__body">
        <div className="bank__left">
          <div className="bank__scroll">
            {s.frames.length === 0 ? (
              <div className="blank">
                <span className="blank__title">No frames yet</span>
                <span className="blank__text">Capture one in the viewfinder and it lands here with its focal length, tag and shoot. Frames stay on this phone.</span>
                <button type="button" className="btn btn--primary" onClick={() => go('finder')}>Open the viewfinder</button>
              </div>
            ) : shown.length === 0 ? (
              <div className="blank">
                <span className="blank__title">Nothing matches these filters</span>
                <button type="button" className="btn" onClick={() => set({ showing: 'all', tagFilter: '' })}>Show every frame</button>
              </div>
            ) : (
              <div className="cards">
                {shown.slice().reverse().map((f) => (
                  <button key={f.id} type="button" className={`card ${f.id === s.sel ? 'is-on' : ''}`} aria-pressed={f.id === s.sel} onClick={() => set({ sel: f.id === s.sel ? '' : f.id, menu: '' })}>
                    <Thumb frame={f} />
                    <span className={`card__what ${f.tag || f.shot ? '' : 'muted'}`}>{describe(s, f)}</span>
                    <span className="card__where">{destName(s, f.dest)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="bank__export">
            <span role="status">{exportNote || 'Export packs every frame and its numbers into one zip you can hand to Claude.'}</span>
            <button type="button" className="btn" disabled={s.frames.length === 0} onClick={() => void onExport()}>Export frames</button>
          </div>
        </div>

        <div className="detail">
          {s.undo && (
            <div className="undo" role="status">
              <span>Frame deleted</span>
              <button type="button" onClick={undoDelete}>Undo</button>
            </div>
          )}
          {!sel || !geo ? (
            <div className="detail__empty">Select a frame to see its numbers, retag it, file it under a shoot or line it up again in the viewfinder.</div>
          ) : (
            <div className="detail__body">
              <Thumb frame={sel} className="detail__thumb" />
              <div className="detail__top">
                <span className="detail__mm">{sel.mm} mm</span>
                <span className="card__where">Captured {new Date(sel.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
              </div>
              <span className="detail__line">≈ {geo.ffEq} mm full-frame, {geo.hfov}° across, {sel.fmt === 'dci' ? '4K DCI' : 'UHD'}</span>
              <span className="detail__line clip">{describe(s, sel)}</span>
              <div className="grow" />
              <div className="detail__row">
                {!sel.shot && <PickerButton small label={sel.tag || 'No tag'} onClick={() => set({ menu: 'tag' })} />}
                <PickerButton small label={destName(s, sel.dest)} onClick={() => set({ menu: 'file' })} />
              </div>
              <div className="detail__row">
                <button type="button" className="btn btn--primary" onClick={() => reframe(sel)}>Line it up again</button>
                <button type="button" className="btn btn--ghost" style={{ flex: 'none' }} onClick={() => deleteFrame(sel.id)}>Delete</button>
              </div>
            </div>
          )}

          {s.menu === 'showing' && (
            <Sheet title="Show" onClose={() => set({ menu: '' })}>
              <Option name="Every frame" on={s.showing === 'all'} onPick={() => set({ showing: 'all', menu: '' })} />
              {dests.map((d) => <Option key={d.id} name={d.id === 'bank' ? 'Loose in the Shot Bank' : d.name} on={s.showing === d.id} onPick={() => set({ showing: d.id, menu: '' })} />)}
            </Sheet>
          )}
          {s.menu === 'tag' && sel && (
            <Sheet title="Tag" onClose={() => set({ menu: '' })}>
              <Option name="No tag" on={!sel.tag} onPick={() => patchFrame(sel.id, { tag: '' })} />
              {TAGS.map((t) => <Option key={t} name={t} on={sel.tag === t} onPick={() => patchFrame(sel.id, { tag: t })} />)}
            </Sheet>
          )}
          {s.menu === 'file' && sel && (
            <Sheet title="File under" onClose={() => set({ menu: '' })}>
              {dests.filter((d) => !d.shotListId || d.id === sel.dest).map((d) => (
                <Option key={d.id} name={d.name} on={sel.dest === d.id} onPick={() => patchFrame(sel.id, { dest: d.id, shot: d.id === sel.dest ? sel.shot : '' })} />
              ))}
            </Sheet>
          )}
        </div>
      </div>
    </div>
  );
}
