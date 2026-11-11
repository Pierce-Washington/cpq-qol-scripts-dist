// ==UserScript==
// @name         CPQ General Improvements
// @namespace    http://tampermonkey.net
// @version      1.2
// @description  General CPQ quality of life tweaks
// @author       Sven Hansen (PW)
// @match        https://*.oraclegovcloud2.com/ords/r/cx-cpq/administration/*
// @match        https://*.oraclegovcloud2.com/*
// @match        https://*.bigmachines.com/ords/r/cx-cpq/administration/*
// @match        https://*.bigmachines.com/*
// @updateURL    https://github.com/Pierce-Washington/cpq-qol-scripts-dist/raw/main/cpq/general.user.js
// @downloadURL  https://github.com/Pierce-Washington/cpq-qol-scripts-dist/raw/main/cpq/general.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_setClipboard
// @grant        unsafeWindow
// ==/UserScript==

(function () {
    'use strict';

    // APEX opens some editors (e.g. create-edit-attributes) in dialog iframes.
    // Only the menu-definition tools apply inside frames; everything else
    // (favicon, keep-alive, viewers) runs top-window only.
    if (window.self !== window.top) {
        setupMenuListTools();
        return;
    }

    const SITE_NAME = window.location.host.split('.')[0];
    const FAVICON_WINDOW = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const FAVICON_DOCUMENT = FAVICON_WINDOW.document;
    const IS_CONTAINER_PAGE = FAVICON_WINDOW.location.pathname.includes('/container/');


    /***************************
     * Favicon customization for the site - this allows for dynamic color changes and selection of primary and secondary colors.
     ***************************/

    const ICON_COLORS_KEY = `iconColors_${SITE_NAME}`;
    const DEFAULT_COLORS = { primary: '#ed1c24', secondary: '#fffefe' };
    const PRESET_PRIMARIES = { DEV: '#2e9e44', TEST: '#f28c28' };
    // Variable-label colors are separate from favicon colors and scoped by site and page kind.
    const VARIABLE_COLOR_KEY = kind => `variableNameColor_${SITE_NAME}_${kind}`;
    const DEFAULT_VARIABLE_COLOR = '#800080';
    const buildCopyIconUri = color => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="${color}" stroke-width="2"><rect x="5.5" y="4" width="9" height="11" rx="1.2"/><path d="M10.5 4V2a1 1 0 0 0-1-1h-7a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2"/></svg>`)}`;

    function createVariableCopyButton(variableName, kind) {
        const copyValue = String(variableName).trim().replace(/^\[([\s\S]*)\]$/, '$1').trim();
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tm-variable-copy';
        button.dataset.tmVariableLabel = kind;
        button.dataset.tmVariableKind = kind;
        button.dataset.tmVariableName = copyValue;
        button.title = copyValue;
        button.setAttribute('aria-label', `Copy variable name ${copyValue}`);
        button.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;margin:0 0 0 3px;padding:0;border:0;background:transparent;vertical-align:middle;cursor:pointer;';

        const icon = document.createElement('img');
        icon.alt = copyValue;
        icon.title = copyValue;
        icon.width = 12;
        icon.height = 12;
        icon.src = buildCopyIconUri(VARIABLE_COLORS[kind] || DEFAULT_VARIABLE_COLOR);
        button.appendChild(icon);
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            GM_setClipboard(copyValue);
        });
        return button;
    }

    function buildSvg({ primary, secondary }) {
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">' +
            `<path d="M.08.08h31.84v31.84H.08zm10.5 7.75c-5.76.14-8.9 7.16-6.32 12.07.85 1.62 2.39 3.19 4.09 3.91 3.35 1.41 14.89.92 17.49-1.81 3.72-3.91 3.06-11.7-2.44-13.85-3.45-1.35-9.16-.41-12.82-.32Zm1.02 3.01c3.97-.23 16.73-.9 13.11 7.03-1.96 4.28-13.53 4.73-16.57 1.83-3.33-3.18-.79-8.62 3.46-8.86Z" fill="${primary}" fill-rule="evenodd" stroke="${primary}" stroke-width=".25" stroke-linejoin="round"/>` +
            `<path d="M10.58 7.83c3.66-.09 9.37-1.03 12.82.32 5.5 2.15 6.16 9.94 2.44 13.85-2.6 2.73-14.14 3.22-17.49 1.81-1.7-.72-3.24-2.29-4.09-3.91-2.58-4.91.56-11.93 6.32-12.07Zm1.02 3.01c-4.25.24-6.79 5.68-3.46 8.86 3.04 2.9 14.61 2.45 16.57-1.83 3.62-7.93-9.14-7.26-13.11-7.03Z" fill="${secondary}" fill-rule="evenodd" stroke="${secondary}" stroke-width=".25" stroke-linejoin="round"/>` +
            '</svg>';
    }

    const toDataUri = (colors) => `data:image/svg+xml,${encodeURIComponent(buildSvg(colors))}`;
    const isHex = (value) => /^#[0-9a-f]{6}$/i.test(value);

    const VARIABLE_COLORS = {
        config: isHex(GM_getValue(VARIABLE_COLOR_KEY('config'), DEFAULT_VARIABLE_COLOR))
            ? GM_getValue(VARIABLE_COLOR_KEY('config'), DEFAULT_VARIABLE_COLOR)
            : DEFAULT_VARIABLE_COLOR,
        commerce: isHex(GM_getValue(VARIABLE_COLOR_KEY('commerce'), DEFAULT_VARIABLE_COLOR))
            ? GM_getValue(VARIABLE_COLOR_KEY('commerce'), DEFAULT_VARIABLE_COLOR)
            : DEFAULT_VARIABLE_COLOR
    };

    function loadColors() {
        try {
            const saved = JSON.parse(GM_getValue(ICON_COLORS_KEY, '{}'));
            return {
                primary: isHex(saved.primary) ? saved.primary : DEFAULT_COLORS.primary,
                secondary: isHex(saved.secondary) ? saved.secondary : DEFAULT_COLORS.secondary
            };
        } catch {
            return { ...DEFAULT_COLORS };
        }
    }

    let colors = loadColors();
    let faviconHeadObserver = null;
    let faviconRootObserver = null;
    let observedFaviconHead = null;
    let latestPageFavicon = null;

    function hasIconRel(rel) {
        return String(rel || '').split(/\s+/).some(value => value.toLowerCase() === 'icon');
    }

    // Update Oracle's existing link so it doesn't compete with a second favicon.
    function applyFavicon(link = latestPageFavicon) {
        if (!link?.isConnected || link.parentElement !== FAVICON_DOCUMENT.head) {
            link = FAVICON_DOCUMENT.head?.querySelector('link[rel~="icon"]');
        }
        if (!link) return false;

        if (!link.relList.contains('icon')) link.rel = 'icon';
        if (link.type !== 'image/svg+xml') link.type = 'image/svg+xml';
        const href = toDataUri(colors);
        if (link.getAttribute('href') !== href) link.setAttribute('href', href);
        return true;
    }

    // /container/ pages replace their favicon after startup, so keep a head observer there only.
    function startFaviconObserver() {
        const head = FAVICON_DOCUMENT.head;
        if (!head) return;

        if (head !== observedFaviconHead) {
            faviconHeadObserver?.disconnect();
            observedFaviconHead = head;
            faviconHeadObserver = new FAVICON_WINDOW.MutationObserver(records => {
                let changedLink = null;
                let removedIconLink = false;

                for (const record of records) {
                    if (record.type === 'attributes' && record.target.localName === 'link') {
                        if (record.target.relList.contains('icon') ||
                            (record.attributeName === 'rel' && hasIconRel(record.oldValue))) {
                            changedLink = record.target;
                        }
                    } else if (record.type === 'childList') {
                        for (const node of record.addedNodes) {
                            if (node.localName === 'link' && node.relList.contains('icon')) changedLink = node;
                            if (node.querySelectorAll) {
                                const nestedIcon = [...node.querySelectorAll('link')]
                                    .find(link => link.relList.contains('icon'));
                                if (nestedIcon) changedLink = nestedIcon;
                            }
                        }
                        for (const node of record.removedNodes) {
                            if (node.localName === 'link' && hasIconRel(node.rel)) removedIconLink = true;
                        }
                    }
                }

                if (changedLink) latestPageFavicon = changedLink;
                if (changedLink) applyFavicon(changedLink);
                else if (removedIconLink) applyFavicon();
            });
            faviconHeadObserver.observe(head, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeOldValue: true,
                attributeFilter: ['rel', 'href', 'type']
            });
        }

        applyFavicon();
    }

    function initializeFavicon() {
        if (!IS_CONTAINER_PAGE) {
            applyFavicon();
            return;
        }

        if (!faviconRootObserver && FAVICON_DOCUMENT.documentElement) {
            faviconRootObserver = new FAVICON_WINDOW.MutationObserver(records => {
                const headChanged = records.some(record =>
                    [...record.addedNodes, ...record.removedNodes].some(node =>
                        node.nodeType === FAVICON_WINDOW.Node.ELEMENT_NODE && node.localName === 'head'));
                if (headChanged) startFaviconObserver();
            });
            faviconRootObserver.observe(FAVICON_DOCUMENT.documentElement, { childList: true });
        }
        if (FAVICON_DOCUMENT.head) {
            startFaviconObserver();
            return;
        }
        // A one-shot observer is only needed if Tampermonkey runs before <head> exists.
        const observer = new FAVICON_WINDOW.MutationObserver(() => {
            if (!FAVICON_DOCUMENT.head) return;
            observer.disconnect();
            startFaviconObserver();
        });
        observer.observe(FAVICON_DOCUMENT.documentElement, { childList: true });
    }

    const picker = document.createElement('div');
    picker.id = 'tm-icon-picker';
    picker.hidden = true;
    picker.innerHTML = `
        <div class="tm-icon-fields">
            <section class="tm-picker-section tm-favicon-section">
                <div class="tm-picker-heading">Favicon</div>
                <div class="tm-favicon-controls">
                    <img alt="Icon preview">
                    <div class="tm-icon-fields">
                        <label><input type="color" name="primary"> Primary</label>
                        <label><input type="color" name="secondary"> Secondary</label>
                        <div class="tm-icon-actions">
                            <button type="button" data-preset="DEV">DEV</button>
                            <button type="button" data-preset="TEST">TEST</button>
                            <button type="button" data-action="reset">Reset favicon</button>
                        </div>
                    </div>
                </div>
            </section>
            <section class="tm-picker-section tm-variable-section">
                <div class="tm-picker-heading">Variable name colors</div>
                <div class="tm-variable-controls">
                    <label><input type="color" name="configVariableColor"> Config</label>
                    <label><input type="color" name="commerceVariableColor"> Commerce</label>
                    <button type="button" data-action="reset-variable-colors">Reset to purple</button>
                </div>
            </section>
            <button type="button" class="tm-icon-apply" data-action="apply">Apply Changes</button>
        </div>
    `;
    document.body.appendChild(picker);

    const preview = picker.querySelector('img');
    const inputs = picker.querySelectorAll('input[name="primary"], input[name="secondary"]');
    const variableColorInputs = picker.querySelectorAll('input[name="configVariableColor"], input[name="commerceVariableColor"]');
    let draft = { ...colors };
    let variableColorDraft = { ...VARIABLE_COLORS };

    function renderDraft() {
        preview.src = toDataUri(draft);
        inputs.forEach(input => { input.value = draft[input.name]; });
        variableColorInputs.forEach(input => {
            const kind = input.name === 'configVariableColor' ? 'config' : 'commerce';
            input.value = variableColorDraft[kind];
        });
    }

    function openPicker() {
        draft = { ...colors };
        variableColorDraft = { ...VARIABLE_COLORS };
        renderDraft();
        picker.hidden = false;
    }

    inputs.forEach(input => input.addEventListener('input', () => {
        draft[input.name] = input.value;
        renderDraft();
    }));

    variableColorInputs.forEach(input => input.addEventListener('input', () => {
        const kind = input.name === 'configVariableColor' ? 'config' : 'commerce';
        variableColorDraft[kind] = input.value;
    }));

    picker.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
        draft.primary = PRESET_PRIMARIES[button.dataset.preset];
        renderDraft();
    }));

    picker.querySelector('[data-action="reset"]').addEventListener('click', () => {
        draft = { ...DEFAULT_COLORS };
        renderDraft();
    });

    picker.querySelector('[data-action="reset-variable-colors"]').addEventListener('click', () => {
        variableColorDraft = { config: DEFAULT_VARIABLE_COLOR, commerce: DEFAULT_VARIABLE_COLOR };
        renderDraft();
    });

    picker.querySelector('[data-action="apply"]').addEventListener('click', () => {
        colors = { ...draft };
        GM_setValue(ICON_COLORS_KEY, JSON.stringify(colors));
        Object.assign(VARIABLE_COLORS, variableColorDraft);
        Object.entries(VARIABLE_COLORS).forEach(([kind, color]) => {
            GM_setValue(VARIABLE_COLOR_KEY(kind), color);
            document.querySelectorAll(`.cpq-label[data-tm-variable-label="${kind}"]`)
                .forEach(label => { label.style.color = color; });
            document.querySelectorAll(`.tm-variable-copy[data-tm-variable-kind="${kind}"] img`)
                .forEach(icon => { icon.src = buildCopyIconUri(color); });
        });
        applyFavicon();
        picker.hidden = true;
    });

    document.addEventListener('click', (event) => {
        if (!picker.hidden && !picker.contains(event.target)) picker.hidden = true;
    });


    initializeFavicon();

    /***************************
    * Pipeline viewer
    *
    *
    * 1 - Make pipeline viewer open in a new tab for easier development
    * 2 - Add attribute variable names when applicable - only if config is valid in which case the XML will be populated
    *****************************/

    const url = new URL(window.document.location.href);
    const hostname = url.hostname;

    //add pipeline viewer TAB view to config for easier Development
    // Config pages can rebuild this toolbar on soft (history) navigation, so this runs
    // from a persistent observer instead of a one-shot waitForElement.
    function ensurePipelineViewerButtons() {
        if (typeof (_BM_USER_FULL_ACCESS) === 'undefined' || _BM_USER_FULL_ACCESS !== true) return;
        if (!window.location.href.includes('cpq/config')) return;
        if (document.getElementById('tm-pipeline-viewer')) return;
        const pipelineForm = document.querySelector('#pipelineViewer-form');
        const oobPipelineView = document.querySelector("oj-button[name='pipeline_viewer']");
        if (!pipelineForm || !oobPipelineView) return;
        setupPipelineViewer(pipelineForm, oobPipelineView);
    }

    function setupPipelineViewer(pipelineForm, oobPipelineView) {
        pipelineForm.target = "_blank";

        let newButton = document.createElement("button");
        newButton.id = 'tm-pipeline-viewer';
        newButton.className = "oj-button-text-only oj-button";
        newButton.style.color = "#ffffff";
        newButton.style.backgroundColor = "#008c56";
        //same as banner
        let newDiv = document.createElement("div");
        newDiv.className = "oj-button-label";
        let butSpan = document.createElement("span");
        butSpan.innerText = "Pipeline Viewer";
        newDiv.appendChild(butSpan);
        newButton.appendChild(newDiv);
        newButton.onclick = function () {
            const form = document.getElementById('pipelineViewer-form');
            if (form) {
                form.target = '_blank';
                form.submit();
            }
        }
        oobPipelineView.parentElement.appendChild(newButton);
        oobPipelineView.style.display = "none";
        //hide the OOB button

        const copyButton = newButton.cloneNode(true);
        copyButton.id = 'tm-copy-attribute-json';
        copyButton.querySelector('span').innerText = 'Copy Attribute JSON';
        copyButton.style.marginLeft = '6px';
        copyButton.onclick = copyConfigAttributeJson;
        newButton.after(copyButton);
    }

    const pipelineViewerObserver = new MutationObserver(ensurePipelineViewerButtons);
    function startPipelineViewerObserver() {
        if (document.body) pipelineViewerObserver.observe(document.body, { childList: true, subtree: true });
        else document.addEventListener('DOMContentLoaded', () => pipelineViewerObserver.observe(document.body, { childList: true, subtree: true }), { once: true });
        ensurePipelineViewerButtons();
    }
    startPipelineViewerObserver();


    /* pipeline viewer add variable names */
    if (window.location.href.includes('pipeline_viewer_config.jsp')) {
        const configXML = new DOMParser().parseFromString(document.querySelector("textarea[name='configXML']").textContent, 'text/xml');
        const attrVarToLabelMap = {};
        configXML.querySelectorAll('attribute').forEach(attr => {
            let value = attr.querySelector('value')?.textContent ?? '';
            attrVarToLabelMap[attr.getAttribute('_variableName')] = attr.getAttribute('label');
        });

        //Apply where applicable
        document.querySelectorAll('#tab_attributes td.form-label').forEach(td => {
            let displayName = td.innerText;
            let matches = Object.entries(attrVarToLabelMap).filter(([variableName, label]) => label === displayName);
            if (matches.length === 1) {
                const span = document.createElement("span");
                span.classList.add('cpq-label');
                span.dataset.tmVariableLabel = 'config';
                span.innerText = ` [${matches[0][0]}]`;
                span.style.color = VARIABLE_COLORS.config;
                span.dataset.tmVariableName = matches[0][0];
                span.appendChild(createVariableCopyButton(matches[0][0], 'config'));
                td.appendChild(span);
            }
        });
    }

    /* config attributes: shared by the variable labels and the copy button */
    const MULTI_SELECT_SEPARATOR = '~';
    const LEGACY_MULTI_SELECT_SEPARATOR = '$_tilda_$';
    const ARRAY_SEPARATOR = '$,$';
    const CONFIG_ATTRIBUTE_SELECTORS = {
        single: '.input-form-control[id$="-wrapper"]',
        array: '.cpq-table-column-header-cell[data-key]'
    };

    // Attributes render a `<var>-wrapper` (even when hidden); array set columns carry the variable in data-key.
    function findConfigAttributes(root, pageWindow) {
        const attributeExists = pageWindow.CPQJS?.attributeExists;
        const found = [];
        Object.entries(CONFIG_ATTRIBUTE_SELECTORS).forEach(([kind, selector]) => {
            const elements = new Set(root.querySelectorAll(selector));
            const ancestor = root.closest?.(selector);
            if (ancestor) elements.add(ancestor);
            elements.forEach(element => {
                const name = kind === 'array' ? element.getAttribute('data-key') : element.id.slice(0, -'-wrapper'.length);
                if (!name) return;
                if (typeof attributeExists === 'function' && !attributeExists.call(pageWindow.CPQJS, name)) return;
                found.push({ name, kind, element });
            });
        });
        return found;
    }

    function formatAttributeValue(value) {
        if (value === null || value === undefined) return '';
        if (Array.isArray(value)) return value.map(formatAttributeValue).join(MULTI_SELECT_SEPARATOR);
        return String(value).replaceAll(LEGACY_MULTI_SELECT_SEPARATOR, MULTI_SELECT_SEPARATOR);
    }

    // getAttributeVal(name, row) throws once row is out of range, which marks the end of an array attribute.
    function readConfigAttributeValue(cpqjs, name, kind) {
        if (kind !== 'array') {
            try {
                return formatAttributeValue(cpqjs.getAttributeVal(name));
            } catch { /* array attributes need a row index */ }
        }
        const rows = [];
        for (let row = 0; row < 1000; row++) {
            try {
                rows.push(formatAttributeValue(cpqjs.getAttributeVal(name, row)));
            } catch {
                break;
            }
        }
        return rows.join(ARRAY_SEPARATOR);
    }

    function collectConfigAttributeValues(pageWindow) {
        const cpqjs = pageWindow.CPQJS;
        if (typeof cpqjs?.getAttributeVal !== 'function') throw new Error('CPQJS.getAttributeVal is not available on this page.');
        const data = {};
        for (const { name, kind } of findConfigAttributes(pageWindow.document, pageWindow)) {
            if (!(name in data)) data[name] = readConfigAttributeValue(cpqjs, name, kind);
        }
        return data;
    }

    function showNotice(message, isError = false) {
        const notice = document.createElement('div');
        notice.textContent = message;
        notice.setAttribute('role', isError ? 'alert' : 'status');
        notice.style.cssText = `position:fixed;right:20px;bottom:20px;z-index:2147483647;max-width:420px;padding:10px 14px;border:1px solid ${isError ? '#ff6b6b' : '#8fc9a3'};border-radius:6px;background:#282e3c;color:#e2e4ee;font:14px/1.45 sans-serif;`;
        document.body.append(notice);
        setTimeout(() => notice.remove(), isError ? 7000 : 3000);
    }

    async function copyConfigAttributeJson() {
        try {
            const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const data = await collectConfigAttributeValues(pageWindow);
            const count = Object.keys(data).length;
            if (!count) throw new Error('No attributes found on this page.');

            GM_setClipboard(JSON.stringify(data), 'text');
            showNotice(`Copied ${count} attribute values as JSON.`);
        } catch (error) {
            console.error('Copy attribute values failed:', error);
            showNotice(`Copy attribute values failed: ${error.message}`, true);
        }
    }




    function getAttributeRouteKind(href) {
        if (href.includes('/config/')) return 'config';
        if (['/commerce/transaction', '/container/quotes/quotes-detail'].some(path => href.includes(path))) return 'commerce';
        return null;
    }

    function installAttributeVariableLabels(pageWindow = window) {
        const SETTINGS = {
            storageKey: kind => `attributeVariableLabels_${SITE_NAME}_${kind}${kind === 'commerce' ? '_v2' : ''}`,
            variableFontSize: '12px',
            variablePadding: '0 0 0 4px',
            selectors: {
                configAttribute: '.oj-component-initnode',
                lineColumn: '.cpq-table-column-header-cell',
                commerceInput: 'oj-c-input-text, oj-c-select-single',
                commerceMutationTargets: 'oj-c-input-text, oj-c-select-single, [data-field-name], .oj-flex, .oj-component-initnode, .cpq-table-column-header-cell',
                lineItemsGrid: '#cx-cpq-line-items-data-grid-0',
                lineItemsGridHeader: '.oj-datagrid-column-header-cell'
            }
        };
        const document = pageWindow.document;
        const routeKind = getAttributeRouteKind(pageWindow.location.href);
        const isConfigPage = routeKind === 'config';
        const isCommercePage = routeKind === 'commerce';
        const visibility = {
            config: GM_getValue(SETTINGS.storageKey('config'), true),
            commerce: GM_getValue(SETTINGS.storageKey('commerce'), false)
        };
        const tableColumns = [];
        let gridRetryTimer = null;

        if (!document.body) return () => {};

        function makeVariableLabel(text, kind, id) {
            const label = document.createElement('span');
            label.classList.add('cpq-label');
            label.dataset.tmVariableLabel = kind;
            label.textContent = text;
            label.style.color = VARIABLE_COLORS[kind] || DEFAULT_VARIABLE_COLOR;
            label.style.fontSize = SETTINGS.variableFontSize;
            label.dataset.tmVariableName = text;
            label.appendChild(createVariableCopyButton(text, kind));
            if (id) label.id = id;
            return label;
        }

        function showConfigAttributeVar({ name, kind, element }) {
            if (kind === 'array') {
                showConfigLineAttributeVar(element);
                return;
            }
            if (document.getElementById(`elementId_${name}`)) return;
            const label = element.querySelector(`label[id^="${CSS.escape(name)}-label"]`);
            label?.insertAdjacentElement('afterend', makeVariableLabel(name, 'config', `elementId_${name}`));
        }

        function showConfigLineAttributeVar(element) {
            const dataKey = element.getAttribute('data-key');
            const tableHeader = element.querySelector('.oj-table-column-header');
            const headerText = tableHeader?.querySelector('.cpq-table-column-header-text');
            if (!dataKey || !headerText || tableColumns.indexOf(headerText) !== -1) return;

            tableColumns.push(headerText);
            headerText.appendChild(createVariableCopyButton(dataKey, 'config'));
        }

        function handleConfigMutations(mutations) {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(addedNode => {
                    if (addedNode.nodeType !== pageWindow.Node.ELEMENT_NODE || addedNode.closest('[data-tm-variable-label]')) return;
                    findConfigAttributes(addedNode, pageWindow).forEach(showConfigAttributeVar);
                });
            });
        }

        function showLineAttributeVar(element, isRedwood = false) {
            if (isRedwood) return;
            const dataKey = element.getAttribute('data-key');
            const tableHeader = element.querySelector('.oj-table-column-header');
            const headerText = tableHeader?.querySelector('.cpq-table-column-header-text');
            if (!dataKey || !headerText || tableColumns.indexOf(headerText) !== -1) return;

            tableColumns.push(headerText);
            headerText.appendChild(document.createTextNode('  '));
            headerText.appendChild(makeVariableLabel(dataKey, 'commerce'));
        }

        function showTransactionAttributeVar(element, isRedwood = false) {
            if (isRedwood) {
                pageWindow.setTimeout(() => {
                    if (!visibility.commerce) return;
                    const attributeLabel = element.getElementsByTagName('label');
                    let fieldVarName = element.attributes['data-field-name'];
                    if (element.classList.contains('oj-flex') && attributeLabel.length > 0) {
                        fieldVarName = element.querySelectorAll('*[data-field-name]')[0]?.attributes['data-field-name'];
                    }
                    if (!attributeLabel[0] || !fieldVarName || element.querySelectorAll('span[id^="elementId_"]').length > 0) return;

                    const label = makeVariableLabel(`[${fieldVarName.value}]`, 'commerce', `elementId_${fieldVarName.value}`);
                    label.style.padding = SETTINGS.variablePadding;
                    attributeLabel[0].append(label);
                }, 100);
                return;
            }

            if (element.tagName.toLowerCase().startsWith('oj-') || element.tagName.toLowerCase() === 'input' || (element.id && (element.id.includes('ui-') || element.id.includes('bom-')))) return;
            const variableName = element.id.substring(0, element.id.indexOf('-'));
            element.insertAdjacentElement('afterend', makeVariableLabel(variableName, 'commerce', `elementId_${element.id}`));
        }

        function handleCommerceMutations(mutations) {
            mutations.forEach(mutation => {
                if (mutation.type !== 'childList') return;
                mutation.addedNodes.forEach(rootNode => {
                    if (rootNode.nodeType !== pageWindow.Node.ELEMENT_NODE) return;
                    const addedNodes = [rootNode, ...rootNode.querySelectorAll(SETTINGS.selectors.commerceMutationTargets)];
                    addedNodes.forEach(addedNode => {
                        if (addedNode.localName && SETTINGS.selectors.commerceInput.split(', ').includes(addedNode.localName)) {
                            showTransactionAttributeVar(addedNode, true);
                        }
                        if (!addedNode.classList) return;
                        if (addedNode.attributes['data-field-name'] ||
                            (addedNode.classList.contains('oj-flex') && addedNode.querySelectorAll('label').length > 0)) {
                            showTransactionAttributeVar(addedNode, true);
                        }
                        if (addedNode.classList.contains('oj-component-initnode')) {
                            if (addedNode.id && !document.getElementById(`elementId_${addedNode.id}`)) {
                                showTransactionAttributeVar(addedNode);
                            }
                        } else if (addedNode.classList.contains('cpq-table-column-header-cell')) {
                            showLineAttributeVar(addedNode);
                        }
                    });
                });
            });
            if (visibility.commerce) processLineItemGridColumns();
        }

        function getKnockout() {
            const pageRequire = pageWindow.require || pageWindow.bmdev?.require;
            return pageWindow.ko || pageRequire?.s?.contexts?._?.defined?.knockout ||
                pageWindow.bmdev?.require?.s?.contexts?._?.defined?.knockout || null;
        }

        function normalizeHeader(value) {
            return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
        }

        function processLineItemGridColumns() {
            if (!visibility.commerce) return false;
            const grid = document.querySelector(SETTINGS.selectors.lineItemsGrid);
            const knockout = grid && getKnockout();
            if (!grid || typeof knockout?.dataFor !== 'function') return;

            let columns = null;
            try {
                columns = knockout.dataFor(grid)?.$fragment?.variables?.columnsList;
                if (typeof columns === 'function') columns = columns();
            } catch {
                return;
            }
            if (!Array.isArray(columns) || !columns.length) return;

            const headers = [...grid.querySelectorAll(SETTINGS.selectors.lineItemsGridHeader)];
            if (!headers.length) return;

            let matchedHeader = false;
            columns.forEach(column => {
                const headerText = column?.headerText ?? column?.headerTest;
                const variableName = column?.id;
                const normalizedName = normalizeHeader(headerText);
                if (!normalizedName || variableName === undefined || variableName === null) return;

                const header = headers.find(element => {
                    const text = element.cloneNode(true);
                    text.querySelectorAll('[data-tm-variable-label]').forEach(label => label.remove());
                    return normalizeHeader(text.textContent) === normalizedName;
                });
                if (!header) return;
                matchedHeader = true;
                if ([...header.querySelectorAll('[data-tm-variable-label="commerce"]')]
                    .some(label => label.dataset.tmVariableName === String(variableName))) return;

                const copyButton = createVariableCopyButton(variableName, 'commerce');
                header.appendChild(copyButton);
            });
            return matchedHeader;
        }

        function scheduleGridRetry() {
            if (gridRetryTimer) pageWindow.clearInterval(gridRetryTimer);
            let retryCount = 0;
            gridRetryTimer = pageWindow.setInterval(() => {
                retryCount += 1;
                if (processLineItemGridColumns() || retryCount >= 40) {
                    pageWindow.clearInterval(gridRetryTimer);
                    gridRetryTimer = null;
                }
            }, 250);
        }

        function processExistingElements(kind) {
            if (kind === 'config') {
                findConfigAttributes(document, pageWindow).forEach(showConfigAttributeVar);
            } else {
                document.querySelectorAll(SETTINGS.selectors.commerceInput).forEach(element => showTransactionAttributeVar(element, true));
                document.querySelectorAll('[data-field-name], .oj-flex').forEach(element => {
                    if (element.hasAttribute('data-field-name') || element.querySelectorAll('label').length > 0) {
                        showTransactionAttributeVar(element, true);
                    }
                });
                document.querySelectorAll(`${SETTINGS.selectors.configAttribute}[id]`).forEach(element => {
                    if (element.classList.contains('oj-component-initnode')) showTransactionAttributeVar(element);
                });
                document.querySelectorAll(`${SETTINGS.selectors.lineColumn}[data-key]`).forEach(showLineAttributeVar);
                processLineItemGridColumns();
            }
        }

        function setVisibility(kind, visible) {
            visibility[kind] = visible;
            GM_setValue(SETTINGS.storageKey(kind), visible);
            if (visible) {
                if ((kind === 'config' && isConfigPage) || (kind === 'commerce' && isCommercePage)) processExistingElements(kind);
                if (kind === 'commerce' && isCommercePage) scheduleGridRetry();
                return;
            }
            if (kind === 'commerce' && gridRetryTimer) {
                pageWindow.clearInterval(gridRetryTimer);
                gridRetryTimer = null;
            }
            document.querySelectorAll(`[data-tm-variable-label="${kind}"]`).forEach(label => {
                const spacer = label.previousSibling;
                if (spacer?.nodeType === pageWindow.Node.TEXT_NODE && spacer.textContent === '  ') spacer.remove();
                label.remove();
            });
            if (kind === 'config') tableColumns.length = 0;
        }

        const kind = isConfigPage ? 'config' : isCommercePage ? 'commerce' : null;
        if (kind) {
            const menuCommandId = GM_registerMenuCommand('Toggle attribute variable names', () => setVisibility(kind, !visibility[kind]));
            const handler = isConfigPage ? handleConfigMutations : handleCommerceMutations;
            const observer = new pageWindow.MutationObserver(mutations => {
                if (visibility[kind]) handler(mutations);
            });
            observer.observe(document.body, { childList: true, subtree: true });
            if (visibility[kind]) processExistingElements(kind);
            if (kind === 'commerce' && visibility.commerce) scheduleGridRetry();
            return () => {
                observer.disconnect();
                if (gridRetryTimer) pageWindow.clearInterval(gridRetryTimer);
                GM_unregisterMenuCommand(menuCommandId);
            };
        }

        return () => {};
    }

    // The quotes list opens Quote Detail via history navigation, so re-check the label route without a reload.
    const routeWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    let attributeRouteKind = getAttributeRouteKind(routeWindow.location.href);
    let disposeAttributeLabels = installAttributeVariableLabels(routeWindow);

    function syncAttributeLabelRoute() {
        ensurePipelineViewerButtons();
        const kind = getAttributeRouteKind(routeWindow.location.href);
        if (kind === attributeRouteKind) return;
        attributeRouteKind = kind;
        disposeAttributeLabels();
        disposeAttributeLabels = installAttributeVariableLabels(routeWindow);
    }

    ['pushState', 'replaceState'].forEach(method => {
        const original = routeWindow.history[method];
        routeWindow.history[method] = function (...args) {
            const result = original.apply(this, args);
            syncAttributeLabelRoute();
            return result;
        };
    });
    routeWindow.addEventListener('popstate', syncAttributeLabelRoute);



    /***************************
     * APEX report "Show all" — paginated admin reports (e.g. Manage Transaction
     * Line attributes) fetch 30 rows at a time via an AJAX POST whose paging
     * window travels as plain form fields. Clicking our button triggers the
     * report's own Next action while an XHR hook widens that window to cover
     * every row, so APEX renders/swaps the full set itself.
     ***************************/
    (function setupReportShowAll() {
        const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        let widenNextPaginate = false;

        const originalSend = pageWindow.XMLHttpRequest.prototype.send;
        pageWindow.XMLHttpRequest.prototype.send = function (body) {
            if (widenNextPaginate && typeof body === 'string' && body.includes('p_widget_action=paginate')) {
                widenNextPaginate = false;
                body = body
                    .replace(/p_pg_min_row=\d+/, 'p_pg_min_row=1')
                    .replace(/p_pg_max_rows=\d+/, 'p_pg_max_rows=10000');
            }
            return originalSend.call(this, body);
        };

        function ensureShowAllButtons() {
            document.querySelectorAll('.rw-ReportPagination').forEach(pagination => {
                if (pagination.querySelector('.tm-show-all-rows')) return;
                const counter = pagination.querySelector('.rw-ReportPagination-text');
                const nextLink = pagination.querySelector('a[href*="action$paginate"]');
                if (!counter || !nextLink) return;
                // "row(s) 1 - 30 of 178" — skip when everything is already shown
                const match = /(\d+)\s*-\s*(\d+) of (\d+)/.exec(counter.textContent);
                if (match && Number(match[2]) - Number(match[1]) + 1 >= Number(match[3])) return;

                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'tm-show-all-rows rw-Button rw-Button--sm rw-Button--borderless';
                button.textContent = match ? `Show all ${match[3]}` : 'Show all';
                button.style.cssText = 'margin-left:8px;cursor:pointer;';
                button.addEventListener('click', () => {
                    widenNextPaginate = true;
                    nextLink.click();
                });
                counter.after(button);
            });
        }

        const observer = new MutationObserver(ensureShowAllButtons);
        const startObserver = () => {
            observer.observe(document.body, { childList: true, subtree: true });
            ensureShowAllButtons();
        };
        if (document.body) startObserver();
        else document.addEventListener('DOMContentLoaded', startObserver, { once: true });
    })();

    /***************************
     * Session keep-alive — re-fetches the current page in the background every
     * few minutes so the session (APEX on ords pages, JSP on /cpq pages) stays
     * warm while you're actually working. Gated on recent activity/visibility
     * so an abandoned machine still times out, and coordinated across tabs via
     * localStorage so only one tab pings per interval.
     ***************************/
    (function setupSessionKeepAlive() {
        const ENABLED_KEY = 'keepAliveEnabled';
        const LAST_PING_KEY = 'tmKeepAliveLastPing'; // shared across tabs on this origin
        const PING_INTERVAL_MS = 4 * 60 * 1000;
        const IDLE_LIMIT_MS = 30 * 60 * 1000;
        let enabled = GM_getValue(ENABLED_KEY, true);
        let lastActivity = Date.now();
        let menuId = null;

        ['pointerdown', 'keydown', 'mousemove', 'scroll'].forEach(type =>
            window.addEventListener(type, () => { lastActivity = Date.now(); }, { passive: true, capture: true })
        );

        function registerMenu() {
            if (menuId !== null) GM_unregisterMenuCommand(menuId);
            menuId = GM_registerMenuCommand(`Session keep-alive: ${enabled ? 'ON' : 'OFF'} (toggle)`, () => {
                enabled = !enabled;
                GM_setValue(ENABLED_KEY, enabled);
                registerMenu();
            });
        }
        registerMenu();

        async function ping() {
            if (!enabled) return;
            // Let the session expire naturally if the user walked away
            const active = document.visibilityState === 'visible' || Date.now() - lastActivity < IDLE_LIMIT_MS;
            if (!active) return;
            // Another tab may have pinged already this interval
            const lastPing = Number(localStorage.getItem(LAST_PING_KEY) || 0);
            if (Date.now() - lastPing < PING_INTERVAL_MS - 5000) return;
            localStorage.setItem(LAST_PING_KEY, String(Date.now()));
            try {
                await fetch(window.location.href, { credentials: 'same-origin', cache: 'no-store' });
            } catch (error) {
                console.warn('Session keep-alive ping failed:', error.message);
            }
        }

        setInterval(ping, 60 * 1000);
    })();

    /***************************
     * Rule variable-name harvest — the rule editor page doesn't expose the
     * rule's variable name, only the rules list does. Harvest ruleId → varName
     * pairs from any page that renders edit-rule-config links alongside a
     * variable-name column, so the BML quick edit links can carry the rule var
     * (as a tmRuleVar param on the un-checksummed bml-edit URL).
     ***************************/
    const RULE_VARS_KEY = 'tmRuleVars';
    const RULE_VARS_MAX = 2000;

    function getStoredRuleVars() {
        try {
            const stored = JSON.parse(localStorage.getItem(RULE_VARS_KEY) || '{}');
            return stored && typeof stored === 'object' ? stored : {};
        } catch {
            return {};
        }
    }

    // Entries are { v: varName, t: lastSeen }; earlier versions stored bare strings
    function getRuleVar(ruleId) {
        const entry = getStoredRuleVars()[ruleId];
        return typeof entry === 'string' ? entry : entry?.v;
    }

    (function setupRuleVarHarvest() {
        function harvest() {
            const links = document.querySelectorAll('a[href*="edit-rule-config"]');
            if (!links.length) return;
            const ruleVars = getStoredRuleVars();
            let changed = false;
            links.forEach(link => {
                const ruleId = /p22_id=(\d+)/.exec(link.href)?.[1];
                if (!ruleId) return;
                const row = link.closest('tr');
                const varName = row?.querySelector('.variable-column, [headers*="VARIABLE_NAME"]')?.textContent.trim();
                if (!varName) return;
                const existing = ruleVars[ruleId];
                if ((typeof existing === 'string' ? existing : existing?.v) !== varName) {
                    ruleVars[ruleId] = { v: varName, t: Date.now() };
                    changed = true;
                }
            });
            if (!changed) return;
            // Bound the map: rule ids are numeric keys (so object order is numeric,
            // not insertion) — trim by last-seen timestamp instead.
            const entries = Object.entries(ruleVars);
            if (entries.length > RULE_VARS_MAX) {
                entries
                    .sort((a, b) => (typeof a[1] === 'string' ? 0 : a[1].t) - (typeof b[1] === 'string' ? 0 : b[1].t))
                    .slice(0, entries.length - RULE_VARS_MAX)
                    .forEach(([key]) => delete ruleVars[key]);
            }
            localStorage.setItem(RULE_VARS_KEY, JSON.stringify(ruleVars));
        }
        const observer = new MutationObserver(harvest);
        const start = () => {
            observer.observe(document.body, { childList: true, subtree: true });
            harvest();
        };
        if (document.body) start();
        else document.addEventListener('DOMContentLoaded', start, { once: true });
    })();

    /***************************
     * Config rule "BML quick edit" — on edit-rule-config pages, the rule's
     * action attributes and their family/line/model paths sit in APEX page
     * items, and the Redwood BML editor is addressable with plain query params
     * (no checksum). Attach an inline link to each attribute in the
     * recommendation-action list that has an Advanced (script) value, opening
     * its action BML in a new tab — skipping the checksummed intermediate page
     * and the expensive rule-page reload on the way back.
     ***************************/
    (function setupBmlQuickEdit() {
        if (!window.location.pathname.includes('edit-rule-config')) return;

        // apex may not exist at script start; resolve lazily from the page window
        const getApex = () => (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window).apex;

        const itemValue = (name) => {
            try { return getApex().item(name).getValue(); } catch { return ''; }
        };

        function getScriptedActions() {
            if (typeof getApex()?.item !== 'function') return null;
            const actionsRaw = itemValue('P22_THENACTIONS');
            const pathsRaw = itemValue('P22_PATH_ATTRIBUTES_MAP');
            const attributesRaw = itemValue('P22_ATTRIBUTES_MAP');
            const ruleTypeCode = itemValue('P22_RULE_TYPE') || itemValue('P22_RULE_TYPE_CREATE');
            if (!actionsRaw || !pathsRaw || !ruleTypeCode) return null;
            let actions, paths, attributes;
            try {
                actions = JSON.parse(actionsRaw);
                paths = JSON.parse(pathsRaw);
                attributes = attributesRaw ? JSON.parse(attributesRaw) : {};
            } catch {
                return null;
            }
            if (!Array.isArray(actions)) return null;

            // Path keys look like "root:family:line:model:varName"
            const pathByVar = {};
            Object.keys(paths).forEach(key => {
                const parts = key.split(':');
                if (parts.length >= 5) pathByVar[parts[4]] = { family: parts[1], line: parts[2], model: parts[3] };
            });

            return actions
                // only attributes whose value is an Advanced function (a script exists)
                .filter(action => action.value?.valueType === 'Advanced' && action.value?.function)
                .map(action => ({
                    varName: action.attribute,
                    label: attributes[action.attribute_id]?.label || '',
                    path: pathByVar[action.attribute],
                    ruleTypeCode
                }))
                .filter(({ varName, path }) => varName && path);
        }

        function bmlEditUrl({ varName, path, ruleTypeCode }) {
            const params = new URLSearchParams({
                attributeName: varName,
                functionType: 'CONFIG_RULE_ACTION',
                mode: 'edit',
                productFamily: path.family,
                productLine: path.line,
                model: path.model,
                ruleTypeCode,
                type: 'config'
            });
            // The rule's variable name (harvested from the rules list) lets the
            // Open-in-VSCode envelope build the full BigTools folder path.
            const ruleVar = getRuleVar(itemValue('P22_ID'));
            if (ruleVar) params.set('tmRuleVar', ruleVar);
            return '/fscmUI/redwood/cx-cpq/application/container/bml/bml-edit?' + params;
        }

        // The action list renders client-side; anchor on the row that names the
        // attribute (data-varname when present, label text otherwise).
        function findAttributeAnchor(varName, label) {
            const byVar = document.querySelector(`[data-varname="${CSS.escape(varName)}"]`);
            if (byVar) return byVar;
            const texts = [varName, label].filter(Boolean);
            const candidates = [...document.querySelectorAll('span, a, td, div')]
                .filter(el => el.childElementCount === 0 && texts.includes(el.textContent.trim()));
            return candidates[0] || null;
        }

        function ensureQuickEditLinks() {
            const scripted = getScriptedActions();
            if (!scripted?.length) return;
            scripted.forEach(entry => {
                const id = `tm-bml-qe-${entry.varName}`;
                if (document.getElementById(id)) return;
                const anchor = findAttributeAnchor(entry.varName, entry.label);
                if (!anchor) return;
                const link = document.createElement('a');
                link.id = id;
                link.href = bmlEditUrl(entry);
                link.target = '_blank';
                link.textContent = '⧉ BML';
                link.title = `Open the action BML for ${entry.varName} in a new tab`;
                link.style.cssText = 'margin-left:8px;padding:1px 8px;font-size:11px;font-weight:600;' +
                    'color:#8b95d6;border:1px solid #8b95d6;border-radius:999px;text-decoration:none;' +
                    'white-space:nowrap;vertical-align:middle;';
                link.addEventListener('click', event => event.stopPropagation());
                anchor.after(link);
            });
        }

        const observer = new MutationObserver(ensureQuickEditLinks);
        const start = () => {
            observer.observe(document.body, { childList: true, subtree: true });
            ensureQuickEditLinks();
        };
        if (document.body) start();
        else document.addEventListener('DOMContentLoaded', start, { once: true });
    })();

    /***************************
     * Variable-name copy — on attribute list reports (commerce
     * quote-detail-transaction(-line) and config-detail-attributes alike), the
     * "Variable Name" column renders as td[headers=VARIABLE_NAME]. Add a small
     * hover-visible copy button to each cell.
     ***************************/
    (function setupVarNameCopy() {
        GM_addStyle(`
            .tm-varcopy {
                margin-right: 4px;
                padding: 0 2px;
                background: none;
                border: none;
                color: #8b95d6;
                font-size: 16px;
                line-height: 1;
                cursor: pointer;
                opacity: 0;
                vertical-align: middle;
            }
            td:hover > .tm-varcopy, .tm-varcopy:focus-visible { opacity: 1; }
            .tm-varcopy:hover { color: #5b68c0; }
        `);

        function ensureCopyButtons() {
            document.querySelectorAll('td.rw-Report-cell[headers*="VARIABLE_NAME"]').forEach(cell => {
                if (cell.querySelector('.tm-varcopy')) return;
                const varName = (cell.querySelector('.variable-column')?.title ||
                    cell.textContent).trim();
                if (!varName) return;
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'tm-varcopy';
                button.textContent = '⎘';
                button.title = `Copy ${varName}`;
                button.addEventListener('click', event => {
                    event.stopPropagation();
                    GM_setClipboard(varName);
                    button.textContent = '✓';
                    setTimeout(() => { button.textContent = '⎘'; }, 1200);
                });
                // Lead the cell with the button: the cell clips overflow, so a
                // trailing button would be the first thing cut off.
                cell.prepend(button);
            });
        }

        const observer = new MutationObserver(ensureCopyButtons);
        const start = () => {
            observer.observe(document.body, { childList: true, subtree: true });
            ensureCopyButtons();
        };
        if (document.body) start();
        else document.addEventListener('DOMContentLoaded', start, { once: true });
    })();

    /***************************
     * Menu definition import/export — on attribute edit pages, the static menu
     * ("Menu Definition") is a JET oj-table ([id$="seledit-table"]) bound to
     * knockout rows {displayedText, variableName}; persistence runs through
     * updateCLOB on input blur. Copy List serializes the current options as
     * one-per-line "display|variable" (pipe omitted when they match); Import
     * List adds options from the same format by driving the page's own
     * Add Entry button + inputs so the normal save path fires.
     ***************************/
    setupMenuListTools();
    function setupMenuListTools() {
        const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const pageDoc = pageWindow.document;

        GM_addStyle(`
            .tm-menulist-btn {
                margin-right: 8px;
                padding: 4px 10px;
                font-size: 12px;
                font-weight: 600;
                color: #8b95d6;
                background: transparent;
                border: 1px solid #8b95d6;
                border-radius: 4px;
                cursor: pointer;
                white-space: nowrap;
            }
            .tm-menulist-btn:hover { color: #5b68c0; border-color: #5b68c0; }
            #tm-menulist-panel {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                z-index: 2147483646;
                width: 420px;
                padding: 14px;
                background: #fff;
                border: 1px solid #b6bdd1;
                border-radius: 8px;
                box-shadow: 0 8px 30px rgba(0,0,0,0.3);
                font-size: 13px;
            }
            #tm-menulist-panel textarea {
                box-sizing: border-box;
                width: 100%;
                height: 200px;
                margin: 8px 0;
                font-family: monospace;
                font-size: 12px;
            }
            #tm-menulist-status { color: #5b68c0; min-height: 1.2em; }
        `);

        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

        async function waitUntil(check, timeout = 4000, interval = 50) {
            const end = Date.now() + timeout;
            while (Date.now() < end) {
                const result = check();
                if (result) return result;
                await sleep(interval);
            }
            return null;
        }

        // Edit pages use p##-seledit-table / p##-edit-add-menu-item; the
        // create-attribute page uses p##-table / p##-add-menu-item.
        const getMenuTable = () => pageDoc.querySelector(
            'oj-table[aria-label="Menu Definition"], oj-table[id$="seledit-table"]');
        const getAddEntryButton = () => pageDoc.querySelector(
            'oj-button[id$="add-menu-item"] button');

        async function readMenuRows() {
            const table = getMenuTable();
            if (!table?.data) throw new Error('Menu table data is not ready.');
            const rows = [];
            const iterator = table.data.fetchFirst({ size: -1 })[Symbol.asyncIterator]();
            for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
                next.value.data.forEach(data => rows.push(data));
            }
            return rows;
        }

        // Row fields may be plain strings, knockout observables (functions), or
        // wrapper objects depending on how the page built its data provider.
        function unwrapCell(value, depth = 0) {
            if (value === null || value === undefined || depth > 4) return '';
            if (typeof value === 'function') return unwrapCell(value(), depth + 1);
            if (typeof value === 'object') {
                for (const key of ['value', 'displayedText', 'variableName', 'text', 'label']) {
                    if (key in value) return unwrapCell(value[key], depth + 1);
                }
                return '';
            }
            return String(value);
        }

        function serializeRows(rows) {
            if (rows.length) console.debug('[tm-menulist] row sample:', rows[0]);
            return rows.map(row => {
                const data = typeof row === 'object' && row !== null && 'data' in row ? row.data : row;
                const display = unwrapCell(data?.displayedText ?? data).trim();
                const variable = unwrapCell(data?.variableName).trim();
                return variable && variable !== display ? `${display}|${variable}` : display;
            }).join('\n');
        }

        function parseList(text) {
            return text.split(/\r?\n/)
                .map(line => line.trim())
                .filter(Boolean)
                .map(line => {
                    const pipe = line.indexOf('|');
                    if (pipe === -1) return { display: line, variable: line };
                    return {
                        display: line.slice(0, pipe).trim(),
                        variable: line.slice(pipe + 1).trim() || line.slice(0, pipe).trim()
                    };
                });
        }

        // Mimic typing so JET syncs the knockout row and updateCLOB runs on blur
        function setJetInput(ojInput, value) {
            const input = ojInput.querySelector('input');
            if (!input) throw new Error('Menu row input not found.');
            input.focus();
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.blur();
            input.dispatchEvent(new FocusEvent('blur'));
            ojInput.dispatchEvent(new FocusEvent('blur'));
        }

        function menuRows(table) {
            return [...table.querySelectorAll('tbody.oj-table-body tr')].map(row => {
                const inputs = [...row.querySelectorAll('oj-input-text')];
                const trash = [...row.querySelectorAll('oj-button')]
                    .find(button => button.querySelector('.oj-ux-ico-trash'));
                const deleteButton = trash && !trash.classList.contains('oj-disabled')
                    ? trash.querySelector('button:not([disabled])') : null;
                return inputs.length >= 2 ? { inputs, deleteButton } : null;
            }).filter(Boolean);
        }

        // The page persists only via updateCLOB, which is bound to input blur —
        // deleteAction just edits the knockout array. So never empty the table
        // (a rerender would restore rows from the stale CLOB): overwrite rows
        // in place, add extras, trim surplus last, then blur once more so the
        // deletions reach the CLOB too.
        async function importOptions(entries, statusEl) {
            const table = getMenuTable();
            const addButton = getAddEntryButton();
            if (!table || !addButton) throw new Error('Menu definition editor not found on this page.');
            const editable = () => menuRows(table).filter(row => row.deleteButton);

            async function fillRow(row, entry) {
                setJetInput(row.inputs[0], entry.display);
                // Let setVariableName's auto-fill settle before overriding it
                await sleep(80);
                setJetInput(row.inputs[1], entry.variable);
                await sleep(60);
            }

            // 0) Retire the old variable names first: overwriting in place can
            //    otherwise trip duplicate-variable validation when a new name
            //    matches a not-yet-overwritten old row. Unique temp names make
            //    the old set collision-free before the real values go in.
            const preexisting = editable();
            if (preexisting.length && entries.length) {
                const stamp = Date.now().toString(36);
                for (let index = 0; index < preexisting.length; index++) {
                    statusEl.textContent = `Preparing existing options… (${preexisting.length - index})`;
                    setJetInput(preexisting[index].inputs[1], `tm_tmp_${stamp}_${index}`);
                    await sleep(40);
                }
            }

            // 1) Overwrite existing editable rows in place
            const existing = editable();
            const overwriteCount = Math.min(existing.length, entries.length);
            for (let index = 0; index < overwriteCount; index++) {
                statusEl.textContent = `Updating ${index + 1} of ${entries.length}: ${entries[index].display}`;
                await fillRow(existing[index], entries[index]);
            }

            // 2) Add rows for the remaining entries
            for (let index = overwriteCount; index < entries.length; index++) {
                const entry = entries[index];
                statusEl.textContent = `Adding ${index + 1} of ${entries.length}: ${entry.display}`;
                const before = menuRows(table).length;
                addButton.click();
                const appeared = await waitUntil(() => menuRows(table).length > before);
                if (!appeared) throw new Error(`Row did not appear for "${entry.display}".`);
                const rows = editable();
                await fillRow(rows[rows.length - 1], entry);
            }

            // Deletes alone never reach the CLOB (updateCLOB is blur-bound), so
            // a rerender mid-trim would restore them. Persist after every
            // delete by re-bluring a surviving input with its unchanged value.
            function nudgePersist() {
                const survivor = editable()[0];
                if (!survivor) return;
                const input = survivor.inputs[1].querySelector('input');
                input?.focus();
                input?.blur();
                input?.dispatchEvent(new FocusEvent('blur'));
                survivor.inputs[1].dispatchEvent(new FocusEvent('blur'));
            }

            // 3) Trim surplus rows from the end, persisting each removal
            while (editable().length > entries.length) {
                const rows = editable();
                statusEl.textContent = `Removing surplus options… (${rows.length - entries.length} left)`;
                const before = menuRows(table).length;
                rows[rows.length - 1].deleteButton.click();
                const removed = await waitUntil(() => menuRows(table).length < before);
                if (!removed) throw new Error('Could not remove a surplus option.');
                nudgePersist();
                await sleep(150);
            }
            statusEl.textContent = `List replaced with ${entries.length} option${entries.length === 1 ? '' : 's'}.`;
        }

        function openImportPanel() {
            document.getElementById('tm-menulist-panel')?.remove();
            const panel = document.createElement('div');
            panel.id = 'tm-menulist-panel';
            panel.innerHTML = `
                <strong>Import menu options</strong>
                <div>One per line — <code>Display</code> or <code>Display|variableName</code></div>
                <div><em>Replaces the current options (use Copy List first to keep a backup).</em></div>
                <textarea spellcheck="false" placeholder="Opt1\nOpt2\nOpt4|Option4"></textarea>
                <div id="tm-menulist-status"></div>
                <button type="button" class="tm-menulist-btn" data-action="import">Replace options</button>
                <button type="button" class="tm-menulist-btn" data-action="close">Close</button>
            `;
            const statusEl = panel.querySelector('#tm-menulist-status');
            panel.querySelector('[data-action="close"]').addEventListener('click', () => panel.remove());
            panel.querySelector('[data-action="import"]').addEventListener('click', async (event) => {
                const entries = parseList(panel.querySelector('textarea').value);
                if (!entries.length) {
                    statusEl.textContent = 'Nothing to import.';
                    return;
                }
                event.target.disabled = true;
                try {
                    await importOptions(entries, statusEl);
                } catch (error) {
                    statusEl.textContent = `Import failed: ${error.message}`;
                } finally {
                    event.target.disabled = false;
                }
            });
            document.body.appendChild(panel);
            panel.querySelector('textarea').focus();
        }

        function ensureMenuListButtons() {
            if (document.getElementById('tm-menulist-copy')) return;
            const addButton = getAddEntryButton();
            const toolbar = addButton?.closest('oj-button')?.parentElement;
            if (!toolbar || !getMenuTable()) return;

            const copyButton = document.createElement('button');
            copyButton.type = 'button';
            copyButton.id = 'tm-menulist-copy';
            copyButton.className = 'tm-menulist-btn';
            copyButton.textContent = '⎘ Copy List';
            copyButton.title = 'Copy menu options as Display|variableName lines';
            copyButton.addEventListener('click', async () => {
                try {
                    GM_setClipboard(serializeRows(await readMenuRows()));
                    copyButton.textContent = '✓ Copied';
                } catch (error) {
                    copyButton.textContent = '✗ Failed';
                    console.error('[tm-menulist] copy failed:', error);
                }
                setTimeout(() => { copyButton.textContent = '⎘ Copy List'; }, 1500);
            });

            const importButton = document.createElement('button');
            importButton.type = 'button';
            importButton.id = 'tm-menulist-import';
            importButton.className = 'tm-menulist-btn';
            importButton.textContent = '⇪ Import List';
            importButton.title = 'Add menu options from a pasted list';
            importButton.addEventListener('click', openImportPanel);

            toolbar.prepend(copyButton, importButton);
        }

        const observer = new MutationObserver(ensureMenuListButtons);
        const start = () => {
            observer.observe(document.body, { childList: true, subtree: true });
            ensureMenuListButtons();
        };
        if (document.body) start();
        else document.addEventListener('DOMContentLoaded', start, { once: true });
    }

    /******* HELPERS */
    function waitForElement(selector) {
        return new Promise(resolve => {
            const existing = document.querySelector(selector);
            if (existing) return resolve(existing);
            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    observer.disconnect();
                    resolve(element);
                }
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
        });
    }


    // Favicon and site icon customization styles
    GM_addStyle(`
        #tm-icon-picker {
            position: fixed;
            top: 16px;
            right: 56px;
            z-index: 999998;
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px;
            background: #242424;
            color: #e2e4ee;
            border: 1px solid #505c7c;
            border-radius: 8px;
            box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
            font: 14px 'Nunito', 'Segoe UI', system-ui, sans-serif;
        }
        #tm-icon-picker[hidden] { display: none; }
        #tm-icon-picker img { width: 64px; height: 64px; }
        #tm-icon-picker .tm-icon-fields { display: grid; gap: 6px; }
        #tm-icon-picker label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
        #tm-icon-picker input[type="color"] { width: 28px; height: 22px; padding: 0; border: none; background: none; cursor: pointer; }
        #tm-icon-picker .tm-picker-section { padding: 10px 0; }
        #tm-icon-picker .tm-picker-heading {
            margin-bottom: 8px;
            color: #a5adcb;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
        }
        #tm-icon-picker .tm-favicon-section { border-bottom: 1px solid #505c7c; }
        #tm-icon-picker .tm-favicon-controls { display: flex; align-items: center; gap: 12px; }
        #tm-icon-picker .tm-variable-section { border-bottom: 1px solid #505c7c; }
        #tm-icon-picker .tm-variable-controls { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        #tm-icon-picker button {
            justify-self: start;
            padding: 2px 8px;
            font: inherit;
            font-size: 12px;
            color: #8b95d6;
            background: transparent;
            border: 1px solid #8b95d6;
            border-radius: 999px;
            cursor: pointer;
        }
        #tm-icon-picker button:hover { color: #fdff00; border-color: #fdff00; }
        #tm-icon-picker .tm-icon-actions { display: flex; flex-wrap: wrap; gap: 4px; }
        #tm-icon-picker .tm-variable-controls [data-action="reset-variable-colors"] { grid-column: 1 / -1; }
        #tm-icon-picker .tm-icon-apply { color: #1d2130; background: #8b95d6; }
        #tm-icon-picker .tm-icon-apply:hover { color: #1d2130; background: #fdff00; }
    `);

    GM_registerMenuCommand('🎨 Customize Icon & Variable Display', () => {
        if (picker.hidden) openPicker(); else picker.hidden = true;
    });

})();
