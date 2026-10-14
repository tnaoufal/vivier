/**
 * Two ways to switch between views of the same thing.
 *
 * `Tabs` (Radix): a 40px muted track with pill triggers, the active one
 * lifted on the card colour, with panels (`TabsContent`). For the filters
 * of a list (active / archived, a brief's status).
 *
 * `Segmented`: the same track as a plain controlled control without
 * panels, for a value a page reads (a sort, a view, a period). Its thumb
 * slides to the chosen option (a measured transform, so the motion goes
 * through the tokens and stops under reduced motion); each option may
 * carry one 16px icon and a count.
 */
import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-10 max-w-full items-center gap-1 overflow-x-auto rounded-full bg-muted p-1 text-muted-foreground",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "press inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm font-medium hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed data-[state=active]:bg-card data-[state=active]:text-ink data-[state=active]:shadow-hairline [&_svg]:size-4 [&_svg]:shrink-0",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export interface SegmentedOption<V extends string> {
  value: V;
  label: React.ReactNode;
  /** One 16px icon before the label. */
  icon?: React.ReactNode;
  /** A count after the label, in tabular digits. */
  count?: number | undefined;
  disabled?: boolean;
}

export interface SegmentedProps<V extends string> {
  value: V;
  onChange: (value: V) => void;
  options: readonly SegmentedOption<V>[];
  /** What the group chooses, for assistive technologies. */
  "aria-label": string;
  size?: "sm" | "md";
  className?: string;
}

/** The button of an option, found by its data attribute (no selector escaping needed). */
function optionElement(list: HTMLElement | null, value: string): HTMLElement | null {
  if (!list) return null;
  for (const element of list.querySelectorAll<HTMLElement>("[data-value]")) {
    if (element.dataset["value"] === value) return element;
  }
  return null;
}

function Segmented<V extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
  ...aria
}: SegmentedProps<V>) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = React.useState<{ left: number; width: number } | null>(null);

  // The thumb follows the chosen option: measured after layout, and again when the track resizes.
  const measure = React.useCallback(() => {
    const active = optionElement(listRef.current, value);
    if (!active) {
      setThumb(null);
      return;
    }
    setThumb({ left: active.offsetLeft, width: active.offsetWidth });
  }, [value]);

  React.useLayoutEffect(() => {
    measure();
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [measure]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const enabled = options.filter((option) => !option.disabled);
    const index = enabled.findIndex((option) => option.value === value);
    if (index < 0 || enabled.length < 2) return;
    let next: SegmentedOption<V> | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = enabled[(index + 1) % enabled.length];
    if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = enabled[(index - 1 + enabled.length) % enabled.length];
    if (event.key === "Home") next = enabled[0];
    if (event.key === "End") next = enabled[enabled.length - 1];
    if (!next) return;
    event.preventDefault();
    onChange(next.value);
    optionElement(listRef.current, next.value)?.focus();
  };

  return (
    <div
      ref={listRef}
      role="radiogroup"
      aria-label={aria["aria-label"]}
      onKeyDown={onKeyDown}
      className={cn(
        "relative inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full bg-muted p-1 text-muted-foreground",
        size === "sm" ? "h-9" : "h-10",
        className,
      )}
    >
      {thumb ? (
        <span
          aria-hidden="true"
          className="absolute top-1 bottom-1 left-0 rounded-full bg-card shadow-hairline transition-[transform,width] duration-base ease-out-soft"
          style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }}
        />
      ) : null}
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            data-value={option.value}
            data-state={checked ? "active" : "inactive"}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "press relative z-10 inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium transition-colors duration-fast hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
              size === "sm" ? "h-7 px-3 text-meta" : "h-8 px-4 text-sm",
              checked ? "text-ink" : "text-muted-foreground",
              // Without a measured thumb (first paint, a test), the chosen option still reads as chosen.
              checked && !thumb && "bg-card shadow-hairline",
            )}
          >
            {option.icon ? (
              <span aria-hidden="true" className="inline-flex shrink-0">
                {option.icon}
              </span>
            ) : null}
            <span>{option.label}</span>
            {typeof option.count === "number" ? (
              <span className="font-normal text-muted-foreground tabular-nums">{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, Segmented };
