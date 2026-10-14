// React 18's `act` helper emits a console warning unless this flag
// is set to indicate we're in a test environment where scheduled
// effects should be flushed synchronously.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Happy-DOM fires `selectionchange` synchronously inside `Selection.collapse()` and
// other selection methods. According to the W3C Selection API specification
// (https://w3c.github.io/selection-api/#selectionchange-event), `selectionchange`
// must be queued asynchronously as a task. Synchronous firing causes re-entrant dispatch
// errors in CodeMirror 6's DOMObserver while CodeMirror is in the middle of updating DOM selection.
if (typeof Document !== 'undefined') {
  let inSelectionChange = false;
  const originalDispatch = Document.prototype.dispatchEvent;
  Document.prototype.dispatchEvent = function (event: Event) {
    if (event.type === 'selectionchange') {
      if (inSelectionChange) return true;
      inSelectionChange = true;
      try {
        return originalDispatch.call(this, event);
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.message.includes('Calls to EditorView.update are not allowed')
        ) {
          // Swallow re-entrant selection sync triggered synchronously by Happy-DOM
          return true;
        }
        throw err;
      } finally {
        inSelectionChange = false;
      }
    }
    return originalDispatch.call(this, event);
  };
}



