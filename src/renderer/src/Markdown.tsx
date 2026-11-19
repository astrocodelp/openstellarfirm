import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Block,
  hostOf,
  type Inline,
  parseMarkdown,
} from "../../shared/markdown";
import { CopyButton } from "./ChatTools";
import { InlineConfirm } from "./ui";

/**
 * An answer's Markdown, drawn as the page's own elements. The text comes from
 * a model, so nothing here is HTML: every word is a text node, and a link opens
 * only through the app, after the person says yes to its host.
 */

interface MarkdownProps {
  text: string;
  /** True while the answer is still being written. */
  streaming?: boolean;
  /** Opens a link in the browser; without it, links are shown as words. */
  onOpenLink?(href: string): Promise<void>;
  /** Copies the code block at this index; without it, no Copy button. */
  onCopyCode?(index: number): Promise<void>;
  onError?(message: string): void;
}

interface Ctx {
  links: boolean;
  ask(href: string, from: HTMLElement): void;
  copy?: ((index: number) => Promise<void>) | undefined;
  onError(message: string): void;
  /** Counts code blocks as they are drawn, so each knows its index. */
  code: { next: number };
  /** Gives each link's address line its own id. */
  id: string;
  link: { next: number };
}

function inlines(nodes: Inline[], ctx: Ctx): ReactNode[] {
  return nodes.map((node, index) => {
    const key = index;
    switch (node.type) {
      case "text":
        return node.text;
      case "break":
        return <br key={key} />;
      case "code":
        return (
          <code key={key} className="md-code-inline">
            {node.text}
          </code>
        );
      case "strong":
        return <strong key={key}>{inlines(node.children, ctx)}</strong>;
      case "em":
        return <em key={key}>{inlines(node.children, ctx)}</em>;
      case "link": {
        if (!ctx.links)
          return <span key={key}>{inlines(node.children, ctx)}</span>;
        const addr = `${ctx.id}-link-${ctx.link.next++}`;
        return (
          <span key={key} className="md-link-wrap">
            <a
              className="md-link"
              href={node.href}
              aria-describedby={addr}
              onClick={(event) => {
                event.preventDefault();
                ctx.ask(node.href, event.currentTarget);
              }}
              onAuxClick={(event) => event.preventDefault()}
            >
              {inlines(node.children, ctx)}
            </a>
            <span className="md-link-addr" id={addr} role="tooltip">
              {node.href}
            </span>
          </span>
        );
      }
    }
    return null;
  });
}

function blocks(list: Block[], ctx: Ctx): ReactNode[] {
  return list.map((block, index) => {
    const key = index;
    switch (block.type) {
      case "paragraph":
        return <p key={key}>{inlines(block.children, ctx)}</p>;
      case "heading":
        // A heading in an answer is a bold line: the chat's own headings
        // stay the only ones in the page's outline.
        return (
          <p key={key} className="md-heading">
            <strong>{inlines(block.children, ctx)}</strong>
          </p>
        );
      case "rule":
        return <hr key={key} className="md-rule" />;
      case "quote":
        return (
          <blockquote key={key} className="md-quote">
            {blocks(block.children, ctx)}
          </blockquote>
        );
      case "list": {
        const items = block.items.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: an answer's list never reorders
          <li key={i}>
            {item.length === 1 && item[0]?.type === "paragraph"
              ? inlines(item[0].children, ctx)
              : blocks(item, ctx)}
          </li>
        ));
        return block.ordered ? (
          <ol
            key={key}
            className="md-list"
            start={block.start === 1 ? undefined : block.start}
          >
            {items}
          </ol>
        ) : (
          <ul key={key} className="md-list">
            {items}
          </ul>
        );
      }
      case "code": {
        const at = ctx.code.next++;
        return (
          <CodeBlock
            key={key}
            lang={block.lang}
            text={block.text}
            onCopy={
              ctx.copy ? () => ctx.copy?.(at) ?? Promise.resolve() : undefined
            }
            onError={ctx.onError}
          />
        );
      }
    }
    return null;
  });
}

function CodeBlock({
  lang,
  text,
  onCopy,
  onError,
}: {
  lang: string;
  text: string;
  onCopy: (() => Promise<void>) | undefined;
  onError(message: string): void;
}) {
  return (
    <div className="md-code">
      {lang || onCopy ? (
        <div className="md-code-head">
          <span className="md-code-lang">{lang}</span>
          {onCopy ? (
            <CopyButton
              onCopy={onCopy}
              onError={onError}
              label="Copy this code"
            />
          ) : null}
        </div>
      ) : null}
      {/* It scrolls sideways on its own, so the keyboard can reach it. */}
      {/* biome-ignore lint/a11y/useSemanticElements: a named group for a code block, not a fieldset of a form */}
      <div
        className="md-code-scroll"
        role="group"
        aria-label={lang ? `Code, ${lang}` : "Code"}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a region that scrolls must take the focus
        tabIndex={0}
      >
        <pre>
          <code>{text}</code>
        </pre>
      </div>
    </div>
  );
}

export function Markdown({
  text,
  streaming = false,
  onOpenLink,
  onCopyCode,
  onError = () => {},
}: MarkdownProps) {
  const id = useId();
  const parsed = useMemo(
    () => parseMarkdown(text, { streaming }),
    [text, streaming],
  );
  const [asking, setAsking] = useState<{
    href: string;
    from: HTMLElement;
  } | null>(null);
  const [opening, setOpening] = useState(false);
  const back = useRef<HTMLElement | null>(null);

  // Cancel, Escape or Open: the focus goes back to the link that asked.
  useEffect(() => {
    if (asking || !back.current) return;
    const link = back.current;
    back.current = null;
    if (link.isConnected) link.focus({ preventScroll: true });
  }, [asking]);

  function close() {
    back.current = asking?.from ?? null;
    setAsking(null);
  }

  const ctx: Ctx = {
    links: onOpenLink !== undefined,
    ask: (href, from) => setAsking({ href, from }),
    copy: onCopyCode,
    onError,
    code: { next: 0 },
    id,
    link: { next: 0 },
  };

  return (
    <>
      {blocks(parsed, ctx)}
      {asking && onOpenLink ? (
        <InlineConfirm
          className="md-confirm"
          label={`Open a link to ${hostOf(asking.href)}`}
          onClose={close}
        >
          <p>
            Open <strong>{hostOf(asking.href)}</strong> in your browser? The
            model wrote this address, so check it is one you expect.
          </p>
          <p className="md-confirm-href">{asking.href}</p>
          <div className="wrap">
            <button
              data-autofocus
              type="button"
              className="btn btn-small"
              onClick={close}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-small"
              disabled={opening}
              onClick={() => {
                setOpening(true);
                onOpenLink(asking.href)
                  .then(close)
                  .catch((e: unknown) =>
                    onError(
                      e instanceof Error
                        ? e.message
                        : "The link could not be opened.",
                    ),
                  )
                  .finally(() => setOpening(false));
              }}
            >
              Open in browser
            </button>
          </div>
        </InlineConfirm>
      ) : null}
    </>
  );
}
