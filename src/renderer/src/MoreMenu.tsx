import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

/**
 * A button that opens a short menu of actions: the menu button pattern. It
 * says it has a menu, opens with Enter, Space or an arrow key, moves with the
 * arrows, Home and End, and closes with Escape or Tab, giving the focus back to
 * the button. A disabled item stays in reach and says why it cannot run.
 */

export interface MenuItem {
  id: string;
  label: string;
  onSelect(): void;
  /** Why it cannot run now; set, the item is shown but does nothing. */
  disabledWhy?: string | undefined;
  icon?: ReactNode;
}

export function MoreMenu({
  label,
  items,
  buttonRef,
}: {
  /** The button's words; the menu takes its name from them. */
  label: string;
  items: MenuItem[];
  /** The button, for a caller that gives the focus back to it later. */
  buttonRef?: { current: HTMLButtonElement | null };
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const own = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const setButton = (node: HTMLButtonElement | null) => {
    own.current = node;
    if (buttonRef) buttonRef.current = node;
  };

  // The item with the focus follows the arrows.
  useEffect(() => {
    if (!open) return;
    menu.current
      ?.querySelectorAll<HTMLElement>('[role="menuitem"]')
      [active]?.focus({ preventScroll: true });
  }, [open, active]);

  // A click anywhere else closes it, and leaves the focus where it went.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  function show(at: number) {
    setActive(at);
    setOpen(true);
  }

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) own.current?.focus({ preventScroll: true });
  }

  function onButtonKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      show(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      show(items.length - 1);
    }
  }

  function onMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    const last = items.length - 1;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((n) => (n >= last ? 0 : n + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((n) => (n <= 0 ? last : n - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(last);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      // Tab leaves the menu the way it would leave the button.
      close(false);
    } else if (event.key.length === 1 && /\S/.test(event.key)) {
      // A letter goes to the next item that starts with it.
      const key = event.key.toLowerCase();
      const from = active;
      for (let step = 1; step <= items.length; step += 1) {
        const at = (from + step) % items.length;
        if (items[at]?.label.toLowerCase().startsWith(key)) {
          setActive(at);
          break;
        }
      }
    }
  }

  return (
    <div className="more" ref={wrap}>
      <button
        ref={setButton}
        type="button"
        className="btn more-btn"
        id={`${id}-button`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => (open ? close(true) : show(0))}
        onKeyDown={onButtonKey}
      >
        {label}
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="more-caret"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div
          ref={menu}
          className="more-menu"
          role="menu"
          id={`${id}-menu`}
          aria-labelledby={`${id}-button`}
          tabIndex={-1}
          onKeyDown={onMenuKey}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="more-item"
              tabIndex={index === active ? 0 : -1}
              aria-disabled={item.disabledWhy ? true : undefined}
              aria-describedby={
                item.disabledWhy ? `${id}-${item.id}-why` : undefined
              }
              onMouseEnter={() => setActive(index)}
              onClick={() => {
                if (item.disabledWhy) return;
                close(true);
                item.onSelect();
              }}
            >
              {item.icon}
              <span className="more-item-text">
                <span>{item.label}</span>
                {item.disabledWhy ? (
                  <span className="more-item-why" id={`${id}-${item.id}-why`}>
                    {item.disabledWhy}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
