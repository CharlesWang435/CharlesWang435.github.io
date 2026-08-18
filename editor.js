/* ============================================================
   copy editor
   ------------------------------------------------------------
   Loaded only when the page is opened with #edit, so visitors never
   fetch it. Every block carrying data-k becomes editable in place;
   Export fetches the raw index.html and rewrites just the blocks that
   changed, leaving the rest of the file byte for byte identical.
   ============================================================ */
(function () {
  "use strict";

  var STORE = "copyEdits";
  var blocks = Array.prototype.slice.call(document.querySelectorAll("[data-k]"));
  if (!blocks.length) return;

  var original = {};        // key -> innerHTML as the file has it
  var bar, countEl, exportBtn;

  blocks.forEach(function (el) { original[el.getAttribute("data-k")] = el.innerHTML; });

  /* ---------- restore anything typed before a reload ---------- */
  var pending = {};
  try { pending = JSON.parse(localStorage.getItem(STORE) || "{}"); } catch (e) {}
  blocks.forEach(function (el) {
    var k = el.getAttribute("data-k");
    if (pending[k] !== undefined && pending[k] !== el.innerHTML) el.innerHTML = pending[k];
  });

  function changed() {
    return blocks.filter(function (el) {
      return el.innerHTML !== original[el.getAttribute("data-k")];
    });
  }

  function save() {
    var out = {};
    changed().forEach(function (el) { out[el.getAttribute("data-k")] = el.innerHTML; });
    try { localStorage.setItem(STORE, JSON.stringify(out)); } catch (e) {}
    refresh();
  }

  function refresh() {
    var n = changed().length;
    countEl.textContent = n === 0 ? "no changes yet" : n + (n === 1 ? " change" : " changes");
    exportBtn.disabled = n === 0;
  }

  /* ---------- make the copy editable ---------- */
  blocks.forEach(function (el) {
    el.setAttribute("contenteditable", "true");
    el.setAttribute("spellcheck", "true");
    el.classList.add("ed-on");

    el.addEventListener("input", save);
    el.addEventListener("blur", save);

    // plain text only: pasted styling would end up in the committed HTML
    el.addEventListener("paste", function (e) {
      e.preventDefault();
      var t = (e.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, t.replace(/\s*\n\s*/g, " "));
    });

    // Enter ends the block instead of inserting a stray <div>
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); el.blur(); }
      if (e.key === "Escape") {
        el.innerHTML = original[el.getAttribute("data-k")];
        el.blur();
        save();
      }
    });

  });

  // the site's own handlers (lightbox, tabs) sit on ancestors of the editable
  // blocks and were registered first, so they have to be headed off at the
  // document before the event ever reaches them
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest || !t.closest("[data-k]")) return;
    e.stopPropagation();
    if (t.closest("a")) e.preventDefault();     // no navigating away mid-edit
  }, true);

  // copy parked behind a closed tab still has to be reachable; revealing it is
  // a runtime-only change, the hidden attribute stays in the file
  Array.prototype.forEach.call(document.querySelectorAll("[hidden]"), function (el) {
    if (el.querySelector("[data-k]")) el.hidden = false;
  });

  /* ---------- rewrite the raw source, one block at a time ---------- */
  // finds the element carrying data-k="<key>" and swaps its inner HTML,
  // tracking nesting so a <span> inside a <span> closes in the right place
  function replaceBlock(src, key, html) {
    var at = src.indexOf('data-k="' + key + '"');
    if (at < 0) return null;

    var lt = src.lastIndexOf("<", at);
    if (lt < 0) return null;
    var tag = /^<([a-zA-Z][\w-]*)/.exec(src.slice(lt, at));
    if (!tag) return null;
    tag = tag[1];

    var openEnd = src.indexOf(">", at);
    if (openEnd < 0) return null;

    var depth = 1, i = openEnd + 1, innerEnd = -1;
    var re = new RegExp("<(/?)" + tag + "(?=[\\s/>])", "gi");
    re.lastIndex = i;
    var m;
    while ((m = re.exec(src))) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) { innerEnd = m.index; break; }
    }
    if (innerEnd < 0) return null;

    return src.slice(0, openEnd + 1) + html + src.slice(innerEnd);
  }

  function doExport() {
    var edits = changed();
    exportBtn.disabled = true;
    exportBtn.textContent = "Building…";

    fetch("index.html", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("could not read index.html (" + r.status + ")");
        return r.text();
      })
      .then(function (src) {
        var failed = [];
        edits.forEach(function (el) {
          var k = el.getAttribute("data-k");
          var next = replaceBlock(src, k, el.innerHTML);
          if (next === null) failed.push(k); else src = next;
        });

        if (failed.length === edits.length) throw new Error("no blocks could be matched in the source");

        var url = URL.createObjectURL(new Blob([src], { type: "text/html" }));
        var a = document.createElement("a");
        a.href = url;
        a.download = "index.html";
        a.click();
        URL.revokeObjectURL(url);

        // the downloaded file is now the new baseline
        edits.forEach(function (el) {
          if (failed.indexOf(el.getAttribute("data-k")) < 0) {
            original[el.getAttribute("data-k")] = el.innerHTML;
          }
        });
        try { localStorage.removeItem(STORE); } catch (e) {}
        save();

        exportBtn.textContent = "Export index.html";
        note(failed.length
          ? "Downloaded, but " + failed.length + " block(s) could not be matched: " + failed.join(", ")
          : "Downloaded. Replace index.html with it and commit.", failed.length > 0);
      })
      .catch(function (err) {
        exportBtn.textContent = "Export index.html";
        exportBtn.disabled = false;
        note("Export failed: " + err.message + " — open the site over http://, not file://", true);
      });
  }

  function note(msg, bad) {
    var n = bar.querySelector(".ed-note");
    n.textContent = msg;
    n.classList.toggle("bad", !!bad);
    clearTimeout(note.t);
    note.t = setTimeout(function () { n.textContent = ""; n.classList.remove("bad"); }, 9000);
  }

  function discard() {
    changed().forEach(function (el) { el.innerHTML = original[el.getAttribute("data-k")]; });
    try { localStorage.removeItem(STORE); } catch (e) {}
    refresh();
    note("Reverted to the file's wording.");
  }

  /* ---------- toolbar ---------- */
  var css = document.createElement("style");
  css.textContent = [
    ".ed-bar{position:fixed;left:0;right:0;top:0;z-index:9999;display:flex;align-items:center;gap:14px;",
    "padding:10px 18px;background:#0b0d0c;border-bottom:1px solid #2c6e49;color:#eef1ec;",
    "font:500 13px/1.4 'JetBrains Mono',ui-monospace,monospace;flex-wrap:wrap}",
    ".ed-bar b{color:#9fe0b4;letter-spacing:.12em;text-transform:uppercase;font-size:11px}",
    ".ed-bar .ed-count{color:#a6ada4}",
    ".ed-bar .ed-note{flex:1 1 220px;color:#9fe0b4;font-size:11px}",
    ".ed-bar .ed-note.bad{color:#ffab91}",
    ".ed-bar button{font:inherit;font-size:12px;padding:6px 13px;border-radius:999px;cursor:pointer;",
    "border:1px solid #2c6e49;background:rgba(159,224,180,.1);color:#9fe0b4}",
    ".ed-bar button:hover:not(:disabled){background:rgba(159,224,180,.2)}",
    ".ed-bar button:disabled{opacity:.4;cursor:default}",
    ".ed-bar button.ed-ghost{border-color:#39403a;color:#a6ada4;background:transparent}",
    /* the site nav is fixed to the top; push it clear of the bar */
    "body{padding-top:46px}nav{top:46px}html{scroll-padding-top:130px}",
    "[data-k].ed-on{outline:1px dashed rgba(108,196,140,.28);outline-offset:3px;border-radius:2px}",
    "[data-k].ed-on:hover{outline-color:rgba(108,196,140,.65)}",
    "[data-k].ed-on:focus{outline:2px solid #6cc48c;outline-offset:3px;background:rgba(108,196,140,.07)}"
  ].join("");
  document.head.appendChild(css);

  bar = document.createElement("div");
  bar.className = "ed-bar";
  bar.innerHTML =
    '<b>Edit mode</b><span class="ed-count"></span>' +
    '<span class="ed-note"></span>' +
    '<button type="button" class="ed-ghost" data-act="discard">Discard changes</button>' +
    '<button type="button" data-act="export">Export index.html</button>';
  document.body.appendChild(bar);

  countEl = bar.querySelector(".ed-count");
  exportBtn = bar.querySelector('[data-act="export"]');
  exportBtn.addEventListener("click", doExport);
  bar.querySelector('[data-act="discard"]').addEventListener("click", discard);

  window.addEventListener("beforeunload", function (e) {
    if (changed().length) { e.preventDefault(); e.returnValue = ""; }
  });

  refresh();
})();
