import type { VaultEntry } from '../../src/services/piiVault';

export type EditableTarget = HTMLTextAreaElement | HTMLElement;

const originalTextNodeMap = new WeakMap<Text, string>();

export function isPromptEditor(el: EventTarget | null): el is EditableTarget {
  if (!(el instanceof HTMLElement)) return false;
  if (el.id === 'privaguard-ext-root' || el.closest('#privaguard-ext-root')) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el.isContentEditable) return true;
  const ce = el.closest('[contenteditable="true"]');
  return ce instanceof HTMLElement;
}

export function resolveEditor(el: EventTarget | null): EditableTarget | null {
  if (!(el instanceof HTMLElement)) return null;
  if (el instanceof HTMLTextAreaElement) return el;
  const ce = el.isContentEditable ? el : el.closest('[contenteditable="true"]');
  return ce instanceof HTMLElement ? ce : null;
}

export function readEditorText(editor: EditableTarget): string {
  if (editor instanceof HTMLTextAreaElement) {
    return editor.value;
  }
  return editor.innerText || editor.textContent || '';
}

export function writeEditorText(editor: EditableTarget, nextText: string): void {
  editor.focus();
  if (editor instanceof HTMLTextAreaElement) {
    const proto = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (proto?.set) {
      proto.set.call(editor, nextText);
    } else {
      editor.value = nextText;
    }
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  try {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    sel?.removeAllRanges();
    sel?.addRange(range);
    const ok = document.execCommand('insertText', false, nextText);
    if (!ok) {
      editor.textContent = nextText;
    }
  } catch {
    editor.textContent = nextText;
  }
  editor.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: nextText })
  );
}

function findReplyContainers(): HTMLElement[] {
  const selectors = [
    '[data-message-author-role="assistant"]',
    'model-response',
    '.model-response-text',
    '.font-claude-message',
    '[data-testid="assistant-message"]',
    '.markdown',
  ];
  const set = new Set<HTMLElement>();
  for (const sel of selectors) {
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      if (!el.closest('#privaguard-ext-root') && !el.isContentEditable) {
        set.add(el);
      }
    });
  }
  return Array.from(set);
}

export function hasTokensInReplies(ramVault: Map<string, VaultEntry>): boolean {
  if (ramVault.size === 0) return false;
  for (const box of findReplyContainers()) {
    const text = box.textContent || '';
    for (const token of ramVault.keys()) {
      if (text.includes(token)) return true;
    }
  }
  return false;
}

export function setRepliesRevealState(
  ramVault: Map<string, VaultEntry>,
  reveal: boolean
): boolean {
  const containers = findReplyContainers();
  if (reveal) {
    for (const box of containers) {
      const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode() as Text | null;
      while (node) {
        const val = node.nodeValue || '';
        let next = val;
        let changed = false;
        for (const [token, entry] of ramVault.entries()) {
          if (next.includes(token)) {
            next = next.split(token).join(entry.original);
            changed = true;
          }
        }
        if (changed) {
          if (!originalTextNodeMap.has(node)) originalTextNodeMap.set(node, val);
          node.nodeValue = next;
        }
        node = walker.nextNode() as Text | null;
      }
    }
    return true;
  }

  for (const box of containers) {
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode() as Text | null;
    while (node) {
      const orig = originalTextNodeMap.get(node);
      if (orig !== undefined) node.nodeValue = orig;
      node = walker.nextNode() as Text | null;
    }
  }
  return false;
}
