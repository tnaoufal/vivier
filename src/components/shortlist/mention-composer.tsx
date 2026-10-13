/**
 * A textarea that completes "@" with the team: typing "@An" lists the
 * members whose name starts that way, Enter or Tab inserts "@Ana Lopez ",
 * Escape closes the list, Ctrl+Enter submits. The mentions themselves
 * are read from the final text (mentions.ts) when the comment is sent.
 */
import { useId, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";

import { Avatar } from "@/components/app-shell/avatar";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import {
  filterMembers,
  insertMention,
  mentionQuery,
  type MentionMember,
  type MentionQuery,
} from "@/lib/shortlists/mentions";
import { cn } from "@/lib/utils";

export function MentionComposer({
  value,
  onChange,
  members,
  ariaLabel,
  placeholder,
  disabled = false,
  autoFocus = false,
  rows = 3,
  maxLength = 8000,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  members: readonly MentionMember[];
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  rows?: number;
  maxLength?: number;
  /** Ctrl+Enter / Cmd+Enter. */
  onSubmit?: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<MentionQuery | null>(null);
  const [active, setActive] = useState(0);
  const suggestions = useMemo(() => (query ? filterMembers(members, query.query) : []), [members, query]);
  const open = query !== null && suggestions.length > 0;
  const listId = `${useId()}-mentions`;

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

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
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
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && onSubmit) {
      event.preventDefault();
      onSubmit();
    }
  }

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onKeyUp={(event) => {
          if (!open && (event.key === "ArrowLeft" || event.key === "ArrowRight")) sync(event.currentTarget);
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
        rows={rows}
        maxLength={maxLength}
        disabled={disabled}
        autoFocus={autoFocus}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={t("shortlists.comments.suggestions")}
          className="surface-float absolute left-0 top-full z-30 mt-1 max-h-56 w-64 max-w-full overflow-y-auto p-1"
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
                "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm",
                index === active ? "bg-accent text-accent-foreground" : "text-ink",
              )}
            >
              <Avatar name={member.name} size="sm" />
              <span className="truncate">{member.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
