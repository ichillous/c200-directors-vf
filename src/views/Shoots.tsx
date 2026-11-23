import { useState, type ChangeEvent } from 'react';
import { cleanShootName, chooseDest, createShoot, dayNote, framesFor, go, set, todayStr, useApp, type State } from '../store';
import { FOLDERS, type Folder, type Shoot } from '../types';
import { readUserDataFile } from '../userdata';

function countNote(s: State, id: string): string {
  const n = framesFor(s, id);
  return n === 0 ? '' : n === 1 ? '1 frame' : `${n} frames`;
}

function frameFor(id: string) {
  chooseDest(id);
  go('finder');
}

function openBoard(listId: string) {
  set({ boardList: listId });
  go('board');
}

function ShootRow({ s, shoot }: { s: State; shoot: Shoot }) {
  const made = s.made.some((m) => m.id === shoot.id);
  const ahead = dayNote(shoot.date);
  if (!shoot.ongoing && !ahead && !made) {
    return (
      <div className={`past ${shoot.nested ? 'is-nested' : ''}`}>
        <span className="grow clip">{shoot.name}</span>
        {shoot.place && <small>{shoot.place}</small>}
      </div>
    );
  }
  const note = countNote(s, shoot.id) || (shoot.ongoing ? 'ongoing' : ahead || 'new');
  return (
    <button type="button" className="live" onClick={() => (shoot.shotListId ? openBoard(shoot.shotListId) : frameFor(shoot.id))}>
      <span className="grow clip">{shoot.name}</span>
      <small>{note}</small>
      <b>{shoot.shotListId ? 'Shot board' : shoot.ongoing ? 'Frame the next day' : 'Frame it'}</b>
    </button>
  );
}

function FolderBlock({ s, folder }: { s: State; folder: Folder }) {
  const rows = [...(s.data?.shoots ?? []), ...s.made].filter((sh) => sh.folder === folder);
  return (
    <>
      <h2 className="folder">FOOTAGE / {folder}</h2>
      {rows.length === 0 ? <span className="folder__empty">Nothing here yet</span> : rows.map((sh) => <ShootRow key={sh.id} s={s} shoot={sh} />)}
    </>
  );
}

export function Shoots() {
  const s = useApp();
  const [folder, setFolder] = useState<Folder>('PROJECTS');
  const [what, setWhat] = useState('');
  const [note, setNote] = useState('');
  const clean = cleanShootName(what);
  const planned = s.data?.planned ?? [];

  async function onImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = await readUserDataFile(file);
      set({ data });
      setNote(`Imported ${data.shoots.length} shoots and ${data.shotLists.length} shot ${data.shotLists.length === 1 ? 'list' : 'lists'}.`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'That file could not be imported.');
    }
  }

  return (
    <div className="screen">
      <div className="screen__head" style={{ gap: 10 }}>
        <h1 className="title">Shoots</h1>
        <span className="shoots__preview clip">FOOTAGE / {folder} / {todayStr()}_{clean || '…'}</span>
        <label htmlFor="new-folder" className="label" style={{ flex: 'none' }}>New shoot in</label>
        <select id="new-folder" className="select" value={folder} onChange={(e) => setFolder(e.target.value as Folder)}>
          {FOLDERS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <input className="field" style={{ width: 160 }} type="text" aria-label="What the shoot is" placeholder="What it is" value={what} onChange={(e) => setWhat(e.target.value)} />
        <button type="button" className="btn btn--primary" disabled={!clean} onClick={() => { createShoot(folder, what); setWhat(''); }}>Create</button>
      </div>

      <div className="shoots__cols">
        <div className="shoots__col">
          <FolderBlock s={s} folder="FAMILY" />
          <FolderBlock s={s} folder="FRIENDS" />
          <FolderBlock s={s} folder="ME" />
          <h2 className="folder">Your data file</h2>
          {!s.data && <p className="intro" style={{ marginTop: 0 }}>Import your shoots and shot lists from a file. They stay on this phone and never go into the app’s code.</p>}
          <label className="btn" style={{ alignSelf: 'flex-start' }}>
            <span>{s.data ? 'Import a newer file' : 'Import shoots and shot lists'}</span>
            <input className="visually-hidden" type="file" accept="application/json,.json" onChange={(e) => void onImport(e)} />
          </label>
          {note && <span className="notice" role="status" style={{ marginTop: 6 }}>{note}</span>}
        </div>
        <div className="shoots__col">
          <FolderBlock s={s} folder="PROJECTS" />
          {planned.length > 0 && <h2 className="folder">Planned, no footage folder yet</h2>}
          {planned.map((p) => (
            <button key={p.id} type="button" className="live" onClick={() => (p.shotListId ? openBoard(p.shotListId) : frameFor(p.id))}>
              <span className="grow clip">{p.name}</span>
              <small>{countNote(s, p.id) || p.note || ''}</small>
              <b>{p.shotListId ? 'Shot board' : 'Frame it'}</b>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
