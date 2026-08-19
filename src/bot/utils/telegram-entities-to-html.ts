interface MessageEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
  custom_emoji_id?: string;
}

/**
 * Converts stored HTML (produced by telegramEntitiesToHtml) back to plain text + entities array.
 * Required for sending to Telegram channels where HTML parse_mode doesn't support <tg-emoji>
 * (Telegram requires the bot to own the emoji pack for HTML mode in channels, whereas
 *  the entities array approach resolves emoji via the viewer's installed packs — works universally).
 *
 * Supported tags: <b>, <i>, <u>, <s>, <code>, <pre>, <tg-spoiler>, <a href="...">,
 * <blockquote>, <blockquote expandable>, <tg-emoji emoji-id="...">.
 * HTML entities decoded: &amp; → &, &lt; → <, &gt; → >.
 * Offsets are in UTF-16 code units (surrogate pairs count as 2).
 */
export function htmlToEntities(html: string): { text: string; entities: MessageEntity[] } {
  type StackEntry = {
    type: string;
    start: number; // UTF-16 offset in output text
    url?: string;
    custom_emoji_id?: string;
  };

  let text = '';
  let i = 0;
  const stack: StackEntry[] = [];
  const entities: MessageEntity[] = [];

  // Returns the UTF-16 length of the current output text
  const utf16Len = (s: string) => {
    let len = 0;
    for (const ch of s) {
      len += ch.codePointAt(0)! > 0xffff ? 2 : 1;
    }
    return len;
  };

  let curOffset = 0; // UTF-16 offset tracking

  const appendText = (s: string) => {
    text += s;
    curOffset += utf16Len(s);
  };

  while (i < html.length) {
    if (html[i] !== '<') {
      // Accumulate plain text / HTML entities
      let chunk = '';
      while (i < html.length && html[i] !== '<') {
        if (html[i] === '&') {
          const semi = html.indexOf(';', i);
          if (semi !== -1) {
            const ref = html.slice(i + 1, semi);
            if (ref === 'amp') { chunk += '&'; i = semi + 1; continue; }
            if (ref === 'lt') { chunk += '<'; i = semi + 1; continue; }
            if (ref === 'gt') { chunk += '>'; i = semi + 1; continue; }
          }
        }
        chunk += html[i++];
      }
      appendText(chunk);
      continue;
    }

    // Find closing >
    const close = html.indexOf('>', i);
    if (close === -1) {
      appendText(html.slice(i));
      break;
    }

    const inner = html.slice(i + 1, close);
    i = close + 1;

    if (inner.startsWith('/')) {
      // Closing tag
      const tagName = inner.slice(1).trim().toLowerCase();
      // Find matching entry in stack (search from top)
      for (let j = stack.length - 1; j >= 0; j--) {
        if (matchesCloseTag(stack[j].type, tagName)) {
          const entry = stack.splice(j, 1)[0];
          const length = curOffset - entry.start;
          if (length > 0) {
            const entity: MessageEntity = { type: entry.type, offset: entry.start, length };
            if (entry.url) entity.url = entry.url;
            if (entry.custom_emoji_id) entity.custom_emoji_id = entry.custom_emoji_id;
            entities.push(entity);
          }
          break;
        }
      }
    } else {
      // Opening tag — parse type and attributes
      const parsed = parseOpenTag(inner);
      if (parsed) {
        stack.push({ ...parsed, start: curOffset });
      }
      // Unknown tags are silently ignored (their content still appears as text)
    }
  }

  return { text, entities };
}

function matchesCloseTag(entityType: string, closingTag: string): boolean {
  switch (entityType) {
    case 'bold': return closingTag === 'b';
    case 'italic': return closingTag === 'i';
    case 'underline': return closingTag === 'u';
    case 'strikethrough': return closingTag === 's';
    case 'code': return closingTag === 'code';
    case 'pre': return closingTag === 'pre';
    case 'spoiler': return closingTag === 'tg-spoiler';
    case 'text_link': return closingTag === 'a';
    case 'blockquote': return closingTag === 'blockquote';
    case 'expandable_blockquote': return closingTag === 'blockquote';
    case 'custom_emoji': return closingTag === 'tg-emoji';
    default: return false;
  }
}

function parseOpenTag(inner: string): { type: string; url?: string; custom_emoji_id?: string } | null {
  const lower = inner.toLowerCase();

  if (lower === 'b') return { type: 'bold' };
  if (lower === 'i') return { type: 'italic' };
  if (lower === 'u') return { type: 'underline' };
  if (lower === 's') return { type: 'strikethrough' };
  if (lower === 'code') return { type: 'code' };
  if (lower === 'pre') return { type: 'pre' };
  if (lower === 'tg-spoiler') return { type: 'spoiler' };
  if (lower === 'blockquote') return { type: 'blockquote' };
  if (lower === 'blockquote expandable') return { type: 'expandable_blockquote' };

  // <a href="...">
  if (lower.startsWith('a ')) {
    const href = extractAttr(inner, 'href');
    if (href) return { type: 'text_link', url: href };
  }

  // <tg-emoji emoji-id="...">
  if (lower.startsWith('tg-emoji')) {
    const emojiId = extractAttr(inner, 'emoji-id');
    if (emojiId) return { type: 'custom_emoji', custom_emoji_id: emojiId };
  }

  return null;
}

function extractAttr(tag: string, attr: string): string | null {
  // Match attr="value" or attr='value'
  const re = new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, 'i');
  const m = tag.match(re);
  return m ? m[1] : null;
}

/**
 * Converts Telegram message text + entities to HTML.
 * Handles bold, italic, underline, strikethrough, code, pre, text_link, spoiler, blockquote, expandable_blockquote.
 * Properly escapes HTML special characters in plain text segments.
 * Handles overlapping entities via stack-based re-open: when closing entity A while entity B
 * (opened later) is still open, B is temporarily closed, A is closed, then B is re-opened.
 */
export function telegramEntitiesToHtml(
  text: string,
  entities?: MessageEntity[],
): string {
  if (!entities || entities.length === 0) return escapeHtml(text);

  type TagEvent = {
    pos: number;
    openTag: string;
    closeTag: string;
    open: boolean;
    order: number;
  };
  const events: TagEvent[] = [];

  entities.forEach((entity, idx) => {
    const open = openTag(entity);
    if (!open) return;
    const close = closeTag(entity);
    events.push({
      pos: entity.offset,
      openTag: open,
      closeTag: close,
      open: true,
      order: idx,
    });
    events.push({
      pos: entity.offset + entity.length,
      openTag: open,
      closeTag: close,
      open: false,
      order: idx,
    });
  });

  // Sort: earlier positions first; at same position opens before closes; lower order first
  events.sort((a, b) => {
    if (a.pos !== b.pos) return a.pos - b.pos;
    if (a.open !== b.open) return a.open ? -1 : 1;
    return a.order - b.order;
  });

  type StackItem = { order: number; openTag: string; closeTag: string };
  const openStack: StackItem[] = [];
  let result = '';
  let cursor = 0;

  for (const ev of events) {
    if (ev.pos > cursor) {
      result += escapeHtml(text.slice(cursor, ev.pos));
      cursor = ev.pos;
    }

    if (ev.open) {
      result += ev.openTag;
      openStack.push({
        order: ev.order,
        openTag: ev.openTag,
        closeTag: ev.closeTag,
      });
    } else {
      const idx = openStack.findIndex((item) => item.order === ev.order);
      if (idx === -1) continue;

      // Items opened after this entity (must be temporarily closed to maintain valid nesting)
      const above = openStack.splice(idx + 1);

      // Close inner entities (innermost first)
      for (let i = above.length - 1; i >= 0; i--) {
        result += above[i].closeTag;
      }

      // Close this entity and remove from stack
      result += ev.closeTag;
      openStack.splice(idx, 1);

      // Re-open inner entities
      for (const item of above) {
        result += item.openTag;
      }
      openStack.push(...above);
    }
  }

  if (cursor < text.length) result += escapeHtml(text.slice(cursor));
  return result;
}

/**
 * Normalizes HTML tag nesting by fixing overlapping/unclosed tags.
 * Uses stack-based re-open approach: when a closing tag is encountered but inner tags
 * are still open, they are temporarily closed, the target is closed, then re-opened.
 * Apply to stored descriptions before sending to Telegram to preserve formatting.
 */
const TELEGRAM_ALLOWED_TAGS = new Set([
  'b', 'i', 'u', 's', 'code', 'pre', 'a', 'tg-emoji', 'blockquote',
]);

export function normalizeHtml(html: string): string {
  const stack: { tag: string; full: string }[] = [];
  let result = '';
  let i = 0;

  while (i < html.length) {
    if (html[i] !== '<') {
      result += html[i++];
      continue;
    }
    const close = html.indexOf('>', i);
    if (close === -1) {
      result += html.slice(i);
      break;
    }

    const inner = html.slice(i + 1, close);
    if (inner.startsWith('/')) {
      const closingTag = inner.slice(1).trim().toLowerCase();
      const stackIdx = stack.map((s) => s.tag).lastIndexOf(closingTag);
      if (stackIdx !== -1) {
        const above = stack.splice(stackIdx + 1);
        for (let j = above.length - 1; j >= 0; j--) result += `</${above[j].tag}>`;
        result += `</${closingTag}>`;
        stack.splice(stackIdx, 1);
        for (const item of above) {
          result += `<${item.full}>`;
          stack.push(item);
        }
      }
      // else: unmatched closer — skip it
    } else {
      const spaceIdx = inner.search(/\s/);
      const tagName = (spaceIdx === -1 ? inner : inner.slice(0, spaceIdx)).toLowerCase();
      if (TELEGRAM_ALLOWED_TAGS.has(tagName)) {
        result += `<${inner}>`;
        stack.push({ tag: tagName, full: inner });
      }
      // else: unsupported tag — skip markup, text content flows through naturally
    }
    i = close + 1;
  }

  // Close any unclosed tags
  for (let j = stack.length - 1; j >= 0; j--) result += `</${stack[j].tag}>`;
  return result;
}

/**
 * Strips HTML tags from a string and re-escapes for HTML parse mode.
 * Used as a fallback when Telegram rejects a message due to invalid HTML entities.
 */
export function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function openTag(e: MessageEntity): string | null {
  switch (e.type) {
    case 'bold':
      return '<b>';
    case 'italic':
      return '<i>';
    case 'underline':
      return '<u>';
    case 'strikethrough':
      return '<s>';
    case 'code':
      return '<code>';
    case 'pre':
      return '<pre>';
    case 'spoiler':
      return '<tg-spoiler>';
    case 'text_link':
      return `<a href="${e.url}">`;
    case 'blockquote':
      return '<blockquote>';
    case 'expandable_blockquote':
      return '<blockquote expandable>';
    case 'custom_emoji':
      return e.custom_emoji_id ? `<tg-emoji emoji-id="${e.custom_emoji_id}">` : null;
    default:
      return null;
  }
}

function closeTag(e: MessageEntity): string {
  switch (e.type) {
    case 'bold':
      return '</b>';
    case 'italic':
      return '</i>';
    case 'underline':
      return '</u>';
    case 'strikethrough':
      return '</s>';
    case 'code':
      return '</code>';
    case 'pre':
      return '</pre>';
    case 'spoiler':
      return '</tg-spoiler>';
    case 'text_link':
      return '</a>';
    case 'blockquote':
    case 'expandable_blockquote':
      return '</blockquote>';
    case 'custom_emoji':
      return '</tg-emoji>';
    default:
      return '';
  }
}
