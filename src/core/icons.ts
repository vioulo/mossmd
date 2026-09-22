import type { ReactElement } from 'react';
import type { IconNode, LucideIcon, LucideProps } from 'lucide-react';

type PrimitiveAttr = string | number | boolean | null | undefined;

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

interface LucideRenderElementProps {
  iconNode?: IconNode;
  className?: string;
}

interface RenderableLucideIcon {
  render?: (
    props: LucideProps,
    ref: unknown,
  ) => ReactElement<LucideRenderElementProps>;
}

function attrName(name: string): string {
  if (name === 'className') return 'class';
  if (name === 'viewBox') return 'viewBox';
  if (name === 'preserveAspectRatio') return 'preserveAspectRatio';
  return name.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function setAttr(
  element: Element,
  name: string,
  value: PrimitiveAttr,
): void {
  if (value == null || name === 'key' || name === 'ref') return;
  element.setAttribute(attrName(name), String(value));
}

function mergeClassName(...values: (string | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}

function iconNodeFromLucide(Icon: LucideIcon): IconNode {
  const render = (Icon as unknown as RenderableLucideIcon).render;
  const element = render?.({}, null);
  const iconNode = element?.props.iconNode;
  return Array.isArray(iconNode) ? iconNode : [];
}

function lucideAttrs(props: LucideProps = {}): Record<string, PrimitiveAttr> {
  const {
    size = 24,
    color,
    fill = 'none',
    strokeWidth = 2,
    absoluteStrokeWidth,
    className,
    children: _children,
    ...rest
  } = props;
  const numericSize =
    typeof size === 'number'
      ? size
      : Number.parseFloat(String(size));
  const resolvedStrokeWidth =
    absoluteStrokeWidth && Number.isFinite(numericSize) && numericSize > 0
      ? (Number(strokeWidth) * 24) / numericSize
      : strokeWidth;

  return {
    xmlns: 'http://www.w3.org/2000/svg',
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill,
    stroke: color ?? 'currentColor',
    strokeWidth: resolvedStrokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: mergeClassName('cm-moss-icon', className),
    ...rest,
  } as unknown as Record<string, PrimitiveAttr>;
}

export function renderLucideIcon(
  document: Document,
  Icon: LucideIcon,
  props: LucideProps = {},
): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const attrs = lucideAttrs(props);
  for (const [name, value] of Object.entries(attrs)) {
    setAttr(svg, name, value);
  }

  for (const [tag, childAttrs] of iconNodeFromLucide(Icon)) {
    const child = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(childAttrs)) {
      setAttr(child, name, value);
    }
    svg.appendChild(child);
  }

  return svg;
}

export function mossLucideIcon(
  Icon: LucideIcon,
  defaults: Omit<LucideProps, 'ref'> = {},
): MossIconRenderer {
  return (props) =>
    renderLucideIcon(props.document, Icon, {
      ...defaults,
      size: props.size ?? defaults.size,
      strokeWidth: props.strokeWidth ?? defaults.strokeWidth,
      className: props.className ?? defaults.className,
      fill: props.fill ?? defaults.fill,
      'aria-hidden': props.ariaHidden ?? defaults['aria-hidden'],
    });
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
