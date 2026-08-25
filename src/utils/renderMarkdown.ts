import { marked } from 'marked';

// Shared markdown-to-HTML for the document tabs. Content files carry an
// HTML-comment header (authoring notes, per-seed field lists) that must never
// reach the player — stripped before parsing rather than relying on the
// browser's own comment-hiding, so the behavior doesn't depend on marked's
// raw-HTML passthrough staying enabled.
export function renderMarkdown(source: string): string {
  const withoutComments = source.replace(/<!--[\s\S]*?-->/g, '');
  return marked.parse(withoutComments, { async: false }) as string;
}

// Substitutes {{token}} placeholders in a template's markdown source.
// Throws on an unfilled token rather than leaving raw "{{x}}" in player-facing
// text or silently substituting a placeholder — a missing field is a bug to
// surface immediately, not paper over.
export function applyTemplate(source: string, values: Record<string, string>): string {
  return source.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in values)) {
      throw new Error(`renderMarkdown: template token {{${key}}} has no supplied value`);
    }
    return values[key];
  });
}
