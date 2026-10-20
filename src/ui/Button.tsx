import type { ButtonHTMLAttributes, Ref } from 'react';
import { classNames } from './class-names.ts';
import { Icon, type IconName } from './icons.tsx';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly icon?: IconName;
  readonly trailingIcon?: IconName;
  readonly ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'secondary',
  icon,
  trailingIcon,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={classNames('btn', `btn-${variant}`, className)} {...rest}>
      {icon !== undefined && <Icon name={icon} />}
      {children}
      {trailingIcon !== undefined && <Icon name={trailingIcon} />}
    </button>
  );
}
