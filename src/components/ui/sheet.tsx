/**
 * The side panel (drawer): full width on a phone, then `size` wide from
 * `sm` (md 32rem for a profile, lg 44rem for a dossier, full for the CV
 * viewer: the viewport minus a 2rem gutter so the page still shows at
 * the edge). A caller's `sm:w-[...]` in `className` still wins. 32px of
 * padding; the panel scrolls as a whole unless the caller lays it out as
 * a column with `SheetBody` (then the header and footer stay in place).
 * Rounded on the edge that faces the page; the close button is a 40px
 * target.
 */
"use client";

import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";

import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const Sheet = SheetPrimitive.Root;

const SheetTrigger = SheetPrimitive.Trigger;

const SheetClose = SheetPrimitive.Close;

const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-overlay bg-scrim backdrop-blur-[2px] duration-slow data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

export type SheetSize = "md" | "lg" | "full";

const sheetVariants = cva(
  "fixed z-modal overflow-y-auto border-border bg-popover p-6 text-popover-foreground shadow-dialog ease-out-soft duration-slow data-[state=closed]:duration-base data-[state=open]:animate-in data-[state=closed]:animate-out sm:p-8",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 max-h-[85dvh] rounded-b-2xl border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-full border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-[calc(100vw-2rem)] sm:rounded-r-2xl",
        right:
          "inset-y-0 right-0 h-full w-full border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-[calc(100vw-2rem)] sm:rounded-l-2xl",
      },
      size: {
        md: "sm:w-[32rem]",
        lg: "sm:w-[44rem]",
        full: "sm:w-[calc(100vw-2rem)]",
      },
    },
    defaultVariants: {
      side: "right",
      size: "md",
    },
  },
);

interface SheetContentProps
  extends
    React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = "right", size = "md", className, children, ...props }, ref) => {
  const t = useT();
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={ref}
        className={cn(sheetVariants({ side, size }), className)}
        {...props}
      >
        <SheetPrimitive.Close className="press absolute right-3 top-3 z-10 inline-flex size-10 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none sm:right-4 sm:top-4">
          <X className="size-4" aria-hidden="true" />
          <span className="sr-only">{t("common.close")}</span>
        </SheetPrimitive.Close>
        {children}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
});
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex min-w-0 flex-col gap-2 pr-10 text-left", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

/**
 * The scrolling part of a drawer laid out as a column: give `SheetContent`
 * `flex flex-col gap-6 overflow-hidden` and the body takes the remaining
 * height while the header and the footer stay in place (the CV viewer,
 * a long dossier with actions at the bottom).
 */
const SheetBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("-mx-6 min-h-0 flex-1 overflow-y-auto px-6 sm:-mx-8 sm:px-8", className)}
    {...props}
  />
);
SheetBody.displayName = "SheetBody";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end", className)}
    {...props}
  />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("font-display text-xl leading-7 text-ink break-words", className)}
    {...props}
  />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-body text-muted-foreground", className)}
    {...props}
  />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
