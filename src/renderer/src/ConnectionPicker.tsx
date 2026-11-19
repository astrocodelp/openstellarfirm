import { useId, useState } from "react";
import { serviceLabel } from "../../shared/connection-catalog";
import { filterConnections } from "../../shared/connection-gallery";
import type { Connection } from "../../shared/types";

/** With more than this many connections, the picker gets a search box. */
export const PICKER_SEARCH_FROM = 6;

interface PickerProps {
  connections: readonly Connection[];
  chosen: readonly string[];
  onChange(ids: string[]): void;
}

/**
 * Which connections one assistant may use: a box to tick for each, and a
 * search when there are many. Ticked ones stay ticked while hidden by a search.
 */
export function ConnectionPicker({
  connections,
  chosen,
  onChange,
}: PickerProps) {
  const ids = useId();
  const [query, setQuery] = useState("");
  const many = connections.length > PICKER_SEARCH_FROM;
  const shown = many
    ? filterConnections(connections, query, (c) => serviceLabel(c))
    : connections;
  const picked = connections.filter((c) => chosen.includes(c.id)).length;

  function toggle(id: string, on: boolean) {
    onChange(on ? [...chosen, id] : chosen.filter((x) => x !== id));
  }

  return (
    <div className="stack-tight">
      {many ? (
        <label className="field">
          <span className="field-label" id={`${ids}-label`}>
            Find a connection
          </span>
          <input
            aria-labelledby={`${ids}-label`}
            aria-controls={`${ids}-list`}
            className="input"
            type="search"
            value={query}
            placeholder="Name or service"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Enter here must not save the whole form.
              if (event.key === "Enter") event.preventDefault();
              if (event.key === "Escape" && query) {
                event.preventDefault();
                setQuery("");
              }
            }}
          />
        </label>
      ) : null}
      {many ? (
        <p className="faint" style={{ fontVariantNumeric: "tabular-nums" }}>
          {`${picked} of ${connections.length} chosen`}
          {query.trim() ? ` · ${shown.length} shown` : ""}
        </p>
      ) : null}
      {shown.length === 0 ? (
        <p className="faint">No connection matches that.</p>
      ) : (
        <div className="stack-tight" id={`${ids}-list`}>
          {shown.map((connection) => (
            <label className="choice" key={connection.id}>
              <input
                type="checkbox"
                checked={chosen.includes(connection.id)}
                onChange={(event) =>
                  toggle(connection.id, event.target.checked)
                }
              />
              <span>
                {connection.name}
                <span className="faint">
                  {" · "}
                  {serviceLabel(connection)}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
