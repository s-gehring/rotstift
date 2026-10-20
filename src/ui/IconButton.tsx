import type { ButtonHTMLAttributes, Ref } from 'react';
import { classNames } from './class-names.ts';
import { Icon, type IconName } from './icons.tsx';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'aria-label'
> {
  readonly label: string;
  readonly icon: IconName;
  readonly variant?: 'quiet' | 'secondary';
  readonly tooltip?: 'top' | 'bottom' | 'none';
  readonly tooltipAlign?: 'center' | 'end';
  readonly ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  label,
  icon,
  variant = 'quiet',
  tooltip = 'bottom',
  tooltipAlign = 'center',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      data-tooltip={tooltip === 'none' ? undefined : label}
      data-tooltip-side={tooltip === 'none' ? undefined : tooltip}
      data-tooltip-align={tooltipAlign === 'end' ? 'end' : undefined}
      className={classNames('icon-btn', `btn-${variant}`, className)}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}
