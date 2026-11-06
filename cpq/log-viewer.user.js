// ==UserScript==
// @name         CPQ Log Viewer
// @namespace    http://tampermonkey.net
// @version      1.0
// @description  Collapsible, filterable view for CPQ debug log pages
// @author       Sven Hansen (PW)
// @match        https://*.oraclegovcloud2.com/admin/log/log_file.jsp*
// @match        https://*.bigmachines.com/admin/log/log_file.jsp*
// @match        https://*.oraclegovcloud2.com/*/admin/log/log_file.jsp*
// @match        https://*.bigmachines.com/*/admin/log/log_file.jsp*
// @updateURL    https://github.com/Pierce-Washington/cpq-qol-scripts-dist/raw/main/cpq/log-viewer.user.js
// @downloadURL  https://github.com/Pierce-Washington/cpq-qol-scripts-dist/raw/main/cpq/log-viewer.user.js
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// ==/UserScript==

(function () {
    'use strict';

    // e.g. "02 Nov 2026 15:57:57,372 [ERROR]  - message"
    const ENTRY_RE = /^(\d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2},\d{3}) \[(\w+)\]\s*-?\s*(.*)$/;

    const LEVEL_COLORS = {
        ERROR: '#ff6b6b',
        WARN: '#f2a93b',
        INFO: '#7fb4f5',
        DEBUG: '#8fc9a3',
        TRACE: '#a08fd0'
    };

    const KNOWN_NODES_KEY = `knownNodes_${window.location.host}`; // legacy per-script GM storage
    // Shared with other qol scripts (admin-quick-links records nodes on every page)
    const NODE_STORE_KEY = 'tmKnownNodes';
    const NODE_CHIP_COLORS = ['#7fb4f5', '#8fc9a3', '#f2a93b', '#a08fd0', '#ff8fa3', '#6fd3d3'];

    function getKnownNodes() {
        let nodes = [];
        try { nodes = JSON.parse(localStorage.getItem(NODE_STORE_KEY) || '[]'); } catch { /* reset below */ }
        if (!Array.isArray(nodes)) nodes = [];
        // merge nodes recorded before the move from GM storage to localStorage
        GM_getValue(KNOWN_NODES_KEY, []).forEach(name => { if (!nodes.includes(name)) nodes.push(name); });
        return nodes;
    }

    function saveKnownNodes(nodes) {
        localStorage.setItem(NODE_STORE_KEY, JSON.stringify(nodes));
    }

    // Log file names seen on this site, shared via localStorage like the nodes
    const LOG_FILES_KEY = 'tmKnownLogFiles';
    const LAST_LOG_FILE_KEY = 'tmLastLogFile';

    function getKnownLogFiles() {
        let files = [];
        try { files = JSON.parse(localStorage.getItem(LOG_FILES_KEY) || '[]'); } catch { /* reset */ }
        return Array.isArray(files) ? files : [];
    }

    function recordLogFile(fileName) {
        const files = getKnownLogFiles();
        if (!files.includes(fileName)) {
            files.push(fileName);
            localStorage.setItem(LOG_FILES_KEY, JSON.stringify(files));
        }
        localStorage.setItem(LAST_LOG_FILE_KEY, fileName);
    }

    function getCurrentNode() {
        const value = document.cookie.split('; ').find(c => c.startsWith('APACHE_LB_NODE='))?.split('=')[1];
        return value ? decodeURIComponent(value) : null;
    }

    function setNodeCookie(nodeName) {
        // Only the stickiness cookie is touched; session cookies are left alone.
        document.cookie = `APACHE_LB_NODE=${nodeName}; path=/`;
    }

    function nodeChipColor(nodeName) {
        const hash = [...String(nodeName)].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
        return NODE_CHIP_COLORS[hash % NODE_CHIP_COLORS.length];
    }

    // "02 Nov 2026 15:57:57,372" -> epoch ms (NaN if unparseable)
    const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
    function parseTimestamp(ts) {
        const m = /^(\d{2}) (\w{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(ts);
        if (!m) return NaN;
        return new Date(+m[3], MONTHS[m[2]] ?? 0, +m[1], +m[4], +m[5], +m[6], +m[7]).getTime();
    }

    // Find the element holding the raw log text. The log page markup varies, so
    // probe the likely containers and keep whichever holds timestamped entries.
    function findLogSource(doc = document) {
        const candidates = [
            ...doc.querySelectorAll('pre'),
            ...doc.querySelectorAll('textarea'),
            doc.body
        ];
        for (const el of candidates) {
            const text = el.tagName === 'TEXTAREA' ? el.value : el.innerText ?? el.textContent;
            if (text && ENTRY_RE.test(text.split('\n', 50).find(line => ENTRY_RE.test(line)) || '')) {
                return { element: el, text };
            }
        }
        return null;
    }

    function parseEntries(text) {
        const entries = [];
        let current = null;
        for (const line of text.split('\n')) {
            const match = ENTRY_RE.exec(line);
            if (match) {
                if (current) entries.push(current);
                current = { ts: match[1], lvl: match[2], msg: match[3], body: [] };
            } else if (current) {
                current.body.push(line);
            }
        }
        if (current) entries.push(current);
        return entries;
    }

    function buildViewer(entries) {
        const root = document.createElement('div');
        root.id = 'tm-log-viewer';

        const header = document.createElement('div');
        header.className = 'tm-lv-header';

        // Which log file is being viewed; options come from files seen before
        const fileSelect = document.createElement('select');
        fileSelect.className = 'tm-lv-node-select';
        fileSelect.title = 'Switch log file';
        header.append(fileSelect);

        function refreshFiles(current) {
            fileSelect.textContent = '';
            const files = getKnownLogFiles();
            if (current && !files.includes(current)) files.push(current);
            files.forEach(name => {
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                fileSelect.append(option);
            });
            const other = document.createElement('option');
            other.value = '__other__';
            other.textContent = 'Other…';
            fileSelect.append(other);
            fileSelect.value = current || files[0] || '__other__';
        }

        // Logs are node-specific; surface which LB node served this page and let the
        // user re-pin the APACHE_LB_NODE stickiness cookie to a previously seen node.
        const node = document.createElement('span');
        node.className = 'tm-lv-node';
        node.title = 'From the APACHE_LB_NODE cookie';
        header.append(node);

        const nodeSelect = document.createElement('select');
        nodeSelect.className = 'tm-lv-node-select';
        nodeSelect.title = 'Switch to a known node (sets APACHE_LB_NODE and reloads)';
        header.append(nodeSelect);

        const mergeButton = document.createElement('button');
        mergeButton.type = 'button';
        mergeButton.textContent = '⇄ Merge nodes';
        mergeButton.title = 'Fetch this log from every known node and show the combined output in chronological order';
        header.append(mergeButton);

        function renderNodeOptions(current, knownNodes) {
            nodeSelect.textContent = '';
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = 'Switch node…';
            nodeSelect.append(placeholder);
            knownNodes.forEach(name => {
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name === current ? `${name} (current)` : name;
                option.disabled = name === current;
                nodeSelect.append(option);
            });
            nodeSelect.value = '';
            nodeSelect.hidden = knownNodes.length < 2;
            mergeButton.hidden = knownNodes.length < 2;
        }

        function refreshNode(requestedNode = null) {
            const current = getCurrentNode();
            const knownNodes = getKnownNodes();
            if (current && !knownNodes.includes(current)) {
                knownNodes.push(current);
                saveKnownNodes(knownNodes);
            }
            if (requestedNode && current !== requestedNode) {
                node.textContent = `Node: ${current || 'unknown'} (pin to ${requestedNode} failed — LB overrode it)`;
                node.classList.add('tm-lv-node-warn');
            } else {
                node.textContent = `Node: ${current || 'unknown'}`;
                node.classList.remove('tm-lv-node-warn');
            }
            renderNodeOptions(current, knownNodes);
            return current;
        }
        refreshNode();

        const filter = document.createElement('input');
        filter.type = 'search';
        filter.placeholder = 'Filter entries…';
        header.append(filter);

        const levelWrap = document.createElement('span');
        levelWrap.className = 'tm-lv-levels';
        header.append(levelWrap);

        const reloadButton = document.createElement('button');
        reloadButton.type = 'button';
        reloadButton.textContent = '↻ Reload';
        header.append(reloadButton);

        const rawToggle = document.createElement('button');
        rawToggle.type = 'button';
        rawToggle.textContent = 'Show raw log';
        header.append(rawToggle);

        const count = document.createElement('span');
        count.className = 'tm-lv-count';
        header.append(count);

        const list = document.createElement('div');
        let rows = [];
        let boxes = [];

        function renderLevels(levels) {
            const previous = new Map(boxes.map(box => [box.value, box.checked]));
            levelWrap.textContent = '';
            boxes = levels.map(lvl => {
                const label = document.createElement('label');
                const box = document.createElement('input');
                box.type = 'checkbox';
                box.checked = previous.get(lvl) ?? true;
                box.value = lvl;
                box.addEventListener('change', apply);
                const name = document.createElement('span');
                name.textContent = lvl;
                name.style.color = LEVEL_COLORS[lvl] || '#d6d9e0';
                label.append(box, name);
                levelWrap.append(label);
                return box;
            });
        }

        function renderRows(entries) {
            list.textContent = '';
            rows = entries.map(entry => {
                const details = document.createElement('details');
                details.dataset.lvl = entry.lvl;
                const summary = document.createElement('summary');
                const ts = document.createElement('span');
                ts.className = 'tm-lv-ts';
                ts.textContent = entry.ts;
                const lvl = document.createElement('span');
                lvl.className = 'tm-lv-lvl';
                lvl.textContent = entry.lvl;
                lvl.style.color = LEVEL_COLORS[entry.lvl] || '#d6d9e0';
                summary.append(ts, lvl);
                if (entry.node) {
                    const chip = document.createElement('span');
                    chip.className = 'tm-lv-node-chip';
                    chip.textContent = entry.node;
                    chip.title = `Served by node ${entry.node}`;
                    chip.style.color = nodeChipColor(entry.node);
                    chip.style.borderColor = nodeChipColor(entry.node);
                    summary.append(chip);
                }
                const msg = document.createElement('span');
                msg.className = 'tm-lv-msg';
                msg.textContent = entry.msg.trim() || entry.body.find(line => line.trim()) || '';
                summary.append(msg);
                details.append(summary);
                const body = entry.body.join('\n').replace(/^\n+|\n+$/g, '');
                if (body) {
                    const pre = document.createElement('pre');
                    pre.textContent = body;
                    details.append(pre);
                }
                list.append(details);
                return details;
            });
        }

        function apply() {
            const query = filter.value.toLowerCase();
            const wanted = new Set(boxes.filter(box => box.checked).map(box => box.value));
            let shown = 0;
            for (const row of rows) {
                const visible = wanted.has(row.dataset.lvl) &&
                    (!query || row.textContent.toLowerCase().includes(query));
                row.classList.toggle('tm-lv-hidden', !visible);
                if (visible) shown++;
            }
            count.textContent = `${shown} / ${rows.length} entries`;
        }
        filter.addEventListener('input', apply);

        function setEntries(entries) {
            renderLevels([...new Set(entries.map(entry => entry.lvl))]);
            renderRows(entries);
            apply();
        }
        setEntries(entries);

        function setNodeLabel(text, warn = false) {
            node.textContent = text;
            node.classList.toggle('tm-lv-node-warn', warn);
        }

        root.append(header, list);
        return { root, rawToggle, reloadButton, setEntries, refreshNode, nodeSelect, mergeButton, setNodeLabel, fileSelect, refreshFiles, count };
    }

    GM_addStyle(`
        #tm-log-viewer { font: 13px/1.45 ui-monospace, Menlo, Consolas, monospace; background: #14161c; color: #d6d9e0; text-align: left; }
        #tm-log-viewer .tm-lv-header { position: sticky; top: 0; z-index: 10; background: #1c1f28; padding: 10px 16px; border-bottom: 1px solid #333a4d; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
        #tm-log-viewer .tm-lv-header input[type=search] { background: #262b38; color: #d6d9e0; border: 1px solid #3c4458; border-radius: 6px; padding: 6px 10px; width: 320px; }
        #tm-log-viewer .tm-lv-node { font-weight: 700; color: #ffd479; background: #2b2615; border: 1px solid #5a4a22; border-radius: 6px; padding: 5px 10px; }
        #tm-log-viewer .tm-lv-node-warn { color: #ff6b6b; border-color: #ff6b6b; }
        #tm-log-viewer .tm-lv-node-select { background: #262b38; color: #d6d9e0; border: 1px solid #3c4458; border-radius: 6px; padding: 5px 8px; font: inherit; cursor: pointer; }
        #tm-log-viewer .tm-lv-node-chip { flex: none; border: 1px solid; border-radius: 999px; padding: 0 8px; font-size: 11px; line-height: 1.6; }
        #tm-log-viewer .tm-lv-levels { display: inline-flex; gap: 12px; align-items: center; }
        #tm-log-viewer .tm-lv-header label { display: inline-flex; gap: 4px; align-items: center; cursor: pointer; font-size: 12px; font-weight: 700; }
        #tm-log-viewer .tm-lv-header button { background: #262b38; color: #d6d9e0; border: 1px solid #3c4458; border-radius: 6px; padding: 6px 10px; cursor: pointer; }
        #tm-log-viewer .tm-lv-count { color: #8a93ab; font-size: 12px; margin-left: auto; }
        #tm-log-viewer details { border-bottom: 1px solid #242938; }
        #tm-log-viewer details[open] { background: #1a1e29; }
        #tm-log-viewer summary { display: flex; gap: 10px; padding: 4px 16px; cursor: pointer; white-space: nowrap; overflow: hidden; list-style: none; }
        #tm-log-viewer summary::-webkit-details-marker { display: none; }
        #tm-log-viewer summary:hover { background: #222736; }
        #tm-log-viewer .tm-lv-ts { color: #8a93ab; flex: none; }
        #tm-log-viewer .tm-lv-lvl { flex: none; width: 52px; font-weight: 700; }
        #tm-log-viewer .tm-lv-msg { overflow: hidden; text-overflow: ellipsis; }
        #tm-log-viewer pre { margin: 0; padding: 8px 16px 12px 90px; white-space: pre-wrap; word-break: break-word; color: #b9bfcf; }
        #tm-log-viewer .tm-lv-hidden { display: none; }
        .tm-lv-raw-hidden { display: none !important; }
    `);

    function init() {
        if (document.getElementById('tm-log-viewer')) return;
        const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const getToken = () => pageWindow._BM_CSRF_TOKEN ||
            document.querySelector('input[name="token"]')?.value || '';

        // File name rendered into the page; empty on the "{{fileName}}" template
        // that a plain GET (e.g. the quick-links tab) produces.
        function getPageFileName() {
            const name = document.querySelector('input[name="fileName"]')?.value ||
                /Log File\s+(\S+)/.exec(document.body?.querySelector('table:first-of-type td.top-bar')?.textContent || '')?.[1] || '';
            return name.includes('{{') ? '' : name;
        }

        let source = findLogSource();
        let entries = source ? parseEntries(source.text) : [];
        let currentFileName = getPageFileName() ||
            localStorage.getItem(LAST_LOG_FILE_KEY) || 'bm.log';
        let needsAutoLoad = false;

        if (!source || !entries.length) {
            // Empty template (GET) — drive the POST ourselves if the token is available
            if (!getToken()) return;
            needsAutoLoad = true;
            if (!source) {
                const raw = document.createElement('pre');
                raw.className = 'tm-lv-raw-hidden';
                document.body.append(raw);
                source = { element: raw, text: '' };
                entries = [];
            }
        } else {
            recordLogFile(currentFileName);
        }

        const { root, rawToggle, reloadButton, setEntries, refreshNode, nodeSelect, mergeButton, setNodeLabel, fileSelect, refreshFiles } = buildViewer(entries);
        refreshFiles(currentFileName);

        // POST the log request (the page is served by fileName + CSRF token; a plain
        // GET only returns the empty "{{fileName}}" template) and parse the result.
        async function fetchLogEntries() {
            const { fileName, token } = getReloadParams();
            if (!token) throw new Error('CSRF token (_BM_CSRF_TOKEN) not found on this page.');
            const response = await fetch(window.location.href, {
                method: 'POST',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: `fileName=${encodeURIComponent(fileName)}&token=${encodeURIComponent(token)}`
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const freshDoc = new DOMParser().parseFromString(await response.text(), 'text/html');
            const fresh = findLogSource(freshDoc);
            if (!fresh) throw new Error('No log entries found in the reloaded page.');
            return { entries: parseEntries(fresh.text), text: fresh.text };
        }

        function updateRawView(text) {
            if (source.element.tagName === 'TEXTAREA') source.element.value = text;
            else source.element.textContent = text;
        }

        async function withBusyButton(button, busyText, action) {
            const buttons = [reloadButton, mergeButton, nodeSelect, fileSelect];
            buttons.forEach(el => { el.disabled = true; });
            const originalText = button.textContent;
            button.textContent = busyText;
            try {
                await action();
                button.textContent = originalText;
            } catch (error) {
                console.error(`${originalText} failed:`, error);
                button.textContent = `${originalText} failed: ${error.message}`;
                setTimeout(() => { button.textContent = originalText; }, 5000);
            } finally {
                buttons.forEach(el => { el.disabled = false; });
            }
        }

        // Reload from the current node. If requestedNode is set, the APACHE_LB_NODE
        // cookie was just pinned to it; afterwards verify the LB honored the pin.
        function reloadLog(requestedNode = null) {
            return withBusyButton(reloadButton, '↻ Reloading…', async () => {
                const { entries, text } = await fetchLogEntries();
                setEntries(entries);
                refreshNode(requestedNode); // re-read the cookie; flags the pin if the LB overrode it
                updateRawView(text);
                recordLogFile(currentFileName);
                refreshFiles(currentFileName);
            });
        }
        reloadButton.addEventListener('click', () => reloadLog());

        fileSelect.addEventListener('change', () => {
            let target = fileSelect.value;
            if (target === '__other__') {
                target = (prompt('Log file name:', currentFileName) || '').trim();
                if (!target) {
                    refreshFiles(currentFileName);
                    return;
                }
            }
            if (!target || target === currentFileName) return;
            currentFileName = target;
            refreshFiles(currentFileName);
            reloadLog();
        });

        nodeSelect.addEventListener('change', () => {
            const target = nodeSelect.value;
            if (!target) return;
            setNodeCookie(target);
            reloadLog(target);
        });

        // Fetch the log from every known node by re-pinning the stickiness cookie per
        // request, tag entries with their node, and present them in timestamp order.
        mergeButton.addEventListener('click', () => withBusyButton(mergeButton, '⇄ Merging…', async () => {
            const knownNodes = getKnownNodes();
            const originalNode = getCurrentNode();
            const merged = [];
            const failed = [];
            try {
                for (const nodeName of knownNodes) {
                    setNodeCookie(nodeName);
                    mergeButton.textContent = `⇄ Fetching ${nodeName}…`;
                    const { entries } = await fetchLogEntries();
                    if (getCurrentNode() !== nodeName) {
                        failed.push(nodeName);
                        continue; // LB overrode the pin; these entries belong to another node
                    }
                    entries.forEach(entry => { entry.node = nodeName; });
                    merged.push(...entries);
                }
            } finally {
                if (originalNode) setNodeCookie(originalNode);
            }
            if (!merged.length) throw new Error(`No node could be fetched (pin failed for: ${failed.join(', ')}).`);
            // Stable sort keeps each node's internal order for identical timestamps
            merged.sort((a, b) => (parseTimestamp(a.ts) || 0) - (parseTimestamp(b.ts) || 0));
            setEntries(merged);
            const okCount = knownNodes.length - failed.length;
            setNodeLabel(
                `Merged ${okCount}/${knownNodes.length} nodes${failed.length ? ` (failed: ${failed.join(', ')})` : ''}`,
                failed.length > 0
            );
            if (failed.length) throw new Error(`pin failed for ${failed.join(', ')}`);
        }));

        // The page is served by a POST of fileName + CSRF token; a plain GET only
        // returns the empty "{{fileName}}" template, so replay that POST to reload.
        function getReloadParams() {
            return { fileName: currentFileName, token: getToken() };
        }

        if (source.element === document.body) {
            // Wrap existing body content so it can be toggled back as the raw view
            const raw = document.createElement('div');
            raw.className = 'tm-lv-raw-hidden';
            raw.append(...document.body.childNodes);
            document.body.append(raw, root);
            source.element = raw;
        } else {
            source.element.classList.add('tm-lv-raw-hidden');
            source.element.before(root);
        }

        rawToggle.addEventListener('click', () => {
            const showRaw = !root.classList.contains('tm-lv-collapsed');
            root.classList.toggle('tm-lv-collapsed', showRaw);
            [...root.children].slice(1).forEach(child => child.classList.toggle('tm-lv-hidden', showRaw));
            source.element.classList.toggle('tm-lv-raw-hidden', !showRaw);
            rawToggle.textContent = showRaw ? 'Show formatted log' : 'Show raw log';
        });

        // Landed on the empty GET template (e.g. via the quick-links tab):
        // fetch the last-used log file immediately.
        if (needsAutoLoad) reloadLog();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
