import { createElement } from 'react';
import type { SVGProps } from 'react';
import type { IconNode, LucideIcon } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { renderLucideIcon } from '../icons/lucide';

type FakeLucideRenderProps = SVGProps<SVGSVGElement> & {
  iconNode?: IconNode;
  icon?: {
    node?: IconNode;
  };
};

function lucideIconWithProps(props: FakeLucideRenderProps): LucideIcon {
  return {
    render: () => createElement('svg', props),
  } as unknown as LucideIcon;
}

describe('renderLucideIcon', () => {
  it('reads legacy lucide iconNode render output', () => {
    const iconNode: IconNode = [['path', { d: 'M1 2h3', key: 'legacy' }]];
    const Icon = lucideIconWithProps({ iconNode });

    const svg = renderLucideIcon(document, Icon);

    expect(svg.querySelector('path')?.getAttribute('d')).toBe('M1 2h3');
  });

  it('reads lucide icon.node render output', () => {
    const iconNode: IconNode = [
      ['circle', { cx: '12', cy: '12', r: '4', key: 'next' }],
    ];
    const Icon = lucideIconWithProps({ icon: { node: iconNode } });

    const svg = renderLucideIcon(document, Icon);

    expect(svg.querySelector('circle')?.getAttribute('r')).toBe('4');
  });
});
