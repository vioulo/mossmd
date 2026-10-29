import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  linkIconHitTarget,
  previewActivityExtension,
} from '../core/preview-activity';

describe('preview-activity', () => {
  describe('linkIconHitTarget', () => {
    function createMockLink(rect: DOMRect, fontSize = '16px'): HTMLElement {
      const link = document.createElement('span');
      link.className = 'cm-moss-link';
      link.style.fontSize = fontSize;
      link.getClientRects = () => [rect] as unknown as DOMRectList;
      return link;
    }

    it('detects click on link icon with fine pointer (mouse)', () => {
      // Link rect from (100, 50) to (200, 70).
      // emSize = 16, iconZone = 16 * 1.25 = 20.
      // Icon zone: x in [180, 200], y in [50, 70].
      const rect = {
        left: 100,
        right: 200,
        top: 50,
        bottom: 70,
        width: 100,
        height: 20,
      } as DOMRect;
      const link = createMockLink(rect);
      document.body.appendChild(link);

      // Mouse click on icon (x=190, y=60)
      const mouseEvent = new MouseEvent('click', { clientX: 190, clientY: 60 });
      Object.defineProperty(mouseEvent, 'target', { value: link });
      expect(linkIconHitTarget(mouseEvent)).toBe(link);

      // Mouse click on text before icon zone (x=170, y=60)
      const textClick = new MouseEvent('click', { clientX: 170, clientY: 60 });
      Object.defineProperty(textClick, 'target', { value: link });
      expect(linkIconHitTarget(textClick)).toBeNull();

      // Mouse click slightly outside top edge (x=190, y=45)
      const outsideClick = new MouseEvent('click', { clientX: 190, clientY: 45 });
      Object.defineProperty(outsideClick, 'target', { value: link });
      expect(linkIconHitTarget(outsideClick)).toBeNull();

      link.remove();
    });

    it('expands hit target to at least 44x44px for touch (coarse pointer)', () => {
      const rect = {
        left: 100,
        right: 200,
        top: 50,
        bottom: 70,
        width: 100,
        height: 20,
      } as DOMRect;
      const link = createMockLink(rect);
      document.body.appendChild(link);

      // Touch pointer event slightly above icon (y=45, top is 50, within 44px vertical target)
      const touchAbove = new PointerEvent('click', {
        clientX: 190,
        clientY: 45,
        pointerType: 'touch',
      });
      Object.defineProperty(touchAbove, 'target', { value: link });
      expect(linkIconHitTarget(touchAbove)).toBe(link);

      // Touch pointer event slightly right of icon (x=208, right is 200, within 44px target)
      const touchRight = new PointerEvent('click', {
        clientX: 208,
        clientY: 60,
        pointerType: 'touch',
      });
      Object.defineProperty(touchRight, 'target', { value: link });
      expect(linkIconHitTarget(touchRight)).toBe(link);

      // Touch pointer event far away (x=240, y=60)
      const touchFar = new PointerEvent('click', {
        clientX: 240,
        clientY: 60,
        pointerType: 'touch',
      });
      Object.defineProperty(touchFar, 'target', { value: link });
      expect(linkIconHitTarget(touchFar)).toBeNull();

      link.remove();
    });
  });

  describe('freezeMousePlugin touch scrolling vs tap', () => {
    it('does not preventDefault on touch pointerdown in scroller space', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const view = new EditorView({
        state: EditorState.create({
          doc: 'Hello world',
          extensions: [previewActivityExtension()],
        }),
        parent: container,
      });

      // Mock layout dimensions so contentRect.width > 0 in Happy DOM
      vi.spyOn(view.contentDOM, 'getBoundingClientRect').mockReturnValue({
        left: 50,
        right: 650,
        top: 0,
        bottom: 500,
        width: 600,
        height: 500,
      } as DOMRect);
      vi.spyOn(view, 'posAtCoords').mockReturnValue(0);

      // Target scrollDOM outside contentDOM
      const scrollDOM = view.scrollDOM;
      expect(view.contentDOM.contains(scrollDOM)).toBe(false);

      const touchDown = new PointerEvent('pointerdown', {
        clientX: 500,
        clientY: 500,
        pointerType: 'touch',
        button: 0,
        bubbles: true,
        cancelable: true,
      });
      const preventDefaultSpy = vi.spyOn(touchDown, 'preventDefault');

      scrollDOM.dispatchEvent(touchDown);

      // For touch, preventDefault must NOT be called so native scrolling works!
      expect(preventDefaultSpy).not.toHaveBeenCalled();

      // For mouse, preventDefault must be called to preserve desktop behavior
      const mouseDown = new PointerEvent('pointerdown', {
        clientX: 500,
        clientY: 500,
        pointerType: 'mouse',
        button: 0,
        bubbles: true,
        cancelable: true,
      });
      const mousePreventSpy = vi.spyOn(mouseDown, 'preventDefault');

      scrollDOM.dispatchEvent(mouseDown);
      expect(mousePreventSpy).toHaveBeenCalled();

      view.destroy();
      container.remove();
    });

    it('cancels tap selection if touch moves more than 10px (kinetic scroll)', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const view = new EditorView({
        state: EditorState.create({
          doc: 'Hello world',
          extensions: [previewActivityExtension()],
        }),
        parent: container,
      });

      vi.spyOn(view.contentDOM, 'getBoundingClientRect').mockReturnValue({
        left: 50,
        right: 650,
        top: 0,
        bottom: 500,
        width: 600,
        height: 500,
      } as DOMRect);
      vi.spyOn(view, 'posAtCoords').mockReturnValue(0);

      const scrollDOM = view.scrollDOM;
      const dispatchSpy = vi.spyOn(view, 'dispatch');

      // 1. Touch start at (100, 100)
      scrollDOM.dispatchEvent(
        new PointerEvent('pointerdown', {
          clientX: 100,
          clientY: 100,
          pointerType: 'touch',
          button: 0,
          bubbles: true,
        }),
      );

      // 2. Touch moves 50px vertically (scrolling)
      window.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: 100,
          clientY: 150,
          pointerType: 'touch',
          bubbles: true,
        }),
      );

      // 3. Touch release
      window.dispatchEvent(
        new PointerEvent('pointerup', {
          clientX: 100,
          clientY: 150,
          pointerType: 'touch',
          bubbles: true,
        }),
      );

      // Because touch moved > 10px, it was a scroll gesture, no selection dispatch!
      expect(dispatchSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({
          userEvent: 'select.pointer',
        }),
      );

      view.destroy();
      container.remove();
    });

    it('dispatches selection on quick tap in scroller space without scrolling', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const view = new EditorView({
        state: EditorState.create({
          doc: 'Hello world',
          extensions: [previewActivityExtension()],
        }),
        parent: container,
      });

      vi.spyOn(view.contentDOM, 'getBoundingClientRect').mockReturnValue({
        left: 50,
        right: 650,
        top: 0,
        bottom: 500,
        width: 600,
        height: 500,
      } as DOMRect);
      vi.spyOn(view, 'posAtCoords').mockReturnValue(5);

      const scrollDOM = view.scrollDOM;
      const dispatchSpy = vi.spyOn(view, 'dispatch');

      // 1. Touch down
      scrollDOM.dispatchEvent(
        new PointerEvent('pointerdown', {
          clientX: 100,
          clientY: 100,
          pointerType: 'touch',
          button: 0,
          bubbles: true,
        }),
      );

      // 2. Quick release without moving
      window.dispatchEvent(
        new PointerEvent('pointerup', {
          clientX: 100,
          clientY: 100,
          pointerType: 'touch',
          bubbles: true,
        }),
      );

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          selection: { anchor: 5 },
          userEvent: 'select.pointer',
        }),
      );

      view.destroy();
      container.remove();
    });
  });
});
