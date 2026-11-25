export function setSafeHref(anchor, url, toNotionAppUrl) {
  const appUrl = toNotionAppUrl(url);
  if (appUrl) {
    anchor.href = appUrl;
    anchor.removeAttribute("target");
    anchor.removeAttribute("rel");
  } else {
    anchor.removeAttribute("href");
    anchor.removeAttribute("target");
    anchor.removeAttribute("rel");
  }
}

export function addText(parent, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  parent.append(node);
  return node;
}

export function createSvgNode(tag, attrs) {
  const node = document.createElementNS
    ? document.createElementNS("http://www.w3.org/2000/svg", tag)
    : document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function createIcon16(shapes, extraAttrs = {}) {
  const svg = createSvgNode("svg", {
    ...extraAttrs,
    width: "13",
    height: "13",
    viewBox: "0 0 16 16",
    fill: "none",
    "aria-hidden": "true",
  });
  svg.append(...shapes.map(([tag, attrs]) => createSvgNode(tag, attrs)));
  return svg;
}

function checkboxShapes(checked) {
  const rect = ["rect", {
    x: "2",
    y: "2",
    width: "12",
    height: "12",
    rx: "3",
    stroke: "currentColor",
    "stroke-width": "1.4",
  }];
  if (!checked) return [rect];
  return [
    rect,
    ["path", {
      d: "M5.2 8.2L7.1 10.1L11 6.1",
      stroke: "currentColor",
      "stroke-width": "1.5",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }],
  ];
}

function createBar(done, total) {
  const complete = total > 0 && done === total;
  if (total <= 12) {
    const segs = document.createElement("div");
    segs.className = "kanban-progress-segs";
    segs.setAttribute("aria-hidden", "true");
    for (let idx = 0; idx < total; idx += 1) {
      const seg = document.createElement("span");
      seg.className = idx < done
        ? (complete ? "kanban-progress-seg is-done-all" : "kanban-progress-seg is-filled")
        : "kanban-progress-seg";
      segs.append(seg);
    }
    return segs;
  }
  const track = document.createElement("div");
  track.className = "kanban-progress-track";
  track.setAttribute("aria-hidden", "true");
  const fill = document.createElement("span");
  fill.className = "kanban-progress-fill";
  if (complete) fill.dataset.complete = "true";
  if (fill.style) fill.style.width = Math.round((done / total) * 100) + "%";
  track.append(fill);
  return track;
}

function createRow(kind, labelText, shapes, done, total) {
  const row = document.createElement("div");
  row.className = "kanban-progress-row";
  row.dataset.kind = kind;

  const kindNode = document.createElement("span");
  kindNode.className = "kanban-progress-kind";
  kindNode.append(createIcon16(shapes));
  addText(kindNode, "span", "", labelText);
  row.append(kindNode, createBar(done, total));

  const count = addText(row, "span", "kanban-progress-count", done + "/" + total);
  if (total > 0 && done === total) count.dataset.complete = "true";
  return row;
}

export function createTaskProgressBox(details, openProgressDrawers, toNotionAppUrl) {
  if (!details.checklist && !details.subtasks) return null;

  const box = document.createElement("details");
  box.className = "kanban-progress-box";
  if (openProgressDrawers.has(details.taskKey)) box.open = true;
  box.addEventListener("toggle", () => {
    if (box.open) openProgressDrawers.add(details.taskKey);
    else openProgressDrawers.delete(details.taskKey);
  });

  const summary = document.createElement("summary");
  summary.className = "kanban-progress-summary";
  const rows = document.createElement("div");
  rows.className = "kanban-progress-rows";

  if (details.checklist) {
    rows.append(createRow("checklist", "체크", checkboxShapes(true), details.checklist.done, details.checklist.total));
  }
  if (details.subtasks) {
    rows.append(createRow(
      "subtasks",
      "하위",
      [
        ["circle", { cx: "4", cy: "3.5", r: "1.6", stroke: "currentColor", "stroke-width": "1.4" }],
        ["circle", { cx: "11.5", cy: "7.5", r: "1.6", stroke: "currentColor", "stroke-width": "1.4" }],
        ["circle", { cx: "11.5", cy: "12.5", r: "1.6", stroke: "currentColor", "stroke-width": "1.4" }],
        ["path", { d: "M4 5.2V12.5H9.8M4 7.5H9.8", stroke: "currentColor", "stroke-width": "1.4", "stroke-linecap": "round", "stroke-linejoin": "round" }],
      ],
      details.subtasks.done,
      details.subtasks.total,
    ));
  }

  const chevron = createIcon16(
    [["path", { d: "M4 6L8 10L12 6", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round" }]],
    { class: "kanban-progress-chevron" },
  );
  summary.append(rows, chevron);
  box.append(summary);

  const drawer = document.createElement("div");
  drawer.className = "kanban-progress-drawer";

  if (details.checklist) {
    const group = document.createElement("div");
    group.className = "kanban-progress-group";
    group.dataset.group = "checklist";
    addText(group, "div", "kanban-progress-group-title", "체크리스트 (" + details.checklist.done + "/" + details.checklist.total + ")");
    const list = document.createElement("ul");
    list.className = "kanban-progress-list";
    details.checklist.items.forEach((item) => {
      const li = document.createElement("li");
      li.className = item.done ? "kanban-progress-item is-done" : "kanban-progress-item";
      li.dataset.done = String(item.done);
      const mark = document.createElement("span");
      mark.className = "kanban-check-mark";
      mark.setAttribute("aria-hidden", "true");
      mark.append(createIcon16(checkboxShapes(item.done)));
      li.append(mark);
      addText(li, "span", "kanban-progress-item-text", item.text);
      list.append(li);
    });
    group.append(list);
    drawer.append(group);
  }

  if (details.subtasks) {
    const group = document.createElement("div");
    group.className = "kanban-progress-group";
    group.dataset.group = "subtasks";
    addText(group, "div", "kanban-progress-group-title", "하위 일감 (" + details.subtasks.done + "/" + details.subtasks.total + ")");
    const list = document.createElement("ul");
    list.className = "kanban-progress-list";
    details.subtasks.items.forEach((item) => {
      const li = document.createElement("li");
      li.className = item.done ? "kanban-progress-item is-done" : "kanban-progress-item";
      li.dataset.done = String(item.done);
      const dot = document.createElement("span");
      dot.className = "status-dot";
      dot.dataset.status = item.status;
      dot.setAttribute("aria-hidden", "true");
      li.append(dot);
      if (item.sourceUrl) {
        const link = document.createElement("a");
        link.className = "kanban-subtask-link";
        link.textContent = item.title;
        setSafeHref(link, item.sourceUrl, toNotionAppUrl);
        li.append(link);
      } else {
        addText(li, "span", "kanban-progress-item-text", item.title);
      }
      addText(li, "span", "kanban-subtask-status", item.status);
      list.append(li);
    });
    group.append(list);
    drawer.append(group);
  }

  box.append(drawer);
  return box;
}
