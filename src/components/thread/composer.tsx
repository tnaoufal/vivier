/**
 * The thread's composer: one line that grows with the text (six at
 * most, then it scrolls) and completes "@" with the team: typing "@An"
 * lists the members whose name starts that way, Enter or Tab inserts
 * "@Ana Lopez ", Escape closes the list. Enter sends, Shift+Enter
 * breaks a line, and a quiet icon button sends too. Built on the
 * shortlist's mentions helper; the mentions themselves are read from
 * the final text when the message is sent.
 */
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { Send } from "lucide-react";

import { Avatar } from "@/components/app-shell/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n";
import {
  filterMembers,
  insertMention,
  mentionQuery,
  type MentionMember,
  type MentionQuery,
} from "@/lib/shortlists/mentions";
import { MESSAGE_MAX } from "@/lib/threads/thread";
import { cn } from "@/lib/utils";

/** Six lines of 24px before the field scrolls. */
const MAX_HEIGHT_PX = 160;

export function ThreadComposer({
  value,
  onChange,
  onSend,
  members,
  placeholder,
  ariaLabel,
  disabled = false,
  autoFocus = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Enter, or the button; only called with something to send. */
  onSend: () => void;
  members: readonly MentionMember[];
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean | undefined;
  autoFocus?: boolean | undefined;
  className?: string | undefined;
}) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<MentionQuery | null>(null);
  const [active, setActive] = useState(0);
  const suggestions = useMemo(
    () => (query ? filterMembers(members, query.query) : []),
    [members, query],
  );
  const open = query !== null && suggestions.length > 0;
  const listId = `${useId()}-mentions`;
  const canSend = !disabled && value.trim().length > 0;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  function sync(element: HTMLTextAreaElement) {
    const caret = element.selectionStart ?? element.value.length;
    setQuery(mentionQuery(element.value, caret));
    setActive(0);
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    onChange(event.target.value);
    sync(event.target);
  }

  function pick(member: MentionMember) {
    if (!query) return;
    const caret = query.start + 1 + query.query.length;
    const next = insertMention(value, query.start, caret, member.name);
    onChange(next.text);
    setQuery(null);
    const element = ref.current;
    if (element) {
      window.requestAnimationFrame(() => {
        element.focus();
        element.setSelectionRange(next.caret, next.caret);
      });
    }
  }

  function send() {
    if (!canSend) return;
    setQuery(null);
    onSend();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // An input method commits its candidate with Enter: not a send.
    if (event.nativeEvent.isComposing) return;
    if (open) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((index) => (index + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((index) => (index - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const member = suggestions[active] ?? suggestions[0];
        if (member) {
          event.preventDefault();
          pick(member);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setQuery(null);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  return (
    <div className={cn("relative flex items-end gap-2", className)}>
      <Textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onKeyUp={(event) => {
          if (!open && (event.key === "ArrowLeft" || event.key === "ArrowRight"))
            sync(event.currentTarget);
        }}
        onClick={(event) => sync(event.currentTarget)}
        onBlur={() => {
          // Let a click on a suggestion land first (its mousedown keeps the focus).
          window.setTimeout(() => setQuery(null), 150);
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        rows={1}
        maxLength={MESSAGE_MAX}
        disabled={disabled}
        autoFocus={autoFocus}
        className="max-h-40 min-h-10 resize-none px-3.5 py-2 md:text-sm"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        icon={<Send />}
        onClick={send}
        disabled={!canSend}
        aria-label={t("thread.send")}
        title={t("thread.send")}
        aria-keyshortcuts="Enter"
        className="shrink-0 text-muted-foreground hover:text-ink"
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={t("thread.suggestions")}
          className="surface-float fade-in absolute bottom-full left-0 z-10 mb-1 max-h-56 w-64 max-w-full overflow-y-auto p-1"
        >
          {suggestions.map((member, index) => (
            <li
              key={member.id}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(member)}
              className={cn(
                "flex min-w-0 cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm transition-colors duration-fast ease-out-soft",
                index === active ? "bg-accent text-accent-foreground" : "text-ink",
              )}
            >
              <Avatar name={member.name} size="sm" decorative />
              <span className="truncate">{member.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
