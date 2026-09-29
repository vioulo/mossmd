import type { ReactElement } from 'react';
import type { IconNode, LucideIcon, LucideProps } from 'lucide-react';
import type { MossIconProps, MossIconRenderer } from '../core/icons';

type PrimitiveAttr = string | number | boolean | null | undefined;

interface LucideRenderElementProps {
  iconNode?: IconNode;
  icon?: {
    node?: IconNode;
  };
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
  value: unknown,
): void {
  if (value == null || name === 'key' || name === 'ref') return;
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean' &&
    typeof value !== 'bigint'
  ) {
    return;
  }
  element.setAttribute(attrName(name), String(value));
}

function mergeClassName(...values: (string | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}

function iconNodeFromLucide(Icon: LucideIcon): IconNode {
  const render = (Icon as unknown as RenderableLucideIcon).render;
  const element = render?.({}, null);
  const legacyNode = element?.props.iconNode;
  if (Array.isArray(legacyNode)) return legacyNode;
  const currentNode = element?.props.icon?.node;
  return Array.isArray(currentNode) ? currentNode : [];
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
  return (props: MossIconProps) =>
    renderLucideIcon(props.document, Icon, {
      ...defaults,
      size: props.size ?? defaults.size,
      strokeWidth: props.strokeWidth ?? defaults.strokeWidth,
      className: props.className ?? defaults.className,
      fill: props.fill ?? defaults.fill,
      'aria-hidden': props.ariaHidden ?? defaults['aria-hidden'],
    });
}
