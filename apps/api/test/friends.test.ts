import { describe, expect, it } from 'vitest';
import { friendStateFor, pairKey } from '../src/lib/friends.js';

describe('pairKey', () => {
  it('is stable regardless of argument order', () => {
    expect(pairKey('a', 'b')).toEqual(pairKey('b', 'a'));
  });

  it('orders lexically, lower id first', () => {
    expect(pairKey('b', 'a')).toEqual(['a', 'b']);
    expect(pairKey('a', 'b')).toEqual(['a', 'b']);
  });
});

describe('friendStateFor', () => {
  it('is none when there is no row', () => {
    expect(friendStateFor(undefined, 'me')).toBe('none');
  });

  it('is friends once accepted, regardless of who requested', () => {
    expect(friendStateFor({ status: 'accepted', requestedBy: 'me' }, 'me')).toBe('friends');
    expect(friendStateFor({ status: 'accepted', requestedBy: 'them' }, 'me')).toBe('friends');
  });

  it('is outgoing when the viewer sent a still-pending request', () => {
    expect(friendStateFor({ status: 'pending', requestedBy: 'me' }, 'me')).toBe('outgoing');
  });

  it('is incoming when the other side sent a still-pending request', () => {
    expect(friendStateFor({ status: 'pending', requestedBy: 'them' }, 'me')).toBe('incoming');
  });
});
