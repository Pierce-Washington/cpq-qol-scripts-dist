// ==UserScript==
// @name         BML Config Editor Copy/Paste
// @namespace    http://tampermonkey.net
// @version      1.0
// @description  Improvements for BML Editor Pages
// @author       Sven Hansen (PW)
// @match        https://*.oraclegovcloud2.com/*/bml/bml-edit?*
// @match        https://*.bigmachines.com/*/bml/bml-edit?*
// @match        https://*.oraclegovcloud2.com/*/application/container/bml*
// @match        https://*.bigmachines.com/*/application/container/bml*
// @match        https://*.oraclegovcloud2.com/*/configuration/pipeline_viewer_config.jsp*
// @match        https://*.bigmachines.com/*/configuration/pipeline_viewer_config.jsp*
// @grant        unsafeWindow
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    // These identify the function editor section for the tester Attributes tables.
    const TABLE_ID = 'cx-cpq-bml-validator-function-inputs-table';
    const EDITOR_SELECTOR = 'oj-c-input-text, oj-c-select-single, oj-c-select-multiple';
    const PROPERTIES_BUTTON = 'button[aria-label="Function Editor Properties"]';
    const ARRAY_POPUP_ID = 'cx-cpq-bml-config-array-value-popup';
    const ARRAY_TABLE_ID = 'cx-cpq-bml-config-array-value-inputs-table';
    const ARRAY_SEPARATOR = '$,$';
    const MULTI_SELECT_SEPARATOR = '$_tilda_$';
    const TESTER_DOM = {
        tabBar: 'oj-c-tab-bar',
        testerTabData: 'scriptTesterTabs',
        parametersTab: '[data-oj-key="testerParameters"][role="tab"]',
        switcher: 'oj-switcher',
        attributesTab: '[data-oj-key="testerConfigAttributes"][role="tab"]',
        utilityAttributesTab: '[data-oj-key="testerUtilAttributes"][role="tab"]',
        systemAttributesTab: '[data-oj-key="testerSystemConfigurationAttributes"][role="tab"]',
        configAttributesTable: 'cx-cpq-bml-validator-function-inputs-table',
        utilityAttributesTable: 'cx-cpq-bml-tester-util-attributes-table',
        systemAttributesTable: 'cx-cpq-bml-validator-system-configuration-attributes-table',
        runButton: 'button[aria-label="Run"]',
        importButton: 'button[aria-label="Import"]',
        flexItem: 'oj-flex-item, [class*="oj-flex-item"]',
        printDataId: 'cx-cpq-bml-print-data-output',
        printDataClass: '.oj-fa-cx-cpq-bml-print-data-output',
        printDataSection: 'div.oj-sm-padding-2x-vertical'
    };
    // JET component properties (columns, data, editRow, value) live on page-world elements
    const doc = unsafeWindow.document;

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    async function waitFor(check, timeout = 5000, interval = 50) {
        const end = Date.now() + timeout;
        while (Date.now() < end) {
            const result = check();
            if (result) return result;
            await sleep(interval);
        }
        return null;
    }

    function isElementVisible(element) {
        if (!element?.isConnected || !element.getClientRects().length) return false;
        const style = unsafeWindow.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
    }

    function findTesterTabBar() {
        return [...doc.querySelectorAll(TESTER_DOM.tabBar)].find(element =>
            element.getAttribute('data')?.includes(TESTER_DOM.testerTabData)
        ) || doc.querySelector(TESTER_DOM.parametersTab)?.closest(TESTER_DOM.tabBar);
    }

    async function openPropertiesDrawer() {
        const findOpenTabBar = () => {
            const tabBar = findTesterTabBar();
            return isElementVisible(tabBar) ? tabBar : null;
        };
        const existingTabBar = findOpenTabBar();
        if (existingTabBar) return existingTabBar;
        const button = doc.querySelector(PROPERTIES_BUTTON);
        if (!button) return null;
        button.click();
        return await waitFor(findOpenTabBar, 10000);
    }

    async function openAttributesTab() {
        return openAttributeTable({ tabSelector: TESTER_DOM.attributesTab, tableId: TABLE_ID });
    }

    async function openAttributeTable({ tabSelector, tableId }) {
        const tabBar = await openPropertiesDrawer();
        if (!tabBar) return null;
        const tab = tabBar.querySelector(tabSelector);
        if (!tab) return null;
        const getVisibleTable = () => {
            const tables = [...doc.querySelectorAll('oj-table')];
            return tables.find(el => {
                const panel = el.closest('[role="tabpanel"]');
                return el.id === tableId && isElementVisible(panel) && isElementVisible(el) && el.columns;
            }) || null;
        };
        tab.click();
        return await waitFor(getVisibleTable, 10000);
    }

    async function readRows(table) {
        const rows = [];
        const iterator = table.data.fetchFirst({ size: -1 })[Symbol.asyncIterator]();
        for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
            next.value.data.forEach((data, index) => rows.push({ key: next.value.metadata[index].key, data }));
        }
        return rows;
    }

    function editorValue(editor, value) {
        if (editor.localName === 'oj-c-select-multiple') return Array.isArray(value) ? value : [value];
        if (value !== null && typeof value === 'object') return JSON.stringify(value);
        return value === null || value === undefined ? '' : String(value);
    }

    // Copied menu values look like "Display Label [value_var_name]"
    function parseMenuValue(raw) {
        const match = /^([\s\S]*?)\s*\[([\s\S]*)\]$/.exec(raw);
        return match ? { label: match[1].trim(), key: match[2].trim() } : { label: raw.trim(), key: raw.trim() };
    }

    async function readOptions(dataProvider) {
        const options = [];
        if (!dataProvider) return options;
        const iterator = dataProvider.fetchFirst({ size: -1 })[Symbol.asyncIterator]();
        for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
            next.value.data.forEach((data, index) => options.push({ key: next.value.metadata[index].key, text: data.itemText }));
        }
        return options;
    }

    async function resolveOption(options, raw) {
        const { label, key } = parseMenuValue(String(raw ?? ''));
        if (!key && !label) return null;
        const option = options.find(o => String(o.key) === key) ||
            options.find(o => String(o.key) === raw) ||
            options.find(o => o.text === label);
        if (!option) throw new Error(`"${raw}" is not a valid menu option`);
        return option.key;
    }

    // Core Pack list items react to pointer/mouse events rather than a bare click()
    function pressElement(el) {
        const opts = { bubbles: true, cancelable: true, composed: true };
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
    }

    // Programmatic value changes don't reach the edit row, so toggle the dropdown checkboxes instead
    async function selectMultipleViaDropdown(editor, value) {
        const input = editor.querySelector('input[role="combobox"]');
        const dropdownId = input?.getAttribute('aria-controls');
        if (!dropdownId) throw new Error('multi-select input not found');
        const listbox = () => doc.getElementById(dropdownId)?.querySelector('[role="listbox"]');

        input.focus();
        pressElement(input);
        if (!await waitFor(listbox, 1000)) {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
        }
        if (!await waitFor(listbox)) throw new Error('multi-select dropdown did not open');

        const renderedOptions = () => [...listbox().querySelectorAll('[data-oj-key]')].map(item => ({
            key: item.getAttribute('data-oj-key'),
            text: item.textContent.trim(),
            item,
            option: item.querySelector('[role="option"]') || item
        }));

        const options = await waitFor(() => {
            const rendered = renderedOptions();
            return rendered.length ? rendered : null;
        });
        if (!options) throw new Error('multi-select options did not render');
        const raws = Array.isArray(value) ? value : splitMenuValues(String(value ?? ''), MULTI_SELECT_SEPARATOR);
        const wanted = new Set((await Promise.all(raws.map(raw => resolveOption(options, raw)))).filter(key => key !== null));

        for (const { key, item, option } of options) {
            const isSelected = () => option.getAttribute('aria-selected') === 'true' ||
                item.querySelector('input[type="checkbox"]')?.getAttribute('aria-checked') === 'true';
            if (isSelected() === wanted.has(key)) continue;
            item.click();
            if (!await waitFor(() => isSelected() === wanted.has(key), 2000)) {
                throw new Error(`could not ${wanted.has(key) ? 'select' : 'deselect'} "${key}"`);
            }
        }

        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        await waitFor(() => !listbox(), 1000);
    }

    async function setEditorValue(editor, value) {
        if (editor.localName === 'oj-c-select-single') {
            editor.value = await resolveOption(await readOptions(editor.data), value);
        } else if (editor.localName === 'oj-c-select-multiple') {
            await selectMultipleViaDropdown(editor, value);
        } else {
            editor.value = editorValue(editor, value);
        }
    }

    // Values may be copied as "A<sep>B [a<sep>b]" or as "A [a]<sep>B [b]"
    function splitMenuValues(raw, separator) {
        if (!raw) return [];
        const match = /^([\s\S]*?)\s*\[([\s\S]*)\]$/.exec(raw);
        if (match && match[2].includes(separator)) {
            const labels = match[1].split(separator);
            return match[2].split(separator).map((key, i) => `${labels[i] ?? ''} [${key}]`);
        }
        return raw.split(separator);
    }

    // Clicks the native control rendered inside a JET button/link so its oj-action fires
    const activate = (component) => (component.querySelector('button, a') || component).click();

    async function fillArrayValues(link, value) {
        const items = (Array.isArray(value) ? value.map(String)
            : value === null || value === undefined ? [] : splitMenuValues(String(value), ARRAY_SEPARATOR))
            .filter(item => { const { label, key } = parseMenuValue(item); return label || key; });

        activate(link);
        const popup = await waitFor(() => {
            const el = doc.getElementById(ARRAY_POPUP_ID);
            return el?.isOpen?.() && doc.getElementById(ARRAY_TABLE_ID) ? el : null;
        });
        if (!popup) throw new Error('array value popup did not open');
        const arrayTable = doc.getElementById(ARRAY_TABLE_ID);
        const rowCount = () => arrayTable.querySelectorAll('tbody tr.oj-table-body-row').length;

        for (let trash = arrayTable.querySelector('.oj-ux-ico-trash'); trash; trash = arrayTable.querySelector('.oj-ux-ico-trash')) {
            const before = rowCount();
            activate(trash.closest('oj-c-button'));
            if (!await waitFor(() => rowCount() < before)) throw new Error('could not clear existing array values');
        }

        for (const item of items) {
            const input = await waitFor(() => arrayTable.querySelector('.oj-fa-cx-cpq-bml-table-add-row-cell'));
            const submit = arrayTable.querySelector('.oj-table-add-row-placeholder oj-c-button');
            if (!input || !submit) throw new Error('array add row not available');
            const before = rowCount();
            await setEditorValue(input, item);
            await sleep(50);
            activate(submit);
            if (!await waitFor(() => rowCount() > before)) throw new Error(`could not add array value "${item}"`);
        }

        popup.close();
        await waitFor(() => !popup.isOpen());
    }

    const ATTRIBUTE_TABLES = [
        { tabSelector: TESTER_DOM.attributesTab, tableId: TESTER_DOM.configAttributesTable },
        { tabSelector: TESTER_DOM.utilityAttributesTab, tableId: TESTER_DOM.utilityAttributesTable },
        { tabSelector: TESTER_DOM.systemAttributesTab, tableId: TESTER_DOM.systemAttributesTable }
    ];

    function rowHasAttributeName(data, name, nameColumn) {
        if (typeof data === 'string') return data === name;
        if (!data || typeof data !== 'object') return false;
        const fieldValue = nameColumn?.field ? data[nameColumn.field] : undefined;
        if (fieldValue === name) return true;
        return Object.values(data).some(value => value === name);
    }

    async function readRowsUntilMatch(table, names, nameColumn, timeout = 3500) {
        let rows = await readRows(table);
        const foundNames = () => new Set(rows
            .filter(({ data }) => names.some(name => rowHasAttributeName(data, name, nameColumn)))
            .flatMap(({ data }) => names.filter(name => rowHasAttributeName(data, name, nameColumn))));
        if (foundNames().size === names.length || !names.length) return rows;
        const end = Date.now() + timeout;
        const stableFor = 900;
        let stableSince = Date.now();
        const getSignature = () => JSON.stringify({
            keys: rows.map(({ key }) => key),
            matches: [...foundNames()]
        });
        let lastSignature = getSignature();
        while (Date.now() < end) {
            await sleep(150);
            rows = await readRows(table);
            const found = foundNames();
            if (found.size === names.length) break;
            const signature = getSignature();
            if (signature !== lastSignature) {
                lastSignature = signature;
                stableSince = Date.now();
            } else if (Date.now() - stableSince >= stableFor) {
                break;
            }
        }
        return rows;
    }

    async function findAttributeTargets(values) {
        const remaining = new Map(Object.entries(values));
        const targets = [];
        let hasRows = false;
        const hasSystemKeys = [...remaining.keys()].some(name => name.startsWith('_'));
        const descriptors = hasSystemKeys
            ? [ATTRIBUTE_TABLES[1], ATTRIBUTE_TABLES[0], ATTRIBUTE_TABLES[2]]
            : ATTRIBUTE_TABLES;

        for (const descriptor of descriptors) {
            if (!remaining.size) break;
            const candidateNames = [...remaining.keys()].filter(name => {
                if (descriptor === ATTRIBUTE_TABLES[0]) return !name.startsWith('_');
                if (descriptor === ATTRIBUTE_TABLES[1]) return name.startsWith('_');
                return true;
            });
            if (!candidateNames.length) continue;
            const table = await openAttributeTable(descriptor);
            if (!table) continue;
            const valueColumn = table.columns.find(column => column.template === 'ValueTemplate');
            const nameColumn = table.columns.find(column => column.template === 'cellTemplate') || table.columns[0];
            if (!valueColumn || !nameColumn) continue;
            const rows = await readRowsUntilMatch(table, candidateNames, nameColumn);
            hasRows ||= rows.length > 0;
            const matches = [...remaining.entries()].filter(([name]) => candidateNames.includes(name)).flatMap(([name, value]) => {
                const row = rows.find(({ data }) => rowHasAttributeName(data, name, nameColumn));
                return row ? [{ name, value, row }] : [];
            });
            if (matches.length) {
                targets.push({ descriptor, table, valueColumn, matches });
                matches.forEach(({ name }) => remaining.delete(name));
            }
        }

        return { targets, notFound: [...remaining.keys()], hasRows };
    }

    async function fillBmlTesterAttributes(values, onProgress = () => {}, preparedTargets = null, preparedNotFound = []) {
        if (!values || typeof values !== 'object' || Array.isArray(values)) {
            throw new TypeError('Pass an object of { attributeName: value } pairs.');
        }

        const plan = preparedTargets ? { targets: preparedTargets, notFound: preparedNotFound } : await findAttributeTargets(values);
        const summary = { updated: [], skipped: [], notFound: plan.notFound };
        const total = plan.targets.reduce((count, target) => count + target.matches.length, 0);
        let index = 0;

        for (const { descriptor, valueColumn: plannedValueColumn, matches } of plan.targets) {
            const table = await openAttributeTable(descriptor);
            if (!table) {
                matches.forEach(({ name }) => summary.skipped.push({ name, reason: 'attribute tab did not reopen' }));
                continue;
            }
            const valueColumn = table.columns.find(column => column.template === 'ValueTemplate') || plannedValueColumn;
            for (const { name, value, row } of matches) {
                index++;
                onProgress(`Applying ${index} of ${total}: ${name}`);
                table.editRow = { rowKey: row.key, columnKey: valueColumn.id ?? valueColumn.field };
                const editor = await waitFor(() => table.querySelector(`tr.oj-table-body-row-edit ${EDITOR_SELECTOR}, tr.oj-table-body-row-edit oj-c-labelled-link`), 1500, 50);
                if (!editor) {
                    table.editRow = { rowKey: null, columnKey: null };
                    summary.skipped.push({ name, reason: 'value editor did not open' });
                    continue;
                }

                try {
                    if (editor.localName === 'oj-c-labelled-link') {
                        await fillArrayValues(editor, value);
                    } else {
                        await setEditorValue(editor, value);
                        await sleep(50);
                    }
                } catch (error) {
                    table.editRow = { rowKey: null, columnKey: null };
                    summary.skipped.push({ name, reason: error.message });
                    continue;
                }
                table.editRow = { rowKey: null, columnKey: null };
                await waitFor(() => !table.querySelector(`tr.oj-table-body-row-edit ${EDITOR_SELECTOR}, tr.oj-table-body-row-edit oj-c-labelled-link`), 1500, 50);
                summary.updated.push(name);
            }
        }

        return summary;
    }

    async function readClipboardText() {
        try {
            return await navigator.clipboard.readText();
        } catch {
            // Reads can still be denied by browser permission settings
            return prompt('Clipboard could not be read. Paste the attribute JSON:') ?? '';
        }
    }

    function parseAttributeJson(text) {
        //console.log('Parsing attribute JSON:', text);
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (error) {
            throw new Error(`Clipboard does not contain valid JSON: ${error.message}`);
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Clipboard JSON must be an object of { attributeName: value } pairs.');
        }
        return parsed;
    }

    function hasClipboardValues(values) {
        return Object.values(values).some(value => {
            if (value === null || value === undefined) return false;
            if (typeof value === 'string') return value.trim().length > 0;
            if (Array.isArray(value)) return value.length > 0;
            if (typeof value === 'object') return Object.keys(value).length > 0;
            return true;
        });
    }

    function showProcessingMask() {
        const overlay = doc.createElement('div');
        const message = doc.createElement('div');
        overlay.setAttribute('role', 'status');
        overlay.setAttribute('aria-live', 'polite');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(12,16,28,.72);cursor:progress;';
        message.textContent = 'Preparing to apply clipboard values…';
        message.style.cssText = 'padding:18px 24px;border:1px solid #8a93ab;border-radius:8px;background:#282e3c;color:#fff;font:600 16px/1.5 sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.4);';
        overlay.append(message);
        const blockKeys = event => {
            if (!event.isTrusted) return;
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        doc.addEventListener('keydown', blockKeys, true);
        doc.body.append(overlay);
        return {
            update(text) { message.textContent = text; },
            remove() {
                doc.removeEventListener('keydown', blockKeys, true);
                overlay.remove();
            }
        };
    }

    function flashStatus(button, ok) {
        button.querySelector('.tm-copy-status')?.remove();
        const icon = document.createElement('span');
        icon.className = 'tm-copy-status';
        icon.textContent = ok ? '✓' : '✗';
        icon.style.cssText = `display: inline-block; margin-left: 6px; font-weight: 700; color: ${ok ? '#b6f5b6' : '#ff6b6b'};`;
        button.append(icon);
        icon.animate([
            { transform: 'scale(0.3)', opacity: 0 },
            { transform: 'scale(1.3)', opacity: 1, offset: 0.6 },
            { transform: 'scale(1)', opacity: 1 }
        ], { duration: 300, easing: 'ease-out' });
        setTimeout(() => {
            icon.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300 }).onfinish = () => icon.remove();
        }, 1500);
    }

    async function copyDebug(event) {
        const button = event.currentTarget;
        const configXML = new DOMParser().parseFromString(document.querySelector("textarea[name='configXML']").textContent, 'text/xml');
        const dataMap = {};
        configXML.querySelectorAll('attribute').forEach(attr => {
            let value = attr.querySelector('value')?.textContent ?? '';
            if (attr.getAttribute('menuType') === 'true') {
                value += ` [${attr.getAttribute('value_var_name')}]`;
            }
            dataMap[attr.getAttribute('_variableName')] = value;
        });
        if (!Object.keys(dataMap).length) {
            const warning = 'Configuration data found in XML.  This could be because the configuration is incomplete or has an error';
            console.warn(warning);
            alert(warning);
            flashStatus(button, false);
            return;
        }
        try {
            await navigator.clipboard.writeText(JSON.stringify(dataMap));
            flashStatus(button, true);
        } catch (error) {
            console.error('Copy failed:', error);
            flashStatus(button, false);
        }
    }
    const BUTTON_STYLE = 'margin: 0 6px; padding: 6px 12px; border: 1px solid #8a93ab; border-radius: 6px; ' +
        'background: #fff; color: #1d2130; font: inherit; font-size: 0.875rem; cursor: pointer;background:green;color:white;height:44px;';

    function createButton(id, label, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = id;
        button.textContent = label;
        button.style.cssText = BUTTON_STYLE;
        button.addEventListener('click', onClick);
        return button;
    }

    async function loadTesterAttributes() {
        const button = doc.getElementById('tm-load-tester-attributes');
        let mask;
        try {
            const values = parseAttributeJson((await readClipboardText()).trim());
            if (!hasClipboardValues(values)) return;
            const plan = await findAttributeTargets(values);
            if (!plan.targets.length) {
                if (plan.hasRows) alert(`No matching tester attributes found for: ${plan.notFound.join(', ')}`);
                return;
            }
            mask = showProcessingMask();
            if (button) button.disabled = true;
            const summary = await fillBmlTesterAttributes(values, text => mask.update(text), plan.targets, plan.notFound);
            mask.update(`Finished: ${summary.updated.length} updated, ${summary.skipped.length} skipped, ${summary.notFound.length} not found`);
            await sleep(900);
        } catch (error) {
            alert(error.message);
        } finally {
            mask?.remove();
            if (button) button.disabled = false;
        }
    }

    const findReturnDataArea = () => [...doc.querySelectorAll('oj-c-text-area')]
        .find(area => area.querySelector('label')?.textContent.trim() === 'Return Data');

    let testerInputsCollapsed = false;
    let printDataVisible = true;

    function setTextIfChanged(element, text) {
        if (element && element.textContent !== text) element.textContent = text;
    }

    function setHiddenIfChanged(element, hidden) {
        if (element && element.hidden !== hidden) element.hidden = hidden;
    }

    function setExpandedIfChanged(element, expanded) {
        const value = String(expanded);
        if (element && element.getAttribute('aria-expanded') !== value) element.setAttribute('aria-expanded', value);
    }

    function getTesterInputElements() {
        const tabBar = [...doc.querySelectorAll(TESTER_DOM.tabBar)].find(element =>
            element.getAttribute('data')?.includes(TESTER_DOM.testerTabData)
        ) || doc.querySelector(TESTER_DOM.parametersTab)?.closest(TESTER_DOM.tabBar);
        const switcher = tabBar?.nextElementSibling?.matches(TESTER_DOM.switcher)
            ? tabBar.nextElementSibling
            : [...doc.querySelectorAll(TESTER_DOM.switcher)].find(element =>
                element.getAttribute('value')?.includes('testerTabSelectedItem')
            );
        const fields = [...doc.querySelectorAll('oj-c-input-text, oj-c-text-area')];
        const findField = label => fields.find(element =>
            element.labelHint === label || element.querySelector('label')?.textContent.trim() === label
        );
        const dataImport = findField('Data Import');
        const contextParameters = findField('Context Parameters');
        const importButton = doc.querySelector(TESTER_DOM.importButton);
        const dataImportRow = findCommonAncestor(dataImport, importButton) || dataImport?.closest(TESTER_DOM.flexItem) || dataImport;
        return {
            tabBar,
            switcher,
            dataImport,
            dataImportRow,
            contextParameters: contextParameters?.closest(TESTER_DOM.flexItem) || contextParameters,
            importButton: importButton?.closest('oj-c-button') || importButton
        };
    }

    function getTesterInputToggleAnchor(elements) {
        const collapsible = elements.dataImport?.closest('oj-c-collapsible');
        const content = collapsible?.querySelector('[id^="oj-collapsible-content-"]');
        return content || elements.dataImportRow || elements.tabBar;
    }

    function findCommonAncestor(first, second) {
        if (!first || !second) return null;
        const ancestors = new Set();
        for (let node = first; node; node = node.parentElement) ancestors.add(node);
        for (let node = second; node; node = node.parentElement) {
            if (ancestors.has(node)) return node;
        }
        return null;
    }

    function ensureTesterInputPanel() {
        const elements = getTesterInputElements();
        const anchor = getTesterInputToggleAnchor(elements);
        if (!anchor) return;

        let toggle = doc.getElementById('tm-toggle-tester-inputs');
        if (!toggle) {
            toggle = createButton('tm-toggle-tester-inputs', '', () => {
                testerInputsCollapsed = !testerInputsCollapsed;
                applyTesterInputState();
            });
            toggle.style.cssText = 'display:block;width:100%;margin:8px 0;padding:8px 12px;border:1px solid #505c7c;border-radius:6px;background:#282e3c;color:#e2e4ee;font:inherit;text-align:left;cursor:pointer;';
        }
        if (toggle.parentElement !== anchor.parentElement || toggle.nextElementSibling !== anchor) {
            anchor.before(toggle);
        }
        setTextIfChanged(toggle, testerInputsCollapsed ? 'Show Tester Inputs' : 'Hide Tester Inputs');
        setExpandedIfChanged(toggle, !testerInputsCollapsed);
        applyTesterInputVisibility(elements);
    }

    function applyTesterInputVisibility(elements) {
        [elements.dataImportRow, elements.contextParameters, elements.tabBar, elements.switcher]
            .forEach(element => setHiddenIfChanged(element, testerInputsCollapsed));
    }

    function applyTesterInputState() {
        const toggle = doc.getElementById('tm-toggle-tester-inputs');
        const elements = getTesterInputElements();
        if (toggle) {
            setTextIfChanged(toggle, testerInputsCollapsed ? 'Show Tester Inputs' : 'Hide Tester Inputs');
            setExpandedIfChanged(toggle, !testerInputsCollapsed);
        }
        applyTesterInputVisibility(elements);
    }

    function ensurePrintDataControl() {
        const runButton = doc.querySelector(TESTER_DOM.runButton);
        if (!runButton) return;

        let toggle = doc.getElementById('tm-toggle-print-data');
        if (!toggle) {
            toggle = createButton('tm-toggle-print-data', '', () => {
                printDataVisible = !printDataVisible;
                applyPrintDataState();
            });
            toggle.style.cssText = 'margin-left:8px;padding:6px 10px;border:1px solid #505c7c;border-radius:6px;background:#282e3c;color:#e2e4ee;font:inherit;cursor:pointer;';
            (runButton.closest('oj-c-button') || runButton).after(toggle);
        }
        applyPrintDataState();
        ensureConsoleMetrics(runButton);
    }

    function findPrintDataContainer() {
        return doc.getElementById(TESTER_DOM.printDataId) ||
            doc.querySelector(TESTER_DOM.printDataClass);
    }

    function findPrintDataSection(container) {
        if (!container) return null;
        const label = doc.querySelector(`oj-label[for="${TESTER_DOM.printDataId}"]`);
        return label?.closest(TESTER_DOM.printDataSection) ||
            container.closest(TESTER_DOM.printDataSection) ||
            container.parentElement;
    }

    function getPrintDataLineCount(container) {
        if (!container) return 0;
        return [...container.children].filter(child => child.tagName === 'DIV' && child.querySelector('span')).length;
    }

    function applyPrintDataState() {
        const toggle = doc.getElementById('tm-toggle-print-data');
        const printData = findPrintDataContainer();
        const printSection = findPrintDataSection(printData);
        const lineCount = getPrintDataLineCount(printData);
        if (toggle) {
            const label = lineCount
                ? `${printDataVisible ? 'Hide' : 'Show'} ${lineCount} printed ${lineCount === 1 ? 'line' : 'lines'}`
                : 'No printed lines';
            setTextIfChanged(toggle, label);
            setExpandedIfChanged(toggle, printDataVisible);
            toggle.disabled = !lineCount;
        }
        setHiddenIfChanged(printSection || printData, !lineCount || !printDataVisible);
    }

    function ensureConsoleMetrics(runButton) {
        const consoleLabel = runButton.closest('oj-label-value')?.querySelector('[slot="label"]');
        if (!consoleLabel) return;
        let summary = doc.getElementById('tm-console-metrics');
        if (!summary) {
            summary = doc.createElement('span');
            summary.id = 'tm-console-metrics';
            summary.style.cssText = 'margin-left:8px;color:#8a93ab;font-size:.85em;font-weight:400;';
        }
        const runControl = runButton.closest('oj-c-button') || runButton;
        if (summary.nextElementSibling !== runControl) consoleLabel.insertBefore(summary, runControl);

        const metrics = [...doc.querySelectorAll('oj-c-input-text[label-hint]')];
        const matchesMetric = (input, token, label) =>
            input.getAttribute('label-hint')?.includes(token) ||
            input.labelHint === label ||
            input.querySelector('label')?.textContent.trim() === label;
        const elapsed = metrics.find(input => matchesMetric(input, 'CX_CPQ_BML_ELAPSED_TIME', 'Elapsed Time'));
        const scriptSize = metrics.find(input => matchesMetric(input, 'CX_CPQ_BML_SCRIPT_SIZE', 'Script Size'));
        const elapsedValue = elapsed?.value;
        const sizeValue = scriptSize?.value;
        const parts = [];

        if (elapsedValue !== undefined && elapsedValue !== null && elapsedValue !== '') {
            const elapsedText = String(elapsedValue).replace(/\s*(ms|milliseconds?)$/i, '');
            parts.push(`${elapsedText}ms`);
        }
        if (sizeValue !== undefined && sizeValue !== null && sizeValue !== '') {
            const sizeText = String(sizeValue).replace(/\s*bytes?$/i, '');
            parts.push(`${sizeText} bytes`);
        }

        setTextIfChanged(summary, parts.length ? `(${parts.join(', ')})` : '');
        [elapsed, scriptSize].forEach(input => setHiddenIfChanged(input, parts.length > 0));
    }

    async function copyReturnData(event) {
        const button = event.currentTarget;
        try {
            const text = findReturnDataArea()?.querySelector('textarea')?.value;
            if (text === undefined) throw new Error('Return Data field not found.');
            await navigator.clipboard.writeText(text);
            flashStatus(button, true);
        } catch (error) {
            console.error('Copy failed:', error);
            flashStatus(button, false);
        }
    }

    const currentRoute = () => unsafeWindow.location.pathname;
    const isBmlEditorRoute = () => currentRoute().includes('/bml/bml-edit');
    const isPipelineViewerRoute = () => currentRoute().includes('pipeline_viewer_config.jsp');

    function ensureBmlEditorButtons() {
        ensureTesterInputPanel();
        ensurePrintDataControl();
        if (!doc.getElementById('tm-load-tester-attributes')) {
            const anchor = doc.querySelector(PROPERTIES_BUTTON)?.closest('oj-c-button');
            anchor?.after(createButton('tm-load-tester-attributes', '📋 Load Tester Attributes', loadTesterAttributes));
        }
        const returnData = findReturnDataArea();
        if (returnData && returnData.previousElementSibling?.id !== 'tm-copy-return-data') {
            doc.getElementById('tm-copy-return-data')?.remove();
            const copyButton = createButton('tm-copy-return-data', '⎘ Copy Results', copyReturnData);
            copyButton.style.cssText += 'height: 28px; margin: 4px 0;';
            returnData.before(copyButton);
        }
    }

    function ensurePipelineCopyButton() {
        if (doc.getElementById('tm-copy-tester-attributes')) return;
        const configXml = doc.querySelector("textarea[name='configXML']");
        const pageTabs = doc.querySelector('ul.page-tabs[role="tablist"]');
        if (!configXml || !pageTabs) return;
        const copyButton = createButton('tm-copy-tester-attributes', '⎘ Copy BML Tester Attributes', copyDebug);
        copyButton.style.cssText += 'height: 25px;';
        pageTabs.appendChild(copyButton);
    }

    function initializeCurrentRoute() {
        if (isBmlEditorRoute()) ensureBmlEditorButtons();
        if (isPipelineViewerRoute()) ensurePipelineCopyButton();
    }

    const pageObserver = new MutationObserver(initializeCurrentRoute);
    if (doc.body) pageObserver.observe(doc.body, { childList: true, subtree: true });
    initializeCurrentRoute();

    const history = unsafeWindow.history;
    ['pushState', 'replaceState'].forEach(method => {
        const original = history[method];
        history[method] = function (...args) {
            const result = original.apply(this, args);
            initializeCurrentRoute();
            return result;
        };
    });
    unsafeWindow.addEventListener('popstate', initializeCurrentRoute);
    unsafeWindow.addEventListener('hashchange', initializeCurrentRoute);

})();
