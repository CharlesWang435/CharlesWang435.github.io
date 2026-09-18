/* ============================================================
   copy editor
   ------------------------------------------------------------
   Loaded only when the page is opened with #edit, so visitors never
   fetch it. Three kinds of tagged element are editable in place:

     [data-k]   a single block of text (heading, paragraph, li, ...)
     [data-lk]  a <ul> whose <li> children can be added and removed
     [data-bk]  a whole removable block (a skills-section .srow)

   Export fetches the raw index.html and rewrites only what changed —
   edited text, deleted nodes, newly added nodes — leaving everything
   else byte for byte identical.
   ============================================================ */
(function () {
  "use strict";

  var STORE = "copyEdits2";
  try { localStorage.removeItem("copyEdits"); } catch (e) {}   // old format, no longer read

  var blocks = Array.prototype.slice.call(document.querySelectorAll("[data-k]"));
  if (!blocks.length) return;

  var original = {};   // key -> innerHTML (data-k) or `true` (data-bk, existence only)
  var removed  = {};   // key -> true, for shipped nodes the user deleted
  var inserted = {};   // key -> parentKey, for brand-new top-level nodes added this session
  var bar, countEl, exportBtn;

  var seq = 0;
  function freshKey(prefix) { seq += 1; return prefix + "-" + Date.now().toString(36) + seq; }
  function keyOf(el) { return el.getAttribute("data-k") || el.getAttribute("data-bk"); }
  function elByKey(k) { return k && document.querySelector('[data-k="' + k + '"], [data-bk="' + k + '"]'); }

  // a freshly-added node (or anything nested inside one) carries editor-only
  // wiring — contenteditable, the "+" control — that must never reach the file
  function cleanHTML(el) {
    var clone = el.cloneNode(true);
    var strip = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll("*")));
    strip.forEach(function (n) {
      n.removeAttribute("contenteditable");
      n.removeAttribute("spellcheck");
      if (n.getAttribute("style") === "") n.removeAttribute("style");  // Chrome leaves this behind on typed li/span
      if (n.classList.contains("ed-on")) {
        n.classList.remove("ed-on");
        if (!n.className) n.removeAttribute("class");
      }
    });
    Array.prototype.forEach.call(clone.querySelectorAll(".ed-add-li, .ed-add-block"), function (n) { n.remove(); });
    return clone.outerHTML;
  }

  blocks.forEach(function (el) { original[el.getAttribute("data-k")] = el.innerHTML; });

  var lists = Array.prototype.slice.call(document.querySelectorAll("[data-lk]"));
  var blockEls = Array.prototype.slice.call(document.querySelectorAll("[data-bk]"));
  blockEls.forEach(function (el) { original[el.getAttribute("data-bk")] = true; });

  function changed() {
    return blocks.filter(function (el) {
      var k = el.getAttribute("data-k");
      return original[k] !== undefined && !removed[k] && el.innerHTML !== original[k];
    });
  }

  function persist() {
    var mod = {};
    changed().forEach(function (el) { mod[el.getAttribute("data-k")] = el.innerHTML; });

    var ins = [];
    Object.keys(inserted).forEach(function (k) {
      var el = elByKey(k);
      if (!el) { delete inserted[k]; return; }
      ins.push({ key: k, parentKey: inserted[k], html: cleanHTML(el) });
    });

    try {
      localStorage.setItem(STORE, JSON.stringify({ mod: mod, rm: Object.keys(removed), ins: ins }));
    } catch (e) {}
    refresh();
  }

  function refresh() {
    var n = changed().length + Object.keys(inserted).length + Object.keys(removed).length;
    countEl.textContent = n === 0 ? "no changes yet" : n + (n === 1 ? " change" : " changes");
    exportBtn.disabled = n === 0;
  }

  /* ---------- the pieces every editable node needs ---------- */

  function makeEditable(el) {
    if (el.getAttribute("contenteditable") === "true") return;
    el.setAttribute("contenteditable", "true");
    el.setAttribute("spellcheck", "true");
    el.classList.add("ed-on");
    el.addEventListener("input", persist);
    el.addEventListener("blur", persist);

    // plain text only: pasted styling would end up in the committed HTML
    el.addEventListener("paste", function (e) {
      e.preventDefault();
      var t = (e.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, t.replace(/\s*\n\s*/g, " "));
    });

    el.addEventListener("keydown", onKeydown);
  }

  function onKeydown(e) {
    var el = this;
    if (e.key === "Escape") {
      var k = keyOf(el);
      if (original[k] === undefined) removeNode(el);          // never shipped: throw it away
      else { el.innerHTML = original[k]; el.blur(); persist(); }
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;

    if (el.tagName === "LI" && el.parentElement && el.parentElement.hasAttribute("data-lk")) {
      e.preventDefault();
      addBullet(el.parentElement, el);                        // next bullet, not end-of-edit
    } else if (el.tagName === "P") {
      e.preventDefault();
      document.execCommand("insertLineBreak");                // a new line within the paragraph
    } else {
      e.preventDefault();
      el.blur();                                               // single-line field: Enter ends it
    }
  }

  /* ---------- add / remove list items ---------- */

  function isInsideInsertion(el) {
    var p = el.parentElement;
    while (p) {
      var k = p.getAttribute && (p.getAttribute("data-bk") || p.getAttribute("data-k"));
      if (k && inserted.hasOwnProperty(k)) return true;
      p = p.parentElement;
    }
    return false;
  }

  function addBullet(ul, afterLi) {
    var node = document.createElement("li");
    var key = freshKey("li");
    node.setAttribute("data-k", key);
    if (afterLi) afterLi.insertAdjacentElement("afterend", node);
    else ul.insertBefore(node, ul.firstElementChild);
    // a bullet added inside a block that is itself brand new (e.g. a fresh
    // skill category) rides along in that block's own export, not its own
    if (!isInsideInsertion(ul)) inserted[key] = ul.getAttribute("data-lk");
    makeEditable(node);
    wireRemovable(node);
    node.focus();
    persist();
  }

  function addListControls(ul) {
    if (ul.querySelector(":scope > .ed-add-li")) return;
    var ctrl = document.createElement("li");
    ctrl.className = "ed-add-li";
    ctrl.setAttribute("contenteditable", "false");
    ctrl.setAttribute("tabindex", "0");
    ctrl.setAttribute("role", "button");
    ctrl.setAttribute("aria-label", "Add item");
    ctrl.textContent = "+";
    function go() { addBullet(ul, ctrl.previousElementSibling); }
    ctrl.addEventListener("click", go);
    ctrl.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
    });
    ul.appendChild(ctrl);
  }

  function removeNode(el) {
    var k = keyOf(el);
    if (inserted.hasOwnProperty(k)) delete inserted[k];
    else if (original[k] !== undefined) removed[k] = true;
    el.remove();
    hideX();
    persist();
  }

  /* ---------- hover-to-delete overlay ----------
     lives outside every [data-k]/[data-bk] subtree so it can never end up
     inside an element's innerHTML/outerHTML and leak into an export */
  var xBtn = document.createElement("button");
  xBtn.type = "button";
  xBtn.className = "ed-x-overlay";
  xBtn.setAttribute("aria-label", "Remove this item");
  xBtn.textContent = "✕";
  document.body.appendChild(xBtn);
  var xHideT = null, xTarget = null;

  function showX(el) {
    clearTimeout(xHideT);
    xTarget = el;
    var r = el.getBoundingClientRect();
    xBtn.style.left = (r.right - 9) + "px";
    xBtn.style.top = (r.top - 9) + "px";
    xBtn.classList.add("show");
  }
  function scheduleHideX() { xHideT = setTimeout(hideX, 300); }
  function hideX() { xBtn.classList.remove("show"); xTarget = null; }
  xBtn.addEventListener("mouseenter", function () { clearTimeout(xHideT); });
  xBtn.addEventListener("mouseleave", scheduleHideX);
  xBtn.addEventListener("click", function (e) {
    e.preventDefault();
    if (xTarget) removeNode(xTarget);
  });

  function wireRemovable(el) {
    el.addEventListener("mouseenter", function () { showX(el); });
    el.addEventListener("mouseleave", scheduleHideX);
    el.addEventListener("focus", function () { showX(el); }, true);
    el.addEventListener("blur", scheduleHideX, true);
  }

  /* ---------- add / remove whole skill blocks ---------- */

  var skillList = document.getElementById("skillsetList");

  function addSkillBlock() {
    if (!skillList) return;
    var bk = freshKey("skill");
    var titleKey = freshKey("k");
    var chipsLk = freshKey("chips");

    var row = document.createElement("div");
    row.className = "srow";
    row.setAttribute("data-bk", bk);
    row.innerHTML =
      '<h3><span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>' +
      '</span><span data-k="' + titleKey + '">New category</span></h3>' +
      '<ul class="chips" data-lk="' + chipsLk + '"></ul>';

    skillList.insertBefore(row, skillList.querySelector(".ed-add-block"));
    inserted[bk] = "skillsetList";

    var titleEl = row.querySelector("span[data-k]");
    var chipsUl = row.querySelector("ul.chips");
    makeEditable(titleEl);
    wireRemovable(row);
    addListControls(chipsUl);
    addBullet(chipsUl, null);   // seeds the first chip, focuses it
    titleEl.focus();
    persist();
  }

  if (skillList) {
    var addBlockBtn = document.createElement("div");
    addBlockBtn.className = "ed-add-block";
    addBlockBtn.setAttribute("tabindex", "0");
    addBlockBtn.setAttribute("role", "button");
    addBlockBtn.textContent = "+ Add skill category";
    addBlockBtn.addEventListener("click", addSkillBlock);
    addBlockBtn.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); addSkillBlock(); }
    });
    skillList.appendChild(addBlockBtn);
  }

  /* ---------- wire everything already on the page ---------- */

  blocks.forEach(makeEditable);
  lists.forEach(function (ul) {
    Array.prototype.forEach.call(ul.children, function (li) {
      if (li.tagName === "LI") wireRemovable(li);
    });
    addListControls(ul);
  });
  blockEls.forEach(wireRemovable);

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

  /* ---------- restore anything from before a reload ---------- */

  function wireSubtree(root) {
    if (root.hasAttribute("data-k")) makeEditable(root);
    Array.prototype.forEach.call(root.querySelectorAll("[data-k]"), makeEditable);
    Array.prototype.forEach.call(root.querySelectorAll("[data-lk]"), addListControls);
    Array.prototype.forEach.call(root.querySelectorAll("[data-lk] > li"), wireRemovable);
    if (root.hasAttribute("data-bk")) wireRemovable(root);
  }

  var saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE) || "null"); } catch (e) {}

  if (saved) {
    Object.keys(saved.mod || {}).forEach(function (k) {
      var el = elByKey(k);
      if (el && original[k] !== undefined) el.innerHTML = saved.mod[k];
    });
    (saved.rm || []).forEach(function (k) {
      var el = elByKey(k);
      if (el) { el.remove(); removed[k] = true; }
    });
    (saved.ins || []).forEach(function (rec) {
      var parent = document.querySelector('[data-lk="' + rec.parentKey + '"]') || document.getElementById(rec.parentKey);
      if (!parent) return;
      var tmp = document.createElement("div");
      tmp.innerHTML = rec.html;
      var node = tmp.firstElementChild;
      if (!node) return;
      var ctrl = parent.querySelector(":scope > .ed-add-li, :scope > .ed-add-block");
      parent.insertBefore(node, ctrl || null);
      inserted[rec.key] = rec.parentKey;
      wireSubtree(node);
    });
  }

  /* ---------- rewrite the raw source, one node at a time ----------
     finds the element carrying data-k/data-lk/data-bk = <key> and reports
     where its opening tag, matching closing tag, and everything between sit,
     tracking nesting so a <span> inside a <span> resolves to the right one */
  function locate(src, key) {
    var at = src.indexOf('data-k="' + key + '"');
    if (at < 0) at = src.indexOf('data-lk="' + key + '"');
    if (at < 0) at = src.indexOf('data-bk="' + key + '"');
    if (at < 0) return null;

    var lt = src.lastIndexOf("<", at);
    if (lt < 0) return null;
    var tagM = /^<([a-zA-Z][\w-]*)/.exec(src.slice(lt, at));
    if (!tagM) return null;
    var tag = tagM[1];

    var openEnd = src.indexOf(">", at);
    if (openEnd < 0) return null;
    openEnd += 1;

    var depth = 1, innerEnd = -1, closeEnd = -1;
    var re = new RegExp("<(/?)" + tag + "(?=[\\s/>])", "gi");
    re.lastIndex = openEnd;
    var m;
    while ((m = re.exec(src))) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) {
        innerEnd = m.index;
        closeEnd = src.indexOf(">", m.index) + 1;
        break;
      }
    }
    if (innerEnd < 0) return null;
    return { openStart: lt, openEnd: openEnd, innerEnd: innerEnd, closeEnd: closeEnd };
  }

  function spliceReplace(src, loc, html) { return src.slice(0, loc.openEnd) + html + src.slice(loc.innerEnd); }
  function spliceDelete(src, loc) {
    var end = loc.closeEnd;
    var trail = /^[ \t]*\r?\n/.exec(src.slice(end));      // eat the line the node left behind
    if (trail) end += trail[0].length;
    return src.slice(0, loc.openStart) + src.slice(end);
  }
  function spliceInsertAfter(src, loc, html) { return src.slice(0, loc.closeEnd) + "\n          " + html + src.slice(loc.closeEnd); }

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
        var failed = [], ok = 0;

        edits.forEach(function (el) {
          var k = el.getAttribute("data-k");
          var loc = locate(src, k);
          if (!loc) { failed.push(k); return; }
          src = spliceReplace(src, loc, el.innerHTML);
          ok++;
        });

        Object.keys(removed).forEach(function (k) {
          var loc = locate(src, k);
          if (!loc) { failed.push(k); return; }
          src = spliceDelete(src, loc);
          ok++;
        });

        // insert in document order, so an earlier sibling is already
        // spliced into `src` by the time a later one anchors off it
        var insertEls = Object.keys(inserted).map(elByKey).filter(Boolean);
        insertEls.sort(function (a, b) {
          return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
        });
        insertEls.forEach(function (el) {
          var key = keyOf(el);
          var html = cleanHTML(el);
          var prev = el.previousElementSibling;
          var anchorLoc = prev && locate(src, keyOf(prev));
          if (anchorLoc) { src = spliceInsertAfter(src, anchorLoc, html); ok++; return; }
          var parentKey = el.parentElement && el.parentElement.getAttribute("data-lk");
          var parentLoc = parentKey && locate(src, parentKey);
          if (parentLoc) { src = src.slice(0, parentLoc.openEnd) + "\n          " + html + src.slice(parentLoc.openEnd); ok++; return; }
          failed.push(key);
        });

        if (ok === 0 && failed.length) throw new Error("no blocks could be matched in the source");

        var url = URL.createObjectURL(new Blob([src], { type: "text/html" }));
        var a = document.createElement("a");
        a.href = url;
        a.download = "index.html";
        a.click();
        URL.revokeObjectURL(url);

        // the downloaded file is now the new baseline
        edits.forEach(function (el) { original[el.getAttribute("data-k")] = el.innerHTML; });
        Object.keys(removed).forEach(function (k) { delete removed[k]; });
        insertEls.forEach(function (el) {
          var k = keyOf(el);
          if (el.hasAttribute("data-bk")) {
            original[k] = true;
            // its own text fields weren't on `blocks` (they didn't exist at page
            // load) — fold them in now so further edits keep being tracked
            Array.prototype.forEach.call(el.querySelectorAll("[data-k]"), function (sub) {
              original[sub.getAttribute("data-k")] = sub.innerHTML;
              if (blocks.indexOf(sub) < 0) blocks.push(sub);
            });
          } else {
            original[k] = el.innerHTML;
            if (blocks.indexOf(el) < 0) blocks.push(el);
          }
          delete inserted[k];
        });
        try { localStorage.removeItem(STORE); } catch (e) {}
        persist();

        exportBtn.textContent = "Export index.html";
        note(failed.length
          ? "Downloaded, but " + failed.length + " item(s) could not be matched: " + failed.join(", ")
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
    // structural edits (added/removed nodes) are easiest to undo by throwing
    // the in-memory DOM away entirely and re-fetching the shipped page
    try { localStorage.removeItem(STORE); } catch (e) {}
    location.hash = "edit";
    location.reload();
  }

  /* ---------- toolbar ---------- */
  var css = document.createElement("style");
  css.textContent = [
    ".ed-bar{position:fixed;left:0;right:0;top:0;z-index:9999;display:flex;align-items:center;gap:14px;",
    "padding:10px 18px;background:#0b0d0c;border-bottom:1px solid #2c6e49;color:#eef1ec;",
    "font:500 13px/1.4 'JetBrains Mono',ui-monospace,monospace;flex-wrap:wrap}",
    ".ed-bar b{color:#9fe0b4;letter-spacing:.12em;text-transform:uppercase;font-size:11px}",
    ".ed-bar .ed-count{color:#a6ada4}",
    ".ed-bar .ed-hint{color:#6d746b;font-size:11px}",
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
    "[data-k].ed-on:focus{outline:2px solid #6cc48c;outline-offset:3px;background:rgba(108,196,140,.07)}",
    "[data-bk]{outline:1px dashed transparent;outline-offset:4px;border-radius:8px;transition:outline-color .15s}",
    "[data-bk]:hover{outline-color:rgba(108,196,140,.35)}",
    ".ed-add-li{list-style:none;text-align:center;cursor:pointer;opacity:.5;border:1px dashed rgba(150,150,140,.45);border-radius:6px}",
    ".ed-add-li::before{content:none}",
    ".ed-add-li:hover,.ed-add-li:focus{opacity:1;outline:none;border-color:#6cc48c}",
    ".ed-add-block{cursor:pointer;opacity:.55;border:1px dashed rgba(150,150,140,.45);border-radius:10px;",
    "padding:14px;text-align:center;margin-top:10px;font:500 13px/1.4 'JetBrains Mono',monospace;color:inherit}",
    ".ed-add-block:hover,.ed-add-block:focus{opacity:1;outline:none;border-color:#6cc48c}",
    ".ed-x-overlay{position:fixed;display:none;width:19px;height:19px;padding:0;border-radius:50%;",
    "border:1px solid #c4553b;background:#0b0d0c;color:#ffab91;font:600 12px/17px monospace;",
    "text-align:center;cursor:pointer;z-index:9998}",
    ".ed-x-overlay.show{display:block}"
  ].join("");
  document.head.appendChild(css);

  bar = document.createElement("div");
  bar.className = "ed-bar";
  bar.innerHTML =
    '<b>Edit mode</b><span class="ed-count"></span>' +
    '<span class="ed-hint">Enter adds a bullet &middot; hover an item for &times; &middot; Esc cancels</span>' +
    '<span class="ed-note"></span>' +
    '<button type="button" class="ed-ghost" data-act="discard">Discard changes</button>' +
    '<button type="button" data-act="export">Export index.html</button>';
  document.body.appendChild(bar);

  countEl = bar.querySelector(".ed-count");
  exportBtn = bar.querySelector('[data-act="export"]');
  exportBtn.addEventListener("click", doExport);
  bar.querySelector('[data-act="discard"]').addEventListener("click", discard);

  window.addEventListener("beforeunload", function (e) {
    if (changed().length || Object.keys(inserted).length || Object.keys(removed).length) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  refresh();
})();
