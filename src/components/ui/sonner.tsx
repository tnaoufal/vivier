import { Toaster as Sonner } from "sonner";

import { useTheme } from "@/components/theme-context";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Every toast is drawn by us, not by the toaster's defaults: the same
 * rounded, bordered card as the saved-name card, and the same outline pill
 * for its action (Undo). `unstyled` drops the library's own rules, which
 * would otherwise outrank these classes.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "surface-dialog flex w-[min(22rem,calc(100vw-2rem))] items-center gap-3 p-4 font-sans",
          content: "min-w-0 flex-1",
          title: "text-sm font-medium text-ink",
          description: "mt-0.5 text-xs text-muted-foreground",
          icon: "flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary [&_svg]:size-3.5",
          error: "[&_[data-icon]]:bg-destructive/15 [&_[data-icon]]:text-destructive",
          actionButton:
            "inline-flex h-8 shrink-0 items-center rounded-full border border-border bg-background px-3 text-xs font-medium text-ink transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          cancelButton:
            "inline-flex h-8 shrink-0 items-center rounded-full px-3 text-xs text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-ink",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
