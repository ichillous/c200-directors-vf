import type { Format } from './optics';

export type Folder = 'FAMILY' | 'FRIENDS' | 'ME' | 'PROJECTS';
export const FOLDERS: Folder[] = ['FAMILY', 'FRIENDS', 'ME', 'PROJECTS'];

export type View = 'finder' | 'bank' | 'shoots' | 'board' | 'kit';

export const TAGS = ['Interview', 'B-roll', 'Vérité', 'Establishing'];

/** Items on the pre-roll check. */
export const KIT_IDS = ['sd', 'batt', 'nd', 'lens', 'in1', 'in2', 'cans'];

/** A shoot folder, named the way it sits in FOOTAGE on Drive. */
export interface Shoot {
  id: string;
  folder: Folder;
  name: string;
  /** YYYY-MM-DD or YYYY-MM. A full date today or later makes it an upcoming shoot. */
  date?: string;
  place?: string;
  /** A project with no single date, such as a documentary you keep shooting. */
  ongoing?: boolean;
  /** Shown indented under the project above it. */
  nested?: boolean;
  shotListId?: string;
}

/** Something you plan to shoot that has no footage folder yet. */
export interface Planned {
  id: string;
  name: string;
  note?: string;
  shotListId?: string;
}

export interface Shot {
  no: string;
  name: string;
  /** Camera position number, or 0 when the entry needs no camera. */
  pos: number;
  lo: number;
  hi: number;
  /** Where the ring starts when you frame this shot. */
  first: number;
  start?: string;
  sec?: number;
  lensNote?: string;
}

export interface ShotList {
  id: string;
  title: string;
  summary?: string;
  note?: string;
  positions: Record<string, string>;
  shots: Shot[];
}

/** Your own shoots and shot lists, imported from a file and kept on this device only. */
export interface UserData {
  version: 1;
  shoots: Shoot[];
  planned: Planned[];
  shotLists: ShotList[];
}

export interface Frame {
  id: string;
  mm: number;
  fmt: Format;
  /** 'bank', a shoot id or a planned id. */
  dest: string;
  tag: string;
  shot: string;
  at: number;
  hasImage: boolean;
  /** Frame width as a share of the phone view when captured, for the no-image glyph. */
  frac: number;
}

export interface Destination {
  id: string;
  name: string;
  shotListId?: string;
}
