import { Menu } from '../ui/Menu.tsx';
import { useExports } from './use-exports.ts';

export interface ExportMenuProps {
  readonly arbeitId?: string;
  readonly variant?: 'primary' | 'secondary';
}

export function ExportMenu({ arbeitId, variant = 'primary' }: ExportMenuProps) {
  const items = useExports(arbeitId);
  return (
    <Menu label="Exportieren" items={items} variant={variant} className="export-menu">
      Exportieren
    </Menu>
  );
}
