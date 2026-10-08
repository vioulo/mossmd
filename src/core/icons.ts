import { Facet } from '@codemirror/state';

export interface MossIconProps {
  document: Document;
  size?: number;
  strokeWidth?: number;
  className?: string;
  fill?: string;
  ariaHidden?: boolean;
  title?: string;
}

export type MossIconRenderer = (props: MossIconProps) => Node;

export type MossIconKey =
  | 'code.copy'
  | 'code.copied'
  | 'file.copy-link'
  | 'file.download'
  | 'file.file'
  | 'image.cancel'
  | 'image.copy-link'
  | 'image.edit'
  | 'image.placeholder'
  | 'image.preview'
  | 'image.resize'
  | 'image.save'
  | 'search.close'
  | 'search.next'
  | 'search.previous'
  | 'slash.callout'
  | 'slash.code'
  | 'slash.file'
  | 'slash.image'
  | 'slash.list'
  | 'slash.rule'
  | 'slash.side-button'
  | 'slash.snippet'
  | 'slash.table'
  | 'table.column-left'
  | 'table.column-right'
  | 'table.delete'
  | 'table.menu'
  | 'table.row-above'
  | 'table.row-below'
  | 'task.amount'
  | 'task.bookmark'
  | 'task.cancelled'
  | 'task.con'
  | 'task.done'
  | 'task.down'
  | 'task.empty'
  | 'task.idea'
  | 'task.important'
  | 'task.in-progress'
  | 'task.info'
  | 'task.location'
  | 'task.note'
  | 'task.pro'
  | 'task.question'
  | 'task.quote'
  | 'task.scheduled'
  | 'task.star'
  | 'task.todo'
  | 'task.up'
  | 'upload.cancel'
  | 'upload.file'
  | 'upload.retry';

export type MossIconMap = Partial<Record<MossIconKey, MossIconRenderer>>;

export const EMPTY_MOSS_ICON: MossIconRenderer = ({
  document,
  size = 16,
  className,
  ariaHidden,
}) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.classList.add('cm-moss-icon', 'cm-moss-icon-empty');
  if (className) svg.classList.add(...className.split(/\s+/).filter(Boolean));
  if (ariaHidden != null) svg.setAttribute('aria-hidden', String(ariaHidden));
  return svg;
};

export const mossIconFacet = Facet.define<MossIconMap, MossIconMap>({
  combine: (values) => Object.assign({}, ...values),
});

export function resolveMossIcon(
  key: MossIconKey,
  icons: MossIconMap = {},
): MossIconRenderer {
  return icons[key] ?? EMPTY_MOSS_ICON;
}

export function renderMossIcon(
  icon: MossIconRenderer,
  props: MossIconProps,
): Node {
  const node = icon(props);
  if (
    node.nodeType === Node.ELEMENT_NODE &&
    (node as Element).namespaceURI === 'http://www.w3.org/2000/svg'
  ) {
    (node as Element).classList.add('cm-moss-icon');
  }
  return node;
}

export function appendMossIcon(
  target: Element,
  icon: MossIconRenderer,
  props: Omit<MossIconProps, 'document'> = {},
): void {
  const node = renderMossIcon(icon, {
    document: target.ownerDocument,
    ...props,
  });
  target.replaceChildren(node);
}
