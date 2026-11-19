import { describe, expect, it } from 'vitest';
import { memoryStorage } from '@/test-utils/storage';
import { EMPTY_VIEW } from '../filters';
import {
  VIEWS_KEY,
  backUpViews,
  loadViews,
  removeView,
  saveViews,
  upsertView,
} from '../saved-views';

const hidden = { ...EMPTY_VIEW, hidden: ['cache' as const] };

describe('saved views', () => {
  it('come back from storage as they were saved', () => {
    const storage = memoryStorage();
    const views = upsertView([], '  Cache hidden ', hidden, 'v1');

    expect(saveViews(storage, views)).toBe(true);

    expect(loadViews(storage)).toEqual({
      views: [{ id: 'v1', name: 'Cache hidden', view: hidden }],
      lost: false,
    });
  });

  it.each([
    { name: 'no storage', storage: null, lost: false },
    { name: 'nothing saved', storage: memoryStorage(), lost: false },
    { name: 'text that is not JSON', storage: memoryStorage({ [VIEWS_KEY]: '{oops' }), lost: true },
    {
      name: 'a shape from another version',
      storage: memoryStorage({ [VIEWS_KEY]: JSON.stringify({ version: 2, views: [] }) }),
      lost: true,
    },
  ])(
    'load as an empty list for $name, and say so when something stored was lost',
    ({ storage, lost }) => {
      expect(loadViews(storage)).toEqual({ views: [], lost });
    },
  );

  it('lose only the damaged entry, and keep a view that names a widget this version no longer has, without that widget', () => {
    const stored = {
      version: 1,
      views: [
        { id: 'a', name: 'Good', view: hidden },
        { id: 'b', name: 'Old', view: { ...EMPTY_VIEW, hidden: ['cache', 'retired-widget'] } },
        { id: 'c', name: '', view: EMPTY_VIEW },
      ],
    };

    const loaded = loadViews(memoryStorage({ [VIEWS_KEY]: JSON.stringify(stored) }));

    expect(loaded.views.map((entry) => [entry.id, entry.view.hidden])).toEqual([
      ['a', ['cache']],
      ['b', ['cache']],
    ]);
    expect(loaded.lost).toBe(true);
  });

  it('keeps a copy of what is stored before a save replaces it', () => {
    const storage = memoryStorage({ [VIEWS_KEY]: '{oops' });

    backUpViews(storage);

    expect(storage.getItem(`${VIEWS_KEY}:backup`)).toBe('{oops');
  });

  it('report a refused write instead of throwing', () => {
    expect(saveViews(memoryStorage({}, { failWrites: true }), [])).toBe(false);
    expect(saveViews(null, [])).toBe(false);
  });

  it('replace the view of the same name, ignoring case, and can be removed', () => {
    const first = upsertView([], 'Weekly', EMPTY_VIEW, 'v1');
    const second = upsertView(first, 'weekly', hidden, 'v2');

    expect(second).toEqual([{ id: 'v1', name: 'weekly', view: hidden }]);
    expect(removeView(second, 'v1')).toEqual([]);
    expect(upsertView(second, '   ', EMPTY_VIEW, 'v3')).toEqual(second);
  });
});
