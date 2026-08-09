import type { ReactNode } from 'react';
import { ArrowRightIcon, Trash2Icon, type LucideIcon } from 'lucide-react';

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';

type SecurityFeatureCardProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  summary: string;
  actionLabel: string;
  fitDialogToContent?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  footer?: ReactNode;
  children: ReactNode;
};

export function SecurityFeatureCard({
  icon: Icon,
  title,
  description,
  summary,
  actionLabel,
  fitDialogToContent = false,
  open,
  onOpenChange,
  footer,
  children,
}: SecurityFeatureCardProps) {
  return (
    <Dialog open={open} {...(onOpenChange ? { onOpenChange } : {})}>
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon />
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex-1">
          <p className="text-sm text-muted-foreground">{summary}</p>
        </CardContent>
        <CardFooter>
          <DialogTrigger asChild>
            <Button className="w-full" variant="outline" type="button">
              {actionLabel}
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </DialogTrigger>
        </CardFooter>
      </Card>
      <DialogContent
        className={fitDialogToContent
          ? 'grid grid-rows-[auto_auto_auto] sm:max-w-2xl'
          : 'grid h-[min(85vh,40rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-2xl'}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {fitDialogToContent ? (
          <div className="flex flex-col gap-4 p-px">{children}</div>
        ) : (
          <ScrollArea className="min-h-0">
            <div className="flex flex-col gap-4 p-px pr-3">{children}</div>
          </ScrollArea>
        )}
        {footer ? <DialogFooter>{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}

type ItemCardProps = {
  title: string;
  description: string;
  children?: ReactNode;
};

export function ItemCard({ title, description, children }: ItemCardProps) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        {children ? <CardAction>{children}</CardAction> : null}
      </CardHeader>
    </Card>
  );
}

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
};

export function EmptyState({ icon: Icon, title, description }: EmptyStateProps) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

type ConfirmActionProps = {
  triggerLabel: string;
  title: string;
  description: string;
  disabled: boolean;
  onConfirm: () => Promise<void>;
};

export function ConfirmAction({
  triggerLabel,
  title,
  description,
  disabled,
  onConfirm,
}: ConfirmActionProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" type="button" disabled={disabled}>
          <Trash2Icon data-icon="inline-start" />
          {triggerLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={disabled}
            onClick={() => void onConfirm()}
          >
            确认删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

export function formatDuration(milliseconds: number): string {
  const seconds = milliseconds / 1_000;
  return seconds >= 60 ? `${seconds / 60} 分钟` : `${seconds} 秒`;
}
