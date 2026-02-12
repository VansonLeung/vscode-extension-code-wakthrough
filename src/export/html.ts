import * as vscode from "vscode";
import * as path from "path";
import { Walkthrough, WalkthroughStep } from "../walkthrough/types";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function readLines(
  rootPath: string,
  step: WalkthroughStep
): Promise<string | null> {
  const filePath = path.resolve(rootPath, step.file);
  const uri = vscode.Uri.file(filePath);
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const startLine = Math.max(0, step.lines[0] - 1);
    const endLine = Math.min(doc.lineCount - 1, step.lines[1] - 1);
    const lines: string[] = [];
    for (let i = startLine; i <= endLine; i++) {
      lines.push(doc.lineAt(i).text);
    }
    return lines.join("\n");
  } catch {
    return null;
  }
}

function renderCodeBlock(
  code: string,
  startLine: number,
  filePath: string
): string {
  const lines = code.split("\n");
  const lineNumberWidth = String(startLine + lines.length - 1).length;
  const rows = lines
    .map((line, i) => {
      const num = startLine + i;
      const padded = String(num).padStart(lineNumberWidth, " ");
      return `<tr><td class="line-num">${padded}</td><td class="line-code">${escapeHtml(line)}</td></tr>`;
    })
    .join("\n");

  return `<div class="code-block">
  <div class="code-header">${escapeHtml(filePath)}</div>
  <table class="code-table"><tbody>${rows}</tbody></table>
</div>`;
}

export async function exportToHtml(walkthrough: Walkthrough): Promise<string> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const rootPath = workspaceFolders?.[0]?.uri.fsPath ?? "";

  const steps: string[] = [];

  for (let i = 0; i < walkthrough.steps.length; i++) {
    const step = walkthrough.steps[i];
    const lineLabel =
      step.lines[0] === step.lines[1]
        ? `L${step.lines[0]}`
        : `L${step.lines[0]}-${step.lines[1]}`;

    const code = await readLines(rootPath, step);
    const codeHtml = code !== null
      ? renderCodeBlock(code, step.lines[0], `${step.file} (${lineLabel})`)
      : `<p class="error">Could not read ${escapeHtml(step.file)}</p>`;

    steps.push(`
    <section class="step" id="step-${i}">
      <div class="step-header">
        <span class="step-number">${i + 1}</span>
        <span class="step-file">${escapeHtml(step.file)} <span class="step-lines">${lineLabel}</span></span>
      </div>
      <p class="subtitle">${escapeHtml(step.subtitle)}</p>
      ${codeHtml}
    </section>`);
  }

  const commitNote = walkthrough.commitSha
    ? `<p class="commit">Commit: <code>${walkthrough.commitSha.slice(0, 7)}</code></p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(walkthrough.title)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
    color: #e4e4e7;
    background: #18181b;
    padding: 2rem;
    max-width: 900px;
    margin: 0 auto;
  }
  h1 { font-size: 1.8rem; font-weight: 700; margin-bottom: 0.25rem; color: #fafafa; }
  .description { color: #a1a1aa; margin-bottom: 0.5rem; }
  .commit { color: #71717a; font-size: 0.85rem; margin-bottom: 1.5rem; }
  .commit code { background: #27272a; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.85em; }
  .toc { margin-bottom: 2rem; }
  .toc h2 { font-size: 1rem; color: #a1a1aa; margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .toc ol { padding-left: 1.5rem; }
  .toc li { margin-bottom: 0.25rem; }
  .toc a { color: #60a5fa; text-decoration: none; }
  .toc a:hover { text-decoration: underline; }
  hr { border: none; border-top: 1px solid #27272a; margin: 2rem 0; }
  .step { margin-bottom: 2.5rem; }
  .step-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; }
  .step-number {
    display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border-radius: 50%;
    background: #3b82f6; color: #fff; font-weight: 700; font-size: 0.85rem; flex-shrink: 0;
  }
  .step-file { font-family: "SF Mono", "Fira Code", Consolas, monospace; font-size: 0.9rem; color: #d4d4d8; }
  .step-lines { color: #71717a; }
  .subtitle { color: #d4d4d8; margin-bottom: 0.75rem; font-size: 0.95rem; }
  .code-block {
    background: #1e1e1e;
    border: 1px solid #2e2e32;
    border-radius: 8px;
    overflow: hidden;
  }
  .code-header {
    background: #27272a;
    color: #a1a1aa;
    font-family: "SF Mono", "Fira Code", Consolas, monospace;
    font-size: 0.8rem;
    padding: 0.4rem 1rem;
    border-bottom: 1px solid #2e2e32;
  }
  .code-table { width: 100%; border-collapse: collapse; }
  .code-table td { padding: 0 1rem; white-space: pre; font-family: "SF Mono", "Fira Code", Consolas, monospace; font-size: 0.85rem; line-height: 1.6; }
  .line-num { color: #52525b; text-align: right; user-select: none; width: 1%; padding-right: 1rem; border-right: 1px solid #2e2e32; }
  .line-code { color: #d4d4d8; }
  .error { color: #f87171; font-style: italic; }
  .nav {
    position: fixed; bottom: 1.5rem; right: 1.5rem;
    display: flex; gap: 0.5rem; z-index: 100;
  }
  .nav button {
    background: #3b82f6; color: #fff; border: none; border-radius: 8px;
    padding: 0.5rem 1rem; font-size: 0.9rem; cursor: pointer; font-weight: 600;
    transition: background 0.15s;
  }
  .nav button:hover { background: #2563eb; }
  .nav button:disabled { opacity: 0.4; cursor: default; background: #3b82f6; }
  .nav .counter { display: flex; align-items: center; color: #a1a1aa; font-size: 0.85rem; padding: 0 0.5rem; }
  @media (max-width: 600px) {
    body { padding: 1rem; }
    .code-table td { font-size: 0.75rem; padding: 0 0.5rem; }
  }
</style>
</head>
<body>
  <h1>${escapeHtml(walkthrough.title)}</h1>
  <p class="description">${escapeHtml(walkthrough.description)}</p>
  ${commitNote}

  <nav class="toc">
    <h2>Steps</h2>
    <ol>
      ${walkthrough.steps.map((s, i) => `<li><a href="#step-${i}">${escapeHtml(s.file)} &mdash; ${escapeHtml(s.subtitle.length > 60 ? s.subtitle.slice(0, 60) + "..." : s.subtitle)}</a></li>`).join("\n      ")}
    </ol>
  </nav>

  <hr>

  ${steps.join("\n\n  <hr>\n\n")}

  <div class="nav">
    <button id="prev" onclick="navigate(-1)">&larr; Prev</button>
    <span class="counter" id="counter">1 / ${walkthrough.steps.length}</span>
    <button id="next" onclick="navigate(1)">Next &rarr;</button>
  </div>

<script>
(function() {
  var total = ${walkthrough.steps.length};
  var current = 0;
  var prevBtn = document.getElementById("prev");
  var nextBtn = document.getElementById("next");
  var counter = document.getElementById("counter");

  function updateNav() {
    counter.textContent = (current + 1) + " / " + total;
    prevBtn.disabled = current === 0;
    nextBtn.disabled = current === total - 1;
  }

  window.navigate = function(dir) {
    var next = current + dir;
    if (next < 0 || next >= total) return;
    current = next;
    var el = document.getElementById("step-" + current);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    updateNav();
  };

  // Track scroll position to update counter
  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        var id = entry.target.id;
        var idx = parseInt(id.replace("step-", ""), 10);
        if (!isNaN(idx)) {
          current = idx;
          updateNav();
        }
      }
    });
  }, { threshold: 0.5 });

  for (var i = 0; i < total; i++) {
    var el = document.getElementById("step-" + i);
    if (el) observer.observe(el);
  }

  // Keyboard navigation
  document.addEventListener("keydown", function(e) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { navigate(1); e.preventDefault(); }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") { navigate(-1); e.preventDefault(); }
  });

  updateNav();
})();
</script>
</body>
</html>`;
}
