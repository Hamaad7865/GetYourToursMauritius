'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { appendTranscript, readSpeechResults, type SpeechResultLike } from '@/lib/planner/speech';

/** Minimal shape of the Web Speech API recognizer we use — typed locally so we don't depend on the
 *  (patchy) lib.dom SpeechRecognition typings and never resort to `any`. */
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { results: ArrayLike<SpeechResultLike> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Dictation for a text input via the browser's Web Speech API — no backend, no billing. Tapping the
 * mic transcribes speech into the field (appended to whatever was typed) for the user to review, then
 * send. `supported` is resolved after mount so the mic only appears where the API exists, without an
 * SSR/client hydration mismatch.
 */
export function useVoiceInput({ lang, value, onChange }: { lang: string; value: string; onChange: (text: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<RecognitionLike | null>(null);
  // Read the live field value at start-time without re-creating `start` on every keystroke.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    setSupported(recognitionCtor() !== null);
  }, []);

  const stop = useCallback(() => recRef.current?.stop(), []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;
    const base = valueRef.current;
    rec.onresult = (event) => {
      const { final, interim } = readSpeechResults(event.results);
      onChangeRef.current(appendTranscript(base, final + interim));
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
    };
    recRef.current = rec;
    setListening(true);
    rec.start();
  }, [lang]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  // Abort any in-flight recognition if the component unmounts (e.g. mobile tab switch).
  useEffect(() => () => recRef.current?.abort(), []);

  return { supported, listening, toggle };
}
