/**
 * The view-mode rules, which used to live in two components and be applied in
 * only one of them.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { SWIPEABLE, effectiveViewMode, swipeTarget } from '../src/hooks/useViewMode.ts';

describe('which view is actually showing', () => {
  test('a phone shows the rendered note where the stored choice is split', () => {
    assert.equal(effectiveViewMode('split', true), 'preview');
  });

  test('and the toolbar therefore has a mode it can mark as current', () => {
    // The bug this replaces: the toolbar highlighted `split`, `split` is not
    // offered on a phone, and so neither Write nor Read looked selected on load.
    const showing = effectiveViewMode('split', true);
    assert.ok(
      SWIPEABLE.includes(showing),
      'whatever a phone shows has to be one of the buttons a phone offers',
    );
  });

  test('a desktop keeps the split it was given', () => {
    assert.equal(effectiveViewMode('split', false), 'split');
  });

  test('an explicit choice is never overridden, at either width', () => {
    for (const narrow of [true, false]) {
      assert.equal(effectiveViewMode('editor', narrow), 'editor');
      assert.equal(effectiveViewMode('preview', narrow), 'preview');
    }
  });
});

describe('swiping between views', () => {
  test('left goes from writing to reading, the way tabs move', () => {
    assert.equal(swipeTarget('editor', 'left'), 'preview');
  });

  test('and right comes back', () => {
    assert.equal(swipeTarget('preview', 'right'), 'editor');
  });

  test('the ends stop rather than wrap', () => {
    assert.equal(swipeTarget('preview', 'left'), null);
    assert.equal(swipeTarget('editor', 'right'), null);
  });

  test('split is not somewhere a swipe can go, so it does not answer', () => {
    // It is not offered on a phone, and swiping into a view that is not on
    // screen would be a gesture with nothing to show for it.
    assert.equal(swipeTarget('split', 'left'), null);
    assert.equal(swipeTarget('split', 'right'), null);
  });

  test('every swipe destination is a view the toolbar offers on a phone', () => {
    for (const from of SWIPEABLE) {
      for (const direction of ['left', 'right'] as const) {
        const to = swipeTarget(from, direction);
        if (to !== null) assert.ok(SWIPEABLE.includes(to));
      }
    }
  });
});
