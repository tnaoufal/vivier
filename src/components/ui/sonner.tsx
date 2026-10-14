/**
 * Every toast is drawn by us, not by the toaster's defaults: the float
 * surface, an icon in a tinted disc (accent for a confirmation, negative
 * for an error), the title in ink, the detail in muted, and the same
 * outline pill for its action (Undo). `unstyled` drops the library's own
 * rules, which would otherwise outrank these classes. Toasts sit above
 * every other layer and enter from the bottom right.
 */
import { Toaster as Sonner } from "sonner";

import { useTheme } from "@/components/theme-context";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      position="bottom-right"
      offset={24}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "surface-float flex w-[min(22rem,calc(100vw-2rem))] items-center gap-3 rounded-lg p-4 font-sans",
          content: "min-w-0 flex-1",
          title: "text-sm font-medium text-ink",
          description: "mt-0.5 text-meta text-muted-foreground",
          icon: "flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary [&_svg]:size-3.5",
          error: "[&_[data-icon]]:bg-negative/12 [&_[data-icon]]:text-negative",
          actionButton:
            "press inline-flex h-8 shrink-0 items-center rounded-full border border-input bg-card px-3 text-xs font-medium text-ink hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          cancelButton:
            "press inline-flex h-8 shrink-0 items-center rounded-full px-3 text-xs text-muted-foreground hover:bg-accent hover:text-ink",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
