import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { Rich, parseBlocks, citedNumbers } from '../../src/app/rich';

const html = (text: string, opts: { inline?: boolean; max?: number; cite?: boolean } = {}) =>
  renderToStaticMarkup(<Rich text={text} inline={opts.inline} max={opts.max} onCite={opts.cite === false ? undefined : () => {}} />);
const chip = (n: number) => `<button type="button" class="cite" aria-label="Open source ${n}">${n}</button>`;

describe('inline code', () => {
  it('renders the reported reply as code, with no backticks left', () => {
    const out = html('It is an `Amoeba` implementing a unique rotation instead of using the general `Shape` rotation.');
    expect(out).toContain('an <code class="code-inline">Amoeba</code> implementing');
    expect(out).toContain('general <code class="code-inline">Shape</code> rotation');
    expect(out).not.toContain('`');
  });
  it('does not format anything inside code, and handles double backticks', () => {
    const out = html('Use `**not bold** and _x_ and [1]` then ``a `tick` inside``.', { max: 3 });
    expect(out).toContain('<code class="code-inline">**not bold** and _x_ and [1]</code>');
    expect(out).toContain('<code class="code-inline">a `tick` inside</code>');
    expect(out).not.toContain('class="cite"');
  });
  it('leaves a lone backtick as text', () => {
    expect(html("Don't use ` here")).toContain('use ` here');
  });
});

describe('fenced code blocks', () => {
  const src = 'Here is the method:\n\n```java\nclass Amoeba extends Shape {\n    @Override\n    void rotate() {\n\t\tspin(90);\n    }\n}\n```\n\nThat overrides `rotate` [1].';
  it('keeps line breaks and indentation, labels the language, and continues after', () => {
    const out = html(src, { max: 1 });
    expect(out).toContain('<span class="code-lang">java</span>');
    expect(out).toContain('<pre class="code-block" tabindex="0" aria-label="java code"><code>class Amoeba extends Shape {\n    @Override\n    void rotate() {\n\t\tspin(90);\n    }\n}</code></pre>');
    expect(out).toContain(`<p>That overrides <code class="code-inline">rotate</code> ${chip(1)}.</p>`);
  });
  it('handles a fence with no language, a tilde fence, and an unclosed fence', () => {
    expect(parseBlocks('```\na\n  b\n```')).toEqual([{ type: 'code', lang: '', code: 'a\n  b' }]);
    expect(parseBlocks('~~~py\nx = 1\n~~~')).toEqual([{ type: 'code', lang: 'py', code: 'x = 1' }]);
    expect(parseBlocks('Before\n```js\nlet a = 1;\nlet b = 2;')).toEqual([
      { type: 'p', lines: ['Before'] },
      { type: 'code', lang: 'js', code: 'let a = 1;\nlet b = 2;' },
    ]);
  });
  it('keeps markup and blank lines inside a block as literal text', () => {
    const out = html('```\n**x** [1]\n\n<b>y</b>\n```', { max: 1 });
    expect(out).toContain('<code>**x** [1]\n\n&lt;b&gt;y&lt;/b&gt;</code>');
  });
});

describe('lists, emphasis and citations', () => {
  it('renders a list whose items contain code and citations', () => {
    const out = html('Key ideas:\n- `Shape.rotate()` is the default [1]\n- `Amoeba` overrides it [2]\n  to spin in place', { max: 2 });
    expect(out).toContain('<p>Key ideas:</p>');
    expect(out).toContain(`<li><code class="code-inline">Shape.rotate()</code> is the default ${chip(1)}</li>`);
    expect(out).toContain(`<li><code class="code-inline">Amoeba</code> overrides it ${chip(2)} to spin in place</li>`);
  });
  it('renders a citation right next to code and inside bold or italics', () => {
    const out = html('See `rotate()`[2] and **the override [1]** and *mostly [2]*.', { max: 2 });
    expect(out).toContain(`<code class="code-inline">rotate()</code>${chip(2)}`);
    expect(out).toContain(`<strong>the override ${chip(1)}</strong>`);
    expect(out).toContain(`<em>mostly ${chip(2)}</em>`);
  });
  it('renders bold, italics, numbered lists that start late, and grouped citations', () => {
    const out = html('**Bold** and *italic* and __also bold__ and _also italic_.\n\n3. third\n4. fourth [1, 2]', { max: 2 });
    expect(out).toContain('<strong>Bold</strong> and <em>italic</em> and <strong>also bold</strong> and <em>also italic</em>.');
    expect(out).toContain(`<ol start="3"><li>third</li><li>fourth ${chip(1)}${chip(2)}</li></ol>`);
  });
  it('does not mistake maths or snake_case for italics', () => {
    const out = html('2 * 3 * 4 = 24 and my_var_name stays.');
    expect(out).toContain('2 * 3 * 4 = 24 and my_var_name stays.');
    expect(out).not.toContain('<em>');
  });
  it('drops invented citation numbers, and keeps [n] as text where nothing can be opened', () => {
    expect(html('Fact [9].', { max: 2 })).toBe('<div class="rich"><p>Fact .</p></div>');
    expect(html('Fact [1].', { cite: false })).toBe('<div class="rich"><p>Fact [1].</p></div>');
  });
  it('counts citations for the source chips, ignoring brackets inside code', () => {
    expect(citedNumbers('Uses `arr[1]` and [2], then [3][2].\n```\nx[4]\n```')).toEqual([2, 3]);
  });
});

describe('inline mode (flashcards, quiz options)', () => {
  it('produces only phrasing content, so it is valid inside buttons and labels', () => {
    const out = html('Front with `code`\n\n- one\n- two\n\n```\nline 1\n  line 2\n```', { inline: true });
    expect(out).not.toMatch(/<(p|div|ul|ol|li|pre)[ >]/);
    expect(out).toContain('<code class="code-inline">code</code>');
    expect(out).toContain('<span class="rich-line">• one<br/>• two</span>');
    expect(out).toContain('<code class="code-block">line 1\n  line 2</code>');
  });
});

describe('safety', () => {
  it('never turns model text into HTML', () => {
    const evil = '<img src=x onerror=alert(1)> **<script>alert(2)</script>** `<b>x</b>`\n```html\n<iframe src="javascript:alert(3)"></iframe>\n```';
    const out = html(evil);
    expect(out).not.toMatch(/<(img|script|iframe|b)[ >]/);
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
    expect(out).toContain('&lt;iframe src=&quot;javascript:alert(3)&quot;&gt;&lt;/iframe&gt;');
  });
  it('no app source sets innerHTML', () => {
    for (const f of readdirSync('src/app')) expect(readFileSync(`src/app/${f}`, 'utf8'), f).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML\s*=/);
  });
});
