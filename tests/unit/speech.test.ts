import { describe, expect, it } from 'vitest';
import { readSpeechResults, appendTranscript } from '@/lib/planner/speech';

/** A SpeechRecognitionResult-like for tests: indexed alternative + isFinal flag. */
const res = (transcript: string, isFinal: boolean) => ({ 0: { transcript }, isFinal });

describe('readSpeechResults', () => {
  it('returns empty strings for no results', () => {
    expect(readSpeechResults([])).toEqual({ final: '', interim: '' });
  });

  it('concatenates final results and collects the interim ones separately', () => {
    const results = [res('Hello ', true), res('world ', true), res('how are', false)];
    expect(readSpeechResults(results)).toEqual({ final: 'Hello world ', interim: 'how are' });
  });

  it('tolerates a result with no alternative', () => {
    const results = [{ isFinal: true } as unknown as { 0: { transcript: string }; isFinal: boolean }, res('ok', true)];
    expect(readSpeechResults(results)).toEqual({ final: 'ok', interim: '' });
  });
});

describe('appendTranscript', () => {
  it('returns the trimmed transcript when the base is empty', () => {
    expect(appendTranscript('', '  add a beach')).toBe('add a beach');
  });

  it('joins with a single space when the base has no trailing space', () => {
    expect(appendTranscript('add a beach', 'near Grand Baie')).toBe('add a beach near Grand Baie');
  });

  it('does not double the space when the base already ends with one', () => {
    expect(appendTranscript('add a beach ', 'near Grand Baie')).toBe('add a beach near Grand Baie');
  });

  it('leaves the base unchanged for an empty transcript', () => {
    expect(appendTranscript('add a beach', '   ')).toBe('add a beach');
  });
});
