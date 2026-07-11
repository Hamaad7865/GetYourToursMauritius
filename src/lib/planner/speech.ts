/**
 * Pure helpers for the planner's voice input (Web Speech API). Kept framework-free so they're unit
 * tested without a browser; the React lifecycle lives in `useVoiceInput`.
 */

/** A SpeechRecognitionResult: an indexed list of alternatives plus whether it's final. */
export interface SpeechResultLike {
  readonly isFinal: boolean;
  readonly 0?: { readonly transcript: string };
}

/**
 * Fold a SpeechRecognitionResultList into its committed (`final`) text and the still-changing
 * (`interim`) tail. We read the whole list each event (rebuild, not append) so re-fired results never
 * double-count. The top alternative ([0]) is the recogniser's best guess.
 */
export function readSpeechResults(results: ArrayLike<SpeechResultLike>): {
  final: string;
  interim: string;
} {
  let final = '';
  let interim = '';
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    if (!result) continue;
    const transcript = result[0]?.transcript ?? '';
    if (result.isFinal) final += transcript;
    else interim += transcript;
  }
  return { final, interim };
}

/** Append dictated text to whatever the user already typed, with exactly one separating space. */
export function appendTranscript(base: string, transcript: string): string {
  const addition = transcript.trim();
  if (!base) return addition;
  if (!addition) return base;
  return base.endsWith(' ') ? base + addition : `${base} ${addition}`;
}
