/**
 * The modal dialog: centred, never wider than the viewport minus a
 * gutter, 32px of padding from `sm`, `overflow-hidden` so nothing spills
 * past its corners. `size` picks the width (sm 28rem, md 32rem, lg 42rem,
 * xl 56rem); a caller's `max-w-*` in `className` still wins. The slots
 * are `DialogHeader`, `DialogBody` (the part that scrolls) and
 * `DialogFooter`; the content springs in over 240ms. The close button is
 * a 40px target and stays the content's last child (callers rely on it).
 */
"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-overlay bg-black/40 backdrop-blur-[2px] duration-slow dark:bg-black/70 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

export type DialogSize = "sm" | "md" | "lg" | "xl";

const DIALOG_SIZES: Record<DialogSize, string> = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

function widthOf(size: DialogSize | undefined): string {
  return DIALOG_SIZES[size ?? "md"];
}

interface DialogContentProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  /** The width: sm 28rem, md 32rem (default), lg 42rem, xl 56rem. */
  size?: DialogSize | undefined;
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, size, ...props }, ref) => {
  const t = useT();
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "surface-dialog fixed left-1/2 top-1/2 z-modal grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-6 overflow-hidden p-6 sm:p-8 [&>*]:min-w-0",
          "duration-slow ease-spring data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:duration-base data-[state=closed]:ease-out-soft data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          widthOf(size),
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="press absolute right-3 top-3 inline-flex size-10 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none sm:right-4 sm:top-4">
          <X className="size-4" aria-hidden="true" />
          <span className="sr-only">{t("common.close")}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex min-w-0 flex-col gap-2 pr-10 text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

/**
 * The part of a dialog that may be taller than the screen: it scrolls
 * inside the dialog, between a header and a footer that stay in place.
 * The dialog itself is a grid, so the body takes the remaining height.
 */
const DialogBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("-mx-6 min-h-0 overflow-y-auto px-6 sm:-mx-8 sm:px-8", className)}
    {...props}
  />
);
DialogBody.displayName = "DialogBody";

/** Buttons at the end: stacked on a phone, in a wrapping row from `sm`. */
const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end", className)}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("font-display text-xl leading-7 text-ink break-words", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-body text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
