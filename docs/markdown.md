# Workshop Markdown

Chat messages and the design preview render Markdown through the same browser renderer in `public/markdown.ts`. The saved message and document text remains the source of truth. The design editor displays that exact source; rendering never writes a revision or changes its content.

Supported formatting includes headings, paragraphs, line breaks, emphasis, ordered and unordered lists, task lists, block quotes, fenced and inline code, links, and tables. Code and wide tables scroll inside their containers on narrow screens.

The renderer uses Marked for parsing and DOMPurify for a final explicit HTML tag and attribute allowlist. Raw HTML is escaped as visible text. Links accept HTTP, HTTPS, mail and local references; active protocols and protocol-relative links are inert labels. Markdown images render their alt text without fetching remote resources. Generated HTML has no scripts, event handlers, embedded frames, styling attributes or access to application signing authority.

Composer behavior is unchanged: Enter submits, Shift+Enter inserts a newline, and an active or just-completed IME composition does not submit accidentally. Editing uses raw Markdown in the existing textarea and saves through the existing revision checks.

Validation: `bun test tests/markdown.test.ts` covers syntax, escaped HTML, URL filtering and preserved input. Browser acceptance should also inspect both chat and preview on desktop and phone, exercise unsafe markup in the actual DOM, reopen the raw editor, and verify Enter/Shift+Enter/IME behavior.
