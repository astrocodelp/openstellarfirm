import type { InputHTMLAttributes, Ref } from "react";

/**
 * Every search box in the app. Enter never submits a form around it: a search
 * filters, it does not save. Esc clears the words first; with nothing typed it
 * is left to whatever holds the box, such as a dialog that closes.
 */

type SearchKeys = {
  /** What Enter does here, if anything, such as opening the first result. */
  onEnter?: () => void;
};

/** The parts of a key event the rule reads, so it can be tested without a page. */
export interface SearchKeyEvent {
  key: string;
  nativeEvent: { isComposing: boolean };
  preventDefault(): void;
  stopPropagation(): void;
}

/** What a key does in a search box. */
export function searchKey(
  event: SearchKeyEvent,
  value: string,
  clear: () => void,
  keys: SearchKeys = {},
): void {
  if (event.nativeEvent.isComposing) return;
  if (event.key === "Enter") {
    event.preventDefault();
    keys.onEnter?.();
  } else if (event.key === "Escape" && value) {
    // Stops here, so a dialog around the box stays open while words are cleared.
    event.preventDefault();
    event.stopPropagation();
    clear();
  }
}

type SearchInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange"
> &
  SearchKeys & {
    value: string;
    onValueChange(value: string): void;
    ref?: Ref<HTMLInputElement>;
  };

export function SearchInput({
  value,
  onValueChange,
  onEnter,
  onKeyDown,
  ref,
  ...rest
}: SearchInputProps) {
  return (
    <input
      ref={ref}
      type="search"
      autoComplete="off"
      spellCheck={false}
      {...rest}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        searchKey(event, value, () => onValueChange(""), { onEnter });
      }}
    />
  );
}
