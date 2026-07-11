'use client';
import { useEffect, useState, useCallback } from 'react';

export type NoteType = 'secured' | 'expiring' | 'expired' | 'unavailable' | 'error';
export interface Note { id: string; type: NoteType; message: string; createdAt: number; read: boolean; }

const KEY = 'gytm:inbox';
const EVENT = 'gytm:inbox';
const CAP = 20;

export function addNote(notes: Note[], n: Note): Note[] {
  if (notes.some((x) => x.id === n.id)) return notes;
  return [n, ...notes];
}
export function capNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => b.createdAt - a.createdAt).slice(0, CAP);
}
export function unreadCount(notes: Note[]): number {
  return notes.filter((n) => !n.read).length;
}

function read(): Note[] {
  if (typeof window === 'undefined') return [];
  try { return capNotes(JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as Note[]); } catch { return []; }
}
function write(notes: Note[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(capNotes(notes)));
    window.dispatchEvent(new Event(EVENT));
  } catch { /* private mode — ignore */ }
}

/** Imperative push (callable outside React, e.g. from the cart reconcile). De-dupes by id. */
export function pushNotification(type: NoteType, message: string, id?: string): void {
  if (typeof window === 'undefined') return;
  const n: Note = { id: id ?? `${type}:${message}:${Date.now()}`, type, message, createdAt: Date.now(), read: false };
  write(addNote(read(), n));
}

export function useInbox() {
  const [notes, setNotes] = useState<Note[]>([]);
  useEffect(() => {
    const sync = () => setNotes(read());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener('storage', sync); };
  }, []);
  const markAllRead = useCallback(() => write(read().map((n) => ({ ...n, read: true }))), []);
  const clear = useCallback(() => write([]), []);
  return { notes, unread: unreadCount(notes), markAllRead, clear };
}
