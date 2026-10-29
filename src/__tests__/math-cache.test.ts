import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  MathRenderLruCache,
  InlineMathWidget,
  BlockMathWidget,
  defaultMathRenderCache,
} from '../features/math/widget';
import type { MossMathRenderer } from '../features/math/widget';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';

describe('Math LRU Render Cache', () => {
  beforeEach(() => {
    defaultMathRenderCache.clear();
  });

  it('evicts least recently used items when capacity is reached', () => {
    const cache = new MathRenderLruCache(3);
    cache.set('k1', 'html1');
    cache.set('k2', 'html2');
    cache.set('k3', 'html3');
    expect(cache.size).toBe(3);

    // Access k1 to make it most recently used (k2 is now oldest)
    expect(cache.get('k1')).toBe('html1');

    // Add k4, should evict k2
    cache.set('k4', 'html4');
    expect(cache.has('k2')).toBe(false);
    expect(cache.has('k1')).toBe(true);
    expect(cache.has('k3')).toBe(true);
    expect(cache.has('k4')).toBe(true);
  });

  it('caches renderer.render string output and avoids repeated compilations', () => {
    const renderSpy = vi.fn((source: string, mode: 'inline' | 'block') => {
      return `<span class="compiled-${mode}">${source}</span>`;
    });
    const renderer: MossMathRenderer = { render: renderSpy };

    const state = EditorState.create({ doc: '$E=mc^2$' });
    const view = new EditorView({ state });

    const widget1 = new InlineMathWidget('E=mc^2', renderer, 0, 8);
    const dom1 = widget1.toDOM(view);
    expect(dom1.innerHTML).toBe('<span class="compiled-inline">E=mc^2</span>');
    expect(renderSpy).toHaveBeenCalledTimes(1);

    // Second mount of identical formula
    const widget2 = new InlineMathWidget('E=mc^2', renderer, 0, 8);
    const dom2 = widget2.toDOM(view);
    expect(dom2.innerHTML).toBe('<span class="compiled-inline">E=mc^2</span>');
    // Should be served directly from cache without calling renderer.render again!
    expect(renderSpy).toHaveBeenCalledTimes(1);

    // Block mode of the same source should be separate cache entry
    const blockWidget = new BlockMathWidget('E=mc^2', renderer, 0, 8);
    const blockDom = blockWidget.toDOM(view);
    expect(blockDom.innerHTML).toBe('<span class="compiled-block">E=mc^2</span>');
    expect(renderSpy).toHaveBeenCalledTimes(2);

    // Subsequent block mount should hit cache
    const blockWidget2 = new BlockMathWidget('E=mc^2', renderer, 0, 8);
    blockWidget2.toDOM(view);
    expect(renderSpy).toHaveBeenCalledTimes(2);

    view.destroy();
  });
});

