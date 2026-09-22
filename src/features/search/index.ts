import { type Extension } from '@codemirror/state';
import { EditorView, type Panel } from '@codemirror/view';
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  search,
  setSearchQuery,
} from '@codemirror/search';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

import {
  appendMossIcon,
  mossLucideIcon,
  type MossIconRenderer,
} from '../../core/icons';

export type MossSearchPanelPosition = 'top' | 'center' | 'bottom';

const SEARCH_ICON_PREV = mossLucideIcon(ChevronLeft, { size: 18 });
const SEARCH_ICON_NEXT = mossLucideIcon(ChevronRight, { size: 18 });
const SEARCH_ICON_CLOSE = mossLucideIcon(X, { size: 18 });

export function mossSearch(position: MossSearchPanelPosition = 'top'): Extension {
  return search({
    top: position !== 'bottom',
    createPanel: (view) => {
      const panel = defaultSearchPanel(view, position);
      panel.dom.classList.add('moss-search-panel');
      return panel;
    },
  });
}

function defaultSearchPanel(
  view: EditorView,
  position: MossSearchPanelPosition,
): Panel {
  const dom = document.createElement('div');
  dom.className = 'cm-search';
  dom.classList.add(`moss-search-panel-${position}`);
  dom.setAttribute('aria-label', 'Find');

  const form = document.createElement('form');
  form.autocomplete = 'off';
  form.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeSearchPanel(view);
    view.focus();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    findNext(view);
  });

  const inputPill = document.createElement('div');
  inputPill.className = 'cm-moss-search-input-pill';

  const actionsPill = document.createElement('div');
  actionsPill.className = 'cm-moss-search-actions-pill';

  const initial = getSearchQuery(view.state);

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search';
  searchInput.value = initial.search;
  searchInput.className = 'cm-moss-search-input';
  searchInput.setAttribute('main-field', 'true');
  searchInput.setAttribute('aria-label', 'Search');

  const count = document.createElement('span');
  count.className = 'cm-moss-search-count';
  count.setAttribute('aria-live', 'polite');

  const prevBtn = makeIconButton(
    SEARCH_ICON_PREV,
    'Previous match',
    () => findPrevious(view),
  );
  const nextBtn = makeIconButton(
    SEARCH_ICON_NEXT,
    'Next match',
    () => findNext(view),
  );
  const closeBtn = makeIconButton(
    SEARCH_ICON_CLOSE,
    'Close',
    () => closeSearchPanel(view),
  );

  const recomputeCount = (query: SearchQuery) => {
    if (!query.search) {
      count.textContent = '';
      return;
    }
    try {
      if (!query.valid) {
        count.textContent = '';
        return;
      }
      let n = 0;
      let capped = false;
      const cursor = query.getCursor(view.state.doc);
      while (!cursor.next().done) {
        n++;
        if (n >= 10000) {
          capped = true;
          break;
        }
      }
      count.textContent = capped
        ? '9999+ matches'
        : n === 0
          ? 'No matches'
          : n === 1
            ? '1 match'
            : `${n} matches`;
    } catch {
      count.textContent = '';
    }
  };

  const dispatchQuery = () => {
    const query = new SearchQuery({
      search: searchInput.value,
      caseSensitive: initial.caseSensitive,
      regexp: initial.regexp,
      wholeWord: initial.wholeWord,
    });
    view.dispatch({ effects: setSearchQuery.of(query) });
    recomputeCount(query);
  };

  searchInput.addEventListener('input', dispatchQuery);
  recomputeCount(initial);

  inputPill.append(searchInput, count);
  actionsPill.append(prevBtn, nextBtn, closeBtn);
  form.append(inputPill, actionsPill);
  dom.append(form);

  return {
    dom,
    top: position !== 'bottom',
    mount: () => {
      searchInput.focus();
      searchInput.select();
    },
    update: (update) => {
      const next = getSearchQuery(update.state);
      const prev = getSearchQuery(update.startState);
      if (next.search !== prev.search && searchInput.value !== next.search) {
        searchInput.value = next.search;
      }
      if (update.docChanged || next.search !== prev.search) {
        recomputeCount(next);
      }
    },
  };
}

function makeIconButton(
  icon: MossIconRenderer,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'cm-moss-search-btn';
  appendMossIcon(el, icon, { size: 18, ariaHidden: true });
  el.setAttribute('aria-label', label);
  el.title = label;
  el.addEventListener('click', onClick);
  return el;
}
