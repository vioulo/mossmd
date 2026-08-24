import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LucideIcon, LucideProps } from 'lucide-react';

export function lucideSvg(
  Icon: LucideIcon,
  props: LucideProps = {},
): string {
  return renderToStaticMarkup(createElement(Icon, props));
}
