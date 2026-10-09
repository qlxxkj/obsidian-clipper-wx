import { Defuddle } from "defuddle/node";
import { parseHTML } from "linkedom";

const USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 clipper-backend/1.0";

/**
 * Build Obsidian-style YAML frontmatter from an extracted article.
 * Mirrors the Obsidian Web Clipper default frontmatter:
 *   title, source, author (wikilink), published, created, description, tags
 */
export function buildFrontmatter(meta, { tags = ["clippings"], source = "web" } = {}) {
    const lines = [];
    const str = (v) => JSON.stringify(String(v));

    lines.push(`title: ${str(meta.title || "")}`);
    lines.push(`source: ${str(meta.domain || "")}`);
    lines.push(`source_type: ${str(source)}`);
    if (meta.author) lines.push(`author: "[[${meta.author}]]"`);
    if (meta.published) lines.push(`published: ${str(new Date(meta.published).toISOString().slice(0, 10))}`);
    lines.push(`created: ${str(new Date().toISOString().slice(0, 10))}`);
    if (meta.description) lines.push(`description: ${str(meta.description)}`);
    lines.push(`tags:\n  - ${tags.map((t) => `"${t}"`).join("\n  - ")}`);
    return `---\n${lines.join("\n")}\n---\n\n`;
}

/** Substitute `{{key}}` variables in a template string. */
export function applyTemplate(template, vars) {
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) =>
        Object.prototype.hasOwnProperty.call(vars, key) && vars[key] !== undefined ? String(vars[key]) : "",
    );
}

/** Sensible default template matching the Obsidian Web Clipper output. */
export const DEFAULT_TEMPLATE = `{{frontmatter}}
{{content}}`;

/**
 * Fetch a URL and extract its article into Markdown + frontmatter.
 * Returns { markdown, meta, content, contentHtml, rawHtml }.
 */
export async function clipUrl(url, options = {}) {
    const target = String(url).trim();
    if (!/^https?:\/\//i.test(target)) throw new Error("A valid http(s) URL is required");

    const resp = await fetch(target, {
        redirect: "follow",
        headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": options.language ? `${options.language},en;q=0.8` : "en;q=0.8",
        },
        signal: AbortSignal.timeout(options.timeoutMs || 30000),
    });
    if (!resp.ok) throw new Error(`Upstream returned HTTP ${resp.status}`);
    const rawHtml = await resp.text();

    // Build the DOM with linkedom (non-deprecated Defuddle input path) so
    // relative URLs and extractor matching resolve against the real page URL.
    const { document } = parseHTML(rawHtml, { url: target });
    const result = await Defuddle(document, target, {
        markdown: true,
        separateMarkdown: true,
        contentSelector: options.selector,
        language: options.language,
    });

    const meta = {
        title: result.title,
        author: result.author,
        published: result.published,
        domain: result.domain,
        site: result.site,
        description: result.description,
        wordCount: result.wordCount,
        language: result.language,
        image: result.image,
        url: target,
    };

    // Defuddle already converts content to Markdown when `markdown: true`,
    // so `content` is Markdown. `separateMarkdown` may also surface it.
    const content = result.contentMarkdown ?? result.content ?? "";
    const contentHtml = result.contentHtml ?? "";

    const vars = {
        frontmatter: buildFrontmatter(meta, { tags: options.tags, source: "web" }),
        title: meta.title,
        author: meta.author,
        url: target,
        published: meta.published ? new Date(meta.published).toISOString().slice(0, 10) : "",
        created: new Date().toISOString().slice(0, 10),
        description: meta.description,
        domain: meta.domain,
        site: meta.site,
        image: meta.image,
        wordCount: String(meta.wordCount ?? ""),
        content: content,
        contentHtml: contentHtml,
        fullHtml: rawHtml,
    };

    const markdown = options.template
        ? applyTemplate(options.template, vars)
        : applyTemplate(DEFAULT_TEMPLATE, vars);

    return { markdown, meta, content, contentHtml, vars };
}

/**
 * Convert caller-provided Markdown (optional frontmatter + body) without any
 * network fetch. This is the "纯图文转发" path: the Mini Program passes the
 * content it already has; we only normalize it and produce the final note.
 *
 * @param {object} input { content?: string, frontmatter?: object|Array, template?: string, url?, title?, description? }
 */
export function clipPure(input = {}) {
    const content = String(input.content ?? "").replace(/\r\n/g, "\n");

    let fmLines = [];
    const tags = Array.isArray(input.tags) ? input.tags : [];
    if (input.title) fmLines.push(`title: ${JSON.stringify(input.title)}`);
    if (input.url) fmLines.push(`source: ${JSON.stringify(input.url)}`);
    if (input.description) fmLines.push(`description: ${JSON.stringify(input.description)}`);
    if (Array.isArray(input.frontmatter)) {
        for (const [k, v] of input.frontmatter) fmLines.push(`${k}: ${JSON.stringify(String(v))}`);
    } else if (input.frontmatter && typeof input.frontmatter === "object") {
        for (const [k, v] of Object.entries(input.frontmatter)) {
            if (v === undefined || v === null || v === "") continue;
            fmLines.push(`${k}: ${JSON.stringify(String(v))}`);
        }
    }
    fmLines.push(`created: ${JSON.stringify(new Date().toISOString().slice(0, 10))}`);
    fmLines.push(`tags:\n  - ${["clippings", ...tags].map((t) => JSON.stringify(t)).join("\n  - ")}`);

    const frontmatter = `---\n${fmLines.join("\n")}\n---\n\n`;
    const vars = {
        frontmatter,
        title: input.title ?? "",
        url: input.url ?? "",
        content,
    };
    const markdown = input.template ? applyTemplate(input.template, vars) : applyTemplate(DEFAULT_TEMPLATE, vars);
    return { markdown, frontmatter, content };
}
