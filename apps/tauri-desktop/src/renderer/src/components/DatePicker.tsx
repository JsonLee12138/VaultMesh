import { useState } from 'react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface DatePickerProps {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  startMonth?: Date;
  endMonth?: Date;
  maxDate?: Date;
}

export function DatePicker({
  id,
  value,
  onValueChange,
  placeholder = '选择日期',
  ariaLabel,
  disabled = false,
  className,
  startMonth = new Date(1900, 0, 1),
  endMonth = new Date(new Date().getFullYear() + 100, 11, 31),
  maxDate,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = parseLocalDate(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={ariaLabel}
          data-empty={!selected}
          className={cn('w-full justify-start text-left font-normal data-[empty=true]:text-muted-foreground', className)}
        >
          <CalendarIcon data-icon="inline-start" />
          {selected ? format(selected, 'PPP', { locale: zhCN }) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          {...(selected ? { defaultMonth: selected } : {})}
          startMonth={startMonth}
          endMonth={endMonth}
          {...(maxDate ? { disabled: { after: maxDate } } : {})}
          captionLayout="dropdown"
          locale={zhCN}
          onSelect={(date) => {
            if (!date) return;
            onValueChange(format(date, 'yyyy-MM-dd'));
            setOpen(false);
          }}
        />
        <div className="flex justify-end px-2 pb-2">
          <Button variant="ghost" size="sm" type="button" disabled={!selected} onClick={() => { onValueChange(''); setOpen(false); }}>清除</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function parseLocalDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : undefined;
}
