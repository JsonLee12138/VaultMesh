import { useNavigate } from '@tanstack/react-router';
import { BracesIcon, ContactIcon, CreditCardIcon, KeyRoundIcon, PlusIcon, TerminalIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ADD_ITEM_TYPES } from '@/lib/add-item-types';

interface AddItemMenuProps {
  variant?: 'default' | 'outline';
  size?: 'default' | 'sm';
}

export function AddItemMenu({ variant = 'default', size = 'default' }: AddItemMenuProps) {
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} type="button">
          <PlusIcon data-icon="inline-start" />
          添加
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel>选择保存类型</DropdownMenuLabel>
        <DropdownMenuGroup>
          {ADD_ITEM_TYPES.map((item) => (
            <DropdownMenuItem key={item.id} onSelect={() => void (item.id === 'login'
              ? navigate({ to: '/vault/items/new' })
              : item.id === 'paymentCard'
                ? navigate({ to: '/vault/cards/new' })
                : item.id === 'sshCredential'
                  ? navigate({ to: '/vault/ssh/new' })
                  : item.id === 'secret'
                    ? navigate({ to: '/vault/secrets/new' })
                    : navigate({ to: '/vault/identities/new' }))}>
              {item.id === 'login' ? <KeyRoundIcon /> : item.id === 'paymentCard' ? <CreditCardIcon /> : item.id === 'sshCredential' ? <TerminalIcon /> : item.id === 'secret' ? <BracesIcon /> : <ContactIcon />}
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
