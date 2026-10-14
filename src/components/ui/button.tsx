/**
 * The button of the product: a pill, 40px high by default (`sm` 32 for a
 * dense desktop row, `lg` 44 for a hero), one filled primary per view and
 * the rest secondary, outline or ghost. `asChild` lets a Link take the
 * look. The `icon` prop is the one leading icon slot: it renders exactly
 * one 16px icon; a literal `<svg>` child is dropped and any svg a child
 * component renders (a lucide icon) is hidden by the label slot's rule,
 * so a control can never show two. Children that are not icons (a
 * `<Trans/>`, a count badge) stay: nothing is guessed from a component.
 */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "press inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_[data-slot=label]_svg]:hidden",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-raised hover:bg-primary/92",
        primary: "bg-primary text-primary-foreground shadow-raised hover:bg-primary/92",
        destructive:
          "bg-destructive text-destructive-foreground shadow-raised hover:bg-destructive/92",
        outline:
          "border border-input bg-card text-ink shadow-hairline hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
        ghost: "text-ink hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5",
        md: "h-10 px-5",
        sm: "h-8 px-3.5 text-meta",
        lg: "h-11 px-6 text-body",
        icon: "size-10",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** The one leading icon, 16px. A literal svg child is dropped, a child component's svg hidden. */
  icon?: React.ReactNode;
}

/**
 * The only child dropped outright is a literal `<svg>`: a component
 * element is kept, whatever it is, and the svg it may render is hidden
 * by `[&_[data-slot=label]_svg]:hidden`, so a childless component that is
 * not an icon never vanishes.
 */
function isIconElement(node: React.ReactNode): boolean {
  return React.isValidElement(node) && node.type === "svg";
}

function withoutIcons(children: React.ReactNode): React.ReactNode[] {
  return React.Children.toArray(children).filter((child) => !isIconElement(child));
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, icon, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const classes = cn(buttonVariants({ variant, size, className }));
    if (icon === undefined || icon === null) {
      return (
        <Comp className={classes} ref={ref} {...props}>
          {children}
        </Comp>
      );
    }
    const slot = (
      <span
        key="icon"
        data-slot="icon"
        aria-hidden="true"
        className="inline-flex shrink-0 items-center justify-center"
      >
        {icon}
      </span>
    );
    // With `asChild` the Slot needs one child element: the icon goes inside it.
    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<{ children?: React.ReactNode }>;
      const label = withoutIcons(child.props.children);
      return (
        <Slot className={classes} ref={ref} {...props}>
          {React.cloneElement(
            child,
            undefined,
            slot,
            <span key="label" data-slot="label" className="contents">
              {label}
            </span>,
          )}
        </Slot>
      );
    }
    return (
      <Comp className={classes} ref={ref} {...props}>
        {slot}
        <span data-slot="label" className="contents">
          {withoutIcons(children)}
        </span>
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
