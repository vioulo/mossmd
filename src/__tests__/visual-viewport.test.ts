import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { visualViewportExtension } from '../core/visual-viewport';

describe('visualViewportExtension', () => {
  let originalVisualViewport: VisualViewport | null | undefined;

  beforeEach(() => {
    originalVisualViewport = window.visualViewport;
  });

  afterEach(() => {
    Object.defineProperty(window, 'visualViewport', {
      value: originalVisualViewport,
      writable: true,
      configurable: true,
    });
  });

  it('runs safely without throwing when visualViewport is not available', () => {
    Object.defineProperty(window, 'visualViewport', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const container = document.createElement('div');
    document.body.appendChild(container);

    const view = new EditorView({
      state: EditorState.create({
        doc: 'Test without visualViewport',
        extensions: [visualViewportExtension()],
      }),
      parent: container,
    });

    expect(view.dom).toBeDefined();
    view.destroy();
    container.remove();
  });

  it('calculates keyboard offset and sets CSS variables on the host element', () => {
    const listeners = new Map<string, () => void>();
    const mockVv = {
      height: 800,
      offsetTop: 0,
      addEventListener: vi.fn((event: string, cb: () => void) => {
        listeners.set(event, cb);
      }),
      removeEventListener: vi.fn((event: string) => {
        listeners.delete(event);
      }),
    };

    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    Object.defineProperty(window, 'visualViewport', {
      value: mockVv,
      writable: true,
      configurable: true,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const view = new EditorView({
      state: EditorState.create({
        doc: 'Keyboard test line 1\nKeyboard test line 2',
        extensions: [visualViewportExtension()],
      }),
      parent: host,
    });

    // Initially height 800 === innerHeight 800 -> keyboard offset = 0
    expect(host.style.getPropertyValue('--moss-keyboard-offset')).toBe('0px');
    expect(host.style.getPropertyValue('--moss-visual-viewport-height')).toBe('800px');

    // Simulate soft keyboard opening (visualViewport shrinks to 450px)
    mockVv.height = 450;
    const resizeListener = listeners.get('resize');
    expect(resizeListener).toBeDefined();
    resizeListener?.();

    // Keyboard offset = 800 - 450 = 350px
    expect(host.style.getPropertyValue('--moss-keyboard-offset')).toBe('350px');
    expect(host.style.getPropertyValue('--moss-visual-viewport-height')).toBe('450px');

    // Simulate soft keyboard closing
    mockVv.height = 800;
    resizeListener?.();
    expect(host.style.getPropertyValue('--moss-keyboard-offset')).toBe('0px');

    view.destroy();
    expect(mockVv.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(mockVv.removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function));
    host.remove();
  });
});
