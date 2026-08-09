import { useEffect } from "react";
import { toast } from "sonner";

export type ToastVariant = "default" | "success" | "info" | "warning" | "error";

interface ToastMessageProps {
  id: string;
  message: string | null;
  title?: string;
  variant?: ToastVariant;
}

export function ToastMessage({ id, message, title, variant = "default" }: ToastMessageProps) {
  useEffect(() => {
    if (!message) return;
    const content = title ?? message;
    const options = { id, ...(title ? { description: message } : {}) };
    if (variant === "success") toast.success(content, options);
    else if (variant === "info") toast.info(content, options);
    else if (variant === "warning") toast.warning(content, options);
    else if (variant === "error") toast.error(content, options);
    else toast(content, options);
  }, [id, message, title, variant]);

  return null;
}
