import { useEffect } from 'react';
import { toast } from 'sonner';

interface ErrorBannerProps {
  message: string | null;
}

export function ErrorBanner({ message }: ErrorBannerProps) {
  useEffect(() => {
    if (message) {
      toast.error('无法完成操作', {
        id: 'renderer-operation-error',
        description: message,
      });
    }
  }, [message]);

  return null;
}
