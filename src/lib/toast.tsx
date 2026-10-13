/**
 * The app's toasts: every message is the same card (see components/ui/sonner.tsx)
 * with an icon in a tinted circle, so a plain confirmation ("Link copied")
 * looks like a saved name and an error. Callers import `toast` from here,
 * never from the library directly.
 */
import type { ReactNode } from "react";
import { Check, CircleAlert } from "lucide-react";
import { toast as sonner, type ExternalToast } from "sonner";

type Message = string | ReactNode;

function withIcon(icon: ReactNode, options?: ExternalToast): ExternalToast {
  return { icon, ...options };
}

function plain(message: Message, options?: ExternalToast) {
  return sonner(message, withIcon(<Check aria-hidden="true" />, options));
}

export const toast = Object.assign(plain, {
  success: (message: Message, options?: ExternalToast) =>
    sonner.success(message, withIcon(<Check aria-hidden="true" />, options)),
  error: (message: Message, options?: ExternalToast) =>
    sonner.error(message, withIcon(<CircleAlert aria-hidden="true" />, options)),
  custom: sonner.custom,
  dismiss: sonner.dismiss,
  promise: sonner.promise,
});
