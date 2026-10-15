/**
 * Every toast is drawn by us, not by the toaster's defaults: the inverse
 * surface (the ink with paper text, so it reads at once over any page;
 * paper on ink in dark), the icon alone at 16px (a check for a
 * confirmation, an alert for an error: the icon and the words tell them
 * apart, never a colour), the title in paper, the detail in the inverse
 * muted grey, and an outline pill for its action (Undo). `unstyled`
 * drops the library's own rules, which would otherwise outrank these
 * classes. Toasts sit above every other layer and enter from the bottom
 * right.
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
            "flex w-[min(22rem,calc(100vw-2rem))] items-center gap-3 rounded-lg border border-inverse-muted-foreground/40 bg-inverse p-4 font-sans text-inverse-foreground shadow-float",
          content: "min-w-0 flex-1",
          title: "text-sm font-medium text-inverse-foreground",
          description: "mt-0.5 text-meta text-inverse-muted-foreground",
          icon: "flex size-5 shrink-0 items-center justify-center text-inverse-foreground [&_svg]:size-4",
          actionButton:
            "press inline-flex h-8 shrink-0 items-center rounded-full border border-inverse-muted-foreground bg-transparent px-3 text-xs font-medium text-inverse-foreground hover:bg-inverse-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inverse-foreground",
          cancelButton:
            "press inline-flex h-8 shrink-0 items-center rounded-full px-3 text-xs text-inverse-muted-foreground hover:bg-inverse-foreground/10 hover:text-inverse-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
