// ==UserScript==
// @name         BML Editor Copy/Paste
// @namespace    http://tampermonkey.net
// @version      1.1
// @description  Improvements for BML Editor Pages
// @author       Sven Hansen (PW)
// @match        https://*.oraclegovcloud2.com/*/bml/bml-edit?*
// @match        https://*.bigmachines.com/*/bml/bml-edit?*
// @match        https://*.oraclegovcloud2.com/*/application/container/bml*
// @match        https://*.bigmachines.com/*/application/container/bml*
// @match        https://*.oraclegovcloud2.com/*/configuration/pipeline_viewer_config.jsp*
// @match        https://*.bigmachines.com/*/configuration/pipeline_viewer_config.jsp*
// @match        https://*.oraclegovcloud2.com/*/spring/bmllibrary*
// @match        https://*.bigmachines.com/*/spring/bmllibrary*
// @updateURL    https://github.com/Pierce-Washington/cpq-qol-scripts-dist/raw/main/cpq/bml-editor.js
// @downloadURL  https://github.com/Pierce-Washington/cpq-qol-scripts-dist/raw/main/cpq/bml-editor.js
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
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
    const MULTI_SELECT_SEPARATOR = '~';
    const LEGACY_MULTI_SELECT_SEPARATOR = '$_tilda_$';
    const TESTER_DOM = {
        tabBar: 'oj-c-tab-bar',
        testerTabData: 'scriptTesterTabs',
        parametersTab: '[data-oj-key="testerParameters"][role="tab"]',
        switcher: 'oj-switcher',
        commerceSystemAttributesTab: '[data-oj-key="testerCommerceSystemAttributes"][role="tab"]',
        commerceTransactionAttributesTab: '[data-oj-key="testerCommerceMainDocAttributes"][role="tab"]',
        attributesTab: '[data-oj-key="testerConfigAttributes"][role="tab"]',
        utilityAttributesTab: '[data-oj-key="testerUtilAttributes"][role="tab"]',
        systemAttributesTab: '[data-oj-key="testerSystemConfigurationAttributes"][role="tab"]',
        configAttributesTable: 'cx-cpq-bml-validator-function-inputs-table',
        commerceSystemAttributesTable: 'cx-cpq-bml-tester-commerce-system-attributes-table',
        commerceTransactionAttributesTable: 'cx-cpq-bml-tester-commerce-main-doc-attributes-table',
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

    function isCustomElementUpgraded(element) {
        const registry = unsafeWindow.customElements;
        const constructor = registry.get(element.localName);
        return Boolean(constructor && element instanceof constructor);
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
        if (match) return { label: match[1].trim(), key: match[2].trim() };
        const separator = raw.lastIndexOf(':');
        if (separator > 0 && separator < raw.length - 1) {
            return { label: raw.slice(0, separator).trim(), key: raw.slice(separator + 1).trim() };
        }
        return { label: raw.trim(), key: raw.trim() };
    }

    async function readOptions(dataProvider) {
        const options = [];
        if (!dataProvider) return options;
        const iterator = dataProvider.fetchFirst({ size: -1 })[Symbol.asyncIterator]();
        for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
            next.value.data.forEach((data, index) => options.push({
                key: next.value.metadata[index].key,
                value: data.itemValue ?? data.variableName ?? data.value,
                text: data.itemText ?? data.displayName ?? data.label
            }));
        }
        return options;
    }

    function normalizeMenuToken(value) {
        const text = String(value ?? '').trim();
        try {
            return decodeURIComponent(text);
        } catch {
            return text;
        }
    }

    async function resolveOption(options, raw, metadataOptions = []) {
        const { label, key } = parseMenuValue(String(raw ?? ''));
        if (!key && !label) return null;
        const optionList = Array.isArray(options) ? options : [options];
        const metadataList = Array.isArray(metadataOptions) ? metadataOptions : [metadataOptions];
        const normalizedKey = normalizeMenuToken(key);
        const normalizedRaw = normalizeMenuToken(raw);
        const normalizedLabel = normalizeMenuToken(label);
        const metadataOption = metadataList.find(item =>
            normalizeMenuToken(item.variableName) === normalizedKey ||
            normalizeMenuToken(item.variableName) === normalizedRaw ||
            normalizeMenuToken(item.displayName) === normalizedLabel ||
            normalizeMenuToken(item.displayName) === normalizedRaw
        );
        const metadataValue = metadataOption && normalizeMenuToken(metadataOption.variableName);
        const option = (metadataOption && optionList.find(o =>
            (o.value != null && normalizeMenuToken(o.value) === metadataValue) ||
            normalizeMenuToken(o.key) === metadataValue ||
            normalizeMenuToken(o.text) === normalizeMenuToken(metadataOption.displayName)
        )) ||
            optionList.find(o => o.value != null && normalizeMenuToken(o.value) === normalizedKey) ||
            optionList.find(o => normalizeMenuToken(o.key) === normalizedKey) ||
            optionList.find(o => normalizeMenuToken(o.key) === normalizedRaw) ||
            optionList.find(o => normalizeMenuToken(o.text) === normalizedLabel);
        if (!option) throw new Error(`"${raw}" is not a valid menu option`);
        return option.value ?? option.key;
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
    async function selectMultipleViaDropdown(editor, value, metadataOptions = []) {
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
            value: item.getAttribute('data-oj-key'),
            text: item.textContent.trim(),
            item,
            option: item.querySelector('[role="option"]') || item
        }));

        const options = await waitFor(() => {
            const rendered = renderedOptions();
            return rendered.length ? rendered : null;
        });
        if (!options) throw new Error('multi-select options did not render');
        const rawValues = Array.isArray(value) ? value : [value];
        const raws = rawValues.flatMap(raw => {
            const rawValue = String(raw ?? '');
            const separator = rawValue.includes(MULTI_SELECT_SEPARATOR)
                ? MULTI_SELECT_SEPARATOR
                : LEGACY_MULTI_SELECT_SEPARATOR;
            return splitMenuValues(rawValue, separator);
        });
        const wanted = new Set((await Promise.all(raws.map(raw => resolveOption(options, raw, metadataOptions)))).filter(key => key !== null));

        for (const { key, item, option } of options) {
            const isSelected = () => option.getAttribute('aria-selected') === 'true' ||
                item.querySelector('input[type="checkbox"]')?.getAttribute('aria-checked') === 'true';
            if (isSelected() === wanted.has(key)) continue;
            pressElement(option);
            if (!await waitFor(() => isSelected() === wanted.has(key), 2000)) {
                throw new Error(`could not ${wanted.has(key) ? 'select' : 'deselect'} "${key}"`);
            }
        }

        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        if (!await waitFor(() => !listbox(), 1000)) {
            throw new Error('multi-select dropdown remained open after Escape');
        }
    }

    async function setEditorValue(editor, value, metadataOptions = []) {
        if (editor.localName === 'oj-c-select-single') {
            editor.value = await resolveOption(await readOptions(editor.data), value, metadataOptions);
        } else if (editor.localName === 'oj-c-select-multiple') {
            await selectMultipleViaDropdown(editor, value, metadataOptions);
        } else {
            editor.value = editorValue(editor, value);
        }
    }

    // Values may be copied as "A<sep>B [a<sep>b]" or as "A [a]<sep>B [b]"
    function splitMenuValues(raw, separator) {
        if (!raw) return [];
        const separatedValues = raw.split(separator);
        if (separatedValues.length > 1 && separatedValues.every(value => /\[[\s\S]*\]\s*$/.test(value))) {
            return separatedValues;
        }
        const match = /^([\s\S]*?)\s*\[([\s\S]*)\]$/.exec(raw);
        if (match && match[2].includes(separator)) {
            const labels = match[1].split(separator);
            return match[2].split(separator).map((key, i) => `${labels[i] ?? ''} [${key}]`);
        }
        return raw.split(separator);
    }

    // Clicks the native control rendered inside a JET button/link so its oj-action fires
    const activate = (component) => (component.querySelector('button, a') || component).click();

    function parseArrayInput(value) {
        const explicitClear = value === '' || value === null || value === undefined ||
            (Array.isArray(value) && value.length === 0);
        const items = Array.isArray(value)
            ? value.map(item => String(item ?? ''))
            : explicitClear
                ? []
                : String(value).split(ARRAY_SEPARATOR);
        if (!explicitClear && items.some(item => !item.trim())) {
            throw new Error(`Leading, trailing, or interior empty array entries are not supported by Script Tester since the array input screen requires a value for an entry to be added; skipped this attribute (example: A${ARRAY_SEPARATOR}${ARRAY_SEPARATOR}B)`);
        }
        return items;
    }

    async function closeArrayValuePopup() {
        const popup = doc.getElementById(ARRAY_POPUP_ID);
        if (!popup?.isOpen?.()) return;
        const beforeCloseEvents = [];
        const onBeforeClose = event => beforeCloseEvents.push(event);
        popup.addEventListener('ojBeforeClose', onBeforeClose);
        try {
            doc.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Escape',
                code: 'Escape',
                bubbles: true,
                composed: true
            }));
            if (await waitFor(() => !popup.isOpen(), 300)) return;
            popup.close();
            if (await waitFor(() => !popup.isOpen(), 2000)) return;
            popup.focus();
            popup.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Escape',
                code: 'Escape',
                bubbles: true,
                composed: true
            }));
            if (!await waitFor(() => !popup.isOpen(), 500)) {
                const closeWasCanceled = beforeCloseEvents.some(event => event.defaultPrevented);
                const message = closeWasCanceled
                    ? 'array popup close was canceled by ojBeforeClose'
                    : 'array value popup remained open after close() and popup-targeted Escape';
                const error = new Error(message);
                error.arrayPopupCloseAttempted = true;
                throw error;
            }
        } finally {
            popup.removeEventListener('ojBeforeClose', onBeforeClose);
        }
    }

    async function fillArrayValues(link, value, metadataOptions = []) {
        const items = parseArrayInput(value)
            .filter(item => { const { label, key } = parseMenuValue(item); return label || key; });

        const readyLink = await waitFor(() =>
            link.isConnected && isCustomElementUpgraded(link) &&
                link.classList.contains('oj-complete') && link.querySelector('button, a')
                ? link
                : null,
            3000,
            50
        );
        if (!readyLink) throw new Error('array value link did not finish rendering');

        activate(readyLink);
        const popup = await waitFor(() => {
            const el = doc.getElementById(ARRAY_POPUP_ID);
            return el?.isOpen?.() ? el : null;
        });
        if (!popup) throw new Error('array value popup did not open');

        try {
            const arrayTable = await waitFor(() => doc.getElementById(ARRAY_TABLE_ID));
            if (!arrayTable) throw new Error('array value table did not render in the open popup');
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
                await setEditorValue(input, item, metadataOptions);
                await sleep(50);
                activate(submit);
                if (!await waitFor(() => rowCount() > before)) throw new Error(`could not add array value "${item}"`);
            }
        } finally {
            await closeArrayValuePopup();
        }
    }

    const CONFIG_ATTRIBUTE_TABLES = [
        { tabSelector: TESTER_DOM.attributesTab, tableId: TESTER_DOM.configAttributesTable, nameFilter: name => !name.startsWith('_') },
        { tabSelector: TESTER_DOM.utilityAttributesTab, tableId: TESTER_DOM.utilityAttributesTable, nameFilter: name => name.startsWith('_') },
        { tabSelector: TESTER_DOM.systemAttributesTab, tableId: TESTER_DOM.systemAttributesTable }
    ];

    const COMMERCE_ATTRIBUTE_TABLES = [
        { tabSelector: TESTER_DOM.commerceSystemAttributesTab, tableId: TESTER_DOM.commerceSystemAttributesTable },
        { tabSelector: TESTER_DOM.commerceTransactionAttributesTab, tableId: TESTER_DOM.commerceTransactionAttributesTable }
    ];

    function getAttributeTables() {
        return new URLSearchParams(unsafeWindow.location.search).get('type') === 'commerce'
            ? COMMERCE_ATTRIBUTE_TABLES
            : CONFIG_ATTRIBUTE_TABLES;
    }

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
        const attributeTables = getAttributeTables();
        const hasSystemKeys = [...remaining.keys()].some(name => name.startsWith('_'));
        const descriptors = attributeTables === CONFIG_ATTRIBUTE_TABLES && hasSystemKeys
            ? [attributeTables[1], attributeTables[0], attributeTables[2]]
            : attributeTables;

        for (const descriptor of descriptors) {
            if (!remaining.size) break;
            const candidateNames = [...remaining.keys()].filter(name => descriptor.nameFilter?.(name) ?? true);
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

    function getEditorSelector(metadata) {
        if (metadata?.isArray) return 'oj-c-labelled-link';
        const typeCode = metadata?.typeCode ?? metadata?.inputTypeCode;
        if (typeCode === 'SingleSelectMenu' || typeCode === 'SSM') return 'oj-c-select-single';
        if (typeCode === 'MultiSelectMenu' || typeCode === 'MSM') return 'oj-c-select-multiple';
        return `${EDITOR_SELECTOR}, oj-c-labelled-link`;
    }

    async function waitForTesterEditorToClose(table, timeout = 3000) {
        return Boolean(await waitFor(() =>
            !table.querySelector(`tr.oj-table-body-row-edit ${EDITOR_SELECTOR}, tr.oj-table-body-row-edit oj-c-labelled-link`),
            timeout,
            50
        ));
    }

    async function fillBmlTesterAttributes(values, onProgress = () => {}, preparedTargets = null, preparedNotFound = [], menuMetadata = new Map()) {
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
                const attributeMetadata = menuMetadata.get(name);
                const metadataOptions = attributeMetadata?.options || [];
                const editorSelector = getEditorSelector(attributeMetadata);
                index++;
                onProgress(`Applying ${index} of ${total}: ${name}`);
                table.editRow = { rowKey: row.key, columnKey: valueColumn.id ?? valueColumn.field };
                const editor = await waitFor(() => {
                    const candidate = table.querySelector(`tr.oj-table-body-row-edit ${editorSelector}`);
                    if (!candidate) return null;
                    if (candidate.localName.startsWith('oj-c-') &&
                        (!isCustomElementUpgraded(candidate) || !candidate.classList.contains('oj-complete'))) return null;
                    return candidate;
                }, 3000, 50);
                if (!editor) {
                    table.editRow = { rowKey: null, columnKey: null };
                    const skipped = { name, reason: 'value editor did not open' };
                    summary.skipped.push(skipped);
                    if (!await waitForTesterEditorToClose(table)) {
                        skipped.reason += '; value editor remained open after reset';
                        return summary;
                    }
                    continue;
                }

                try {
                    if (editor.localName === 'oj-c-labelled-link') {
                        await fillArrayValues(editor, value, metadataOptions);
                    } else {
                        await setEditorValue(editor, value, metadataOptions);
                        await sleep(50);
                    }
                } catch (error) {
                    let cleanupError = error.arrayPopupCloseAttempted ? error : null;
                    try {
                        if (!error.arrayPopupCloseAttempted) {
                            await closeArrayValuePopup();
                        }
                    } catch (closeError) {
                        cleanupError = closeError;
                    } finally {
                        table.editRow = { rowKey: null, columnKey: null };
                    }
                    const skipped = {
                        name,
                        reason: cleanupError && cleanupError !== error
                            ? `${error.message}; ${cleanupError.message}`
                            : error.message
                    };
                    summary.skipped.push(skipped);
                    if (cleanupError) return summary;
                    if (!await waitForTesterEditorToClose(table)) {
                        skipped.reason += '; value editor remained open after reset';
                        return summary;
                    }
                    continue;
                }
                table.editRow = { rowKey: null, columnKey: null };
                if (!await waitForTesterEditorToClose(table)) {
                    summary.skipped.push({ name, reason: 'value editor did not close after update; remaining attributes were not attempted' });
                    return summary;
                }
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

    function showActionNotice(button, message, isError = true, isWarning = false) {
        let notice = doc.getElementById('tm-bml-action-notice');
        if (!notice) {
            notice = doc.createElement('div');
            notice.id = 'tm-bml-action-notice';
            notice.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483646;max-width:420px;padding:12px 16px;border:1px solid #505c7c;border-radius:6px;background:#282e3c;color:#e2e4ee;font:14px/1.45 sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);';
            doc.body.append(notice);
        }
        notice.textContent = message;
        notice.setAttribute('role', isError ? 'alert' : 'status');
        notice.style.borderColor = isWarning ? '#f2a93b' : isError ? '#ff6b6b' : '#8fc9a3';
        notice.style.background = isWarning ? '#382b16' : '#282e3c';
        notice.style.color = isWarning ? '#ffe0a3' : '#e2e4ee';
        clearTimeout(notice._hideTimer);
        notice._hideTimer = setTimeout(() => notice.remove(), 7000);
        if (button && !isWarning) flashStatus(button, !isError);
    }

    function findScriptTesterCollapsible() {
        const tabBar = findTesterTabBar();
        return tabBar?.closest('oj-c-collapsible') || null;
    }

    function isCollapsibleExpanded(collapsible) {
        if (!collapsible) return null;
        if (typeof collapsible.expanded === 'boolean') return collapsible.expanded;
        const header = collapsible.querySelector('[slot="header"] [aria-expanded], .oj-collapsible-header [aria-expanded]');
        if (header) return header.getAttribute('aria-expanded') === 'true';
        const content = collapsible.querySelector('[id^="oj-collapsible-content-"]');
        return content ? isElementVisible(content) : null;
    }

    function setCollapsibleExpanded(collapsible, expanded) {
        if (!collapsible) return;
        const current = isCollapsibleExpanded(collapsible);
        if (current === expanded) return;
        if (typeof collapsible.expanded === 'boolean') {
            collapsible.expanded = expanded;
            return;
        }
        const header = collapsible.querySelector('[slot="header"] [aria-expanded], .oj-collapsible-header [aria-expanded]');
        header?.click();
    }

    async function withTesterPanelsOpen(action) {
        const collapsible = findScriptTesterCollapsible();
        const wasScriptExpanded = isCollapsibleExpanded(collapsible);
        const wasInputsCollapsed = testerInputsCollapsed;
        try {
            if (wasScriptExpanded === false) setCollapsibleExpanded(collapsible, true);
            if (testerInputsCollapsed) {
                testerInputsCollapsed = false;
                applyTesterInputState();
            }
            return await action();
        } finally {
            if (wasInputsCollapsed) {
                testerInputsCollapsed = true;
                applyTesterInputState();
            }
            if (wasScriptExpanded === false) setCollapsibleExpanded(collapsible, false);
        }
    }

    async function copyDebug(event) {
        const button = event.currentTarget;
        const configXML = new DOMParser().parseFromString(document.querySelector("textarea[name='configXML']").textContent, 'text/xml');
        const dataMap = {};
        configXML.querySelectorAll('attribute').forEach(attr => {
            let value = attr.querySelector('value')?.textContent ?? '';
            if (attr.getAttribute('menuType') === 'true') {
                const variableValue = attr.getAttribute('value_var_name')?.trim();
                value = variableValue || value;
                value = value.replaceAll(LEGACY_MULTI_SELECT_SEPARATOR, MULTI_SELECT_SEPARATOR);
            }
            dataMap[attr.getAttribute('_variableName')] = value;
        });
        if (!Object.keys(dataMap).length) {
            const warning = 'Configuration data found in XML.  This could be because the configuration is incomplete or has an error';
            showActionNotice(button, warning);
            return;
        }
        try {
            await navigator.clipboard.writeText(JSON.stringify(dataMap));
            flashStatus(button, true);
        } catch (error) {
            console.error('Copy failed:', error);
            showActionNotice(button, `Copy failed: ${error.message}`);
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
        let completionNotice = '';
        let completionIsError = false;
        let completionIsWarning = false;
        try {
            const values = parseAttributeJson((await readClipboardText()).trim());
            if (!hasClipboardValues(values)) return;
            mask = showProcessingMask();
            if (button) button.disabled = true;
            let menuMetadata = new Map();
            try {
                menuMetadata = await fetchMenuMetadata();
            } catch (error) {
                completionNotice = `Menu metadata unavailable; using visible menu options. ${error.message}`;
                console.warn(completionNotice, error);
            }
            const plan = await findAttributeTargets(values);
            if (!plan.targets.length) {
                if (plan.hasRows) mask.update(`No matching tester attributes found for: ${plan.notFound.join(', ')}`);
                await openAttributeTable(getAttributeTables()[0]);
                await sleep(900);
                return;
            }
            const summary = await fillBmlTesterAttributes(values, text => mask.update(text), plan.targets, plan.notFound, menuMetadata);
            await openAttributeTable(getAttributeTables()[0]);
            if (summary.skipped.length) {
                const emptyArraySkips = summary.skipped.filter(({ reason }) => reason?.includes('empty array entries'));
                const otherSkips = summary.skipped.filter(({ reason }) => !reason?.includes('empty array entries'));
                const skippedDetails = [
                    emptyArraySkips.length
                        ? `Script Tester cannot import empty array values; skipped array attributes: ${emptyArraySkips.map(({ name }) => name).join(', ')}`
                        : '',
                    ...otherSkips.map(({ name, reason }) => `${name} (${reason})`)
                ].filter(Boolean).join('; ');
                const skipNotice = emptyArraySkips.length && !otherSkips.length
                    ? `Caught Exception: ${skippedDetails}`
                    : `Skipped ${summary.skipped.length} attribute${summary.skipped.length === 1 ? '' : 's'}: ${skippedDetails}`;
                completionNotice = [completionNotice, skipNotice].filter(Boolean).join(' ');
                completionIsWarning = emptyArraySkips.length > 0 && otherSkips.length === 0;
                completionIsError = otherSkips.length > 0;
            }
            mask.update(`Finished: ${summary.updated.length} updated, ${summary.skipped.length} skipped, ${summary.notFound.length} not found`);
            await sleep(900);
        } catch (error) {
            alert(error.message);
        } finally {
            mask?.remove();
            if (button) button.disabled = false;
            if (completionNotice) showActionNotice(button, completionNotice, completionIsError, completionIsWarning);
        }
    }

    async function copyTesterAttributes(event) {
        const button = event.currentTarget;
        try {
            await withTesterPanelsOpen(async () => {
                const attributeTables = getAttributeTables();
                const tablesToCopy = new URLSearchParams(unsafeWindow.location.search).get('type') === 'commerce'
                    ? attributeTables
                    : attributeTables.slice(0, 1);
                const data = {};
                for (const descriptor of tablesToCopy) {
                    const table = await openAttributeTable(descriptor);
                    if (!table) throw new Error(`Tester attributes table ${descriptor.tableId} could not be opened.`);
                    const valueColumn = table.columns.find(column => column.template === 'ValueTemplate');
                    const nameColumn = table.columns.find(column => column.template === 'cellTemplate') || table.columns[0];
                    if (!valueColumn || !nameColumn) throw new Error(`Could not identify columns in ${descriptor.tableId}.`);

                    const rows = await readRows(table);
                    rows.forEach(({ data: row }) => {
                        const name = typeof row === 'string' ? row : row?.[nameColumn.field];
                        if (typeof name === 'string' && name) data[name] = row?.[valueColumn.field] ?? '';
                    });
                }
                if (!Object.keys(data).length) throw new Error('No tester attributes are available to copy.');

                let metadataWarning = '';
                try {
                    enrichMenuAttributes(data, await fetchMenuMetadata());
                } catch (error) {
                    metadataWarning = `Menu metadata unavailable; copied raw values. ${error.message}`;
                    console.warn(metadataWarning, error);
                }
                await navigator.clipboard.writeText(JSON.stringify(data));
                if (metadataWarning) showActionNotice(button, metadataWarning, false);
                else flashStatus(button, true);
            });
        } catch (error) {
            console.error('Copy Tester Attributes failed:', error);
            showActionNotice(button, `Copy Tester Attributes failed: ${error.message}`);
        }
    }

    function getCurrentModelPath() {
        const params = new URLSearchParams(unsafeWindow.location.search);
        const productFamily = params.get('productFamily');
        const productLine = params.get('productLine');
        const model = params.get('model');
        if (!productFamily || !productLine || !model) return null;
        return `/cpq/rest/v19/allProductFamilySetups/_allProductFamilies/productFamilies/${encodeURIComponent(productFamily)}/productLines/${encodeURIComponent(productLine)}/models/${encodeURIComponent(model)}/attributes?expand=menuItems&limit=1000&offset=0`;
    }

    function getCommerceMetadataPath(params) {
        const process = params.get('process');
        const document = params.get('document');
        if (!process || !document) return null;
        return `/cpq/rest/v19/commerceProcessSetups/${encodeURIComponent(process)}/bml/attributeLookups/${encodeURIComponent(document)}/lookupValues?excludeLinks=self%2Cparent%2Ccanonical`;
    }

    function getMetadataPath() {
        const params = new URLSearchParams(unsafeWindow.location.search);
        const commercePath = params.get('type') === 'commerce' ? getCommerceMetadataPath(params) : null;
        return commercePath || getCurrentModelPath();
    }

    let menuMetadataPromise;

    function fetchMenuMetadata() {
        if (!menuMetadataPromise) {
            menuMetadataPromise = (async () => {
                const path = getMetadataPath();
                if (!path) return new Map();
                const response = await unsafeWindow.fetch(path, { credentials: 'same-origin' });
                if (!response.ok) throw new Error(`Attribute metadata request failed (${response.status}).`);
                const payload = await response.json();
                const byAttribute = new Map();
                const visited = new Set();

                function visit(value) {
                    if (!value || typeof value !== 'object' || visited.has(value)) return;
                    visited.add(value);
                    if (Array.isArray(value)) {
                        value.forEach(visit);
                        return;
                    }

                    const attributeName = value.variableName || value.attributeName;
                    const menuItems = value.menuItems?.items || value.menuItems || value.menuItemList?.items || value.menuItemList;
                    if (typeof attributeName === 'string') {
                        const options = Array.isArray(menuItems) ? menuItems.map(item => ({
                            displayName: item.itemText ?? item.displayName ?? item.label ?? item.name,
                            variableName: item.itemValue ?? item.variableName ?? item.valueVariableName ?? item.value
                        })).filter(item => item.displayName != null && item.variableName != null) : [];
                        const attributeType = value.attributeType?.displayValue ?? value.attributeType;
                        const arrayFlag = value.array;
                        const isArray = typeof arrayFlag === 'boolean'
                            ? arrayFlag
                            : typeof arrayFlag === 'string'
                                ? arrayFlag.toLowerCase() === 'true'
                                : String(attributeType ?? '').trim().toLowerCase() === 'array type';
                        byAttribute.set(attributeName, {
                            isArray,
                            inputTypeCode: value.inputTypeCode,
                            typeCode: value.inputTypeCode ?? value.displayTypeLookupValue,
                            options
                        });
                    }
                    Object.values(value).forEach(visit);
                }

                visit(payload);
                return byAttribute;
            })();
        }
        return menuMetadataPromise;
    }

    function enrichMenuAttributes(data, metadata) {
        const decodeValue = value => {
            try {
                return decodeURIComponent(value);
            } catch {
                return value;
            }
        };
        const enrichOne = (attributeName, rawValue) => {
            const metadataEntry = metadata.get(attributeName);
            const options = Array.isArray(metadataEntry) ? metadataEntry : metadataEntry?.options;
            const isArray = Array.isArray(rawValue) || metadataEntry?.isArray;
            if (rawValue == null || rawValue === '') return rawValue;
            const raw = Array.isArray(rawValue) ? rawValue.map(String).join(ARRAY_SEPARATOR) : String(rawValue);
            const separator = raw.includes(MULTI_SELECT_SEPARATOR) ? MULTI_SELECT_SEPARATOR
                : raw.includes(LEGACY_MULTI_SELECT_SEPARATOR) ? LEGACY_MULTI_SELECT_SEPARATOR
                    : raw.includes(ARRAY_SEPARATOR) ? ARRAY_SEPARATOR
                        : isArray && raw.includes('&') ? '&' : null;
            const values = separator ? raw.split(separator) : [raw];
            const outputSeparator = isArray ? ARRAY_SEPARATOR
                : separator === LEGACY_MULTI_SELECT_SEPARATOR ? MULTI_SELECT_SEPARATOR : separator;
            const mapped = values.map(value => {
                const token = decodeValue(value.trim());
                const existing = parseMenuValue(token);
                const option = options?.find(item => String(item.variableName) === decodeValue(existing.key) ||
                    String(item.variableName) === token || String(item.displayName) === existing.label ||
                    String(item.displayName) === token);
                if (!option) return token;
                const variableName = option.variableName == null ? '' : String(option.variableName).trim();
                return variableName || String(option.displayName);
            });
            return outputSeparator ? mapped.join(outputSeparator) : mapped[0];
        };

        Object.keys(data).forEach(name => {
            data[name] = enrichOne(name, data[name]);
        });
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
            contextParameters,
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
        const collapsible = elements.dataImport?.closest('oj-c-collapsible');
        const content = collapsible?.querySelector('[id^="oj-collapsible-content-"]');

        let toggle = doc.getElementById('tm-toggle-tester-inputs');
        if (!toggle) {
            toggle = createButton('tm-toggle-tester-inputs', '', () => {
                testerInputsCollapsed = !testerInputsCollapsed;
                applyTesterInputState();
            });
            toggle.style.cssText = 'display:block;width:100%;margin:8px 0;padding:8px 12px;border:1px solid #505c7c;border-radius:6px;background:#282e3c;color:#e2e4ee;font:inherit;text-align:left;cursor:pointer;';
        }
        if (content) {
            if (toggle.parentElement !== content || content.firstElementChild !== toggle) {
                content.prepend(toggle);
            }
        } else if (toggle.parentElement !== anchor.parentElement || toggle.nextElementSibling !== anchor) {
            anchor.before(toggle);
        }
        setTextIfChanged(toggle, testerInputsCollapsed ? 'Show Tester Inputs' : 'Hide Tester Inputs');
        setExpandedIfChanged(toggle, !testerInputsCollapsed);
        applyTesterInputVisibility(elements);
    }

    function applyTesterInputVisibility(elements) {
        const toggle = doc.getElementById('tm-toggle-tester-inputs');
        const hideWithoutToggle = element => {
            if (!element) return;
            if (toggle && element.contains(toggle)) {
                [...element.children]
                    .filter(child => !child.contains(toggle))
                    .forEach(child => setHiddenIfChanged(child, testerInputsCollapsed));
                return;
            }
            setHiddenIfChanged(element, testerInputsCollapsed);
        };
        hideWithoutToggle(elements.dataImportRow);
        if (toggle && elements.dataImportRow?.contains(toggle)) {
            [elements.dataImport, elements.importButton].forEach(hideWithoutToggle);
        }
        [elements.contextParameters, elements.tabBar, elements.switcher].forEach(hideWithoutToggle);
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
            showActionNotice(button, `Copy failed: ${error.message}`);
        }
    }

    // ---------------------------------------------------------------------------
    // Copy for VSCode
    //
    // Copies the current BML script plus metadata to the clipboard as a JSON
    // envelope. A VS Code user task (tools/open-bml-from-clipboard.sh, setup in
    // tools/vscode-task-setup.md) reads it, creates the folder structure and
    // file under the project root, and opens it. Clipboard transport is immune
    // to page CSP and needs no extensions or credentials.
    // ---------------------------------------------------------------------------

    const VSCODE_SETTING_DEFAULTS = {
        projectRoot: '' // local folder that holds one project folder per CPQ host
    };

    function getVsCodeSettings() {
        const stored = GM_getValue('vscodeSettings', {});
        return { ...VSCODE_SETTING_DEFAULTS, ...stored };
    }

    function configureVsCodeSettings() {
        const settings = getVsCodeSettings();
        const value = prompt('Local project root folder (e.g. /Users/you/bml-projects):', settings.projectRoot ?? '');
        if (value === null) return; // cancelled; keep previously saved value
        settings.projectRoot = value.trim();
        GM_setValue('vscodeSettings', settings);
        showActionNotice(null, 'VS Code integration settings saved.', false);
    }

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Configure "Copy for VSCode"…', configureVsCodeSettings);
    }

    // --- Message field extraction (best-effort; log diagnostics when unsure) ---

    // The CPQ site host; BigTools uses this as the per-site project folder name.
    function getVsHostName() {
        return unsafeWindow.location.hostname;
    }

    // Subfolder inside the project the file belongs to, following the BigTools
    // project convention: utils/, config/<family>/<RuleCategory>/, and
    // commerce/<process>/<Category>/ (Document scripts split transaction vs
    // transactionLine). attributeName scripts on the bml-edit page carry the
    // context in plain URL params.
    const CONFIG_RULE_FOLDERS = {
        // ruleTypeCode → folder name; extend as more codes are confirmed
        1: 'Recommendations',
        2: 'Constraints',
        3: 'Hiding',
        4: 'Pricing'
    };

    function getVsFileGroup() {
        const params = new URLSearchParams(unsafeWindow.location.search);
        const type = params.get('type');
        const functionType = params.get('functionType') || '';
        if (type === 'commerce') {
            const process = params.get('process') || 'process';
            // Library functions live at the process level, not under Document.
            // They are addressed by `name` (+ isStandardFunction), with no
            // functionType — document scripts carry a functionType instead.
            if (/LIB/i.test(functionType) || (params.get('name') && !functionType)) {
                return `commerce/${process}/LibFuncs`;
            }
            const documentVar = params.get('document') || '';
            return ['commerce', process, documentVar && `Document/${documentVar}`]
                .filter(Boolean).join('/');
        }
        if (type === 'config') {
            const family = params.get('productFamily') || 'config';
            const folder = CONFIG_RULE_FOLDERS[params.get('ruleTypeCode')] || 'Rules';
            // tmRuleVar (added by the quick-edit links in general.user.js) nests
            // the rule's own folder, matching the BigTools layout exactly.
            const ruleVar = params.get('tmRuleVar');
            return ['config', family, folder, ruleVar].filter(Boolean).join('/');
        }
        return 'utils';
    }

    // The script's variable name; becomes the file name (<varName>.bml).
    // Config rule action scripts get the BigTools-style suffix.
    function getVsVarName() {
        const params = new URLSearchParams(unsafeWindow.location.search);
        const functionType = params.get('functionType') || '';
        const attributeName = params.get('attributeName');
        const ruleVar = params.get('tmRuleVar');
        const rulePrefix = ruleVar ? `${ruleVar}_` : '';
        if (attributeName && functionType === 'CONFIG_RULE_ACTION') return `${rulePrefix}${attributeName}_ConfigRuleAction`;
        if (attributeName && functionType === 'CONFIG_RULE_COND') return `${ruleVar || attributeName}_ConfigRuleCondition`;
        for (const key of ['attributeName', 'varName', 'variable_name', 'variableName', 'function_name', 'functionName', 'name']) {
            const value = params.get(key);
            if (value) return value.trim();
        }
        for (const selector of [
            'input[name="variableName"]', 'input[name="varName"]', 'input[name="variable_name"]',
            '[id*="variableName" i]', '[id*="varName" i]'
        ]) {
            const el = doc.querySelector(selector);
            const value = el?.value ?? el?.textContent;
            if (value?.trim()) return value.trim();
        }
        console.warn('[tm-vscode] varName not found. URL params:', unsafeWindow.location.search,
            'candidate inputs:', [...doc.querySelectorAll('input[name], input[id]')].slice(0, 40)
                .map(i => `${i.name || i.id}=${(i.value || '').slice(0, 40)}`));
        return '';
    }

    // The BML source code to send. Probes the editors CPQ pages are known to use.
    function getVsFileContent() {
        // CodeMirror (legacy pages attach the instance to the wrapper element)
        for (const wrapper of unsafeWindow.document.querySelectorAll('.CodeMirror')) {
            const text = wrapper.CodeMirror?.getValue?.();
            if (text?.trim()) return text;
        }
        // ACE editor
        const aceEl = unsafeWindow.document.querySelector('.ace_editor');
        if (aceEl && unsafeWindow.ace) {
            const text = unsafeWindow.ace.edit(aceEl)?.getValue?.();
            if (text?.trim()) return text;
        }
        // Monaco (Redwood pages)
        const monacoEditors = unsafeWindow.monaco?.editor?.getEditors?.() || [];
        for (const editor of monacoEditors) {
            const text = editor.getValue?.();
            if (text?.trim()) return text;
        }
        // Plain textareas: pick the largest with content
        const textareas = [...doc.querySelectorAll('textarea')]
            .map(t => ({ t, value: t.value || '' }))
            .filter(({ value }) => value.trim())
            .sort((a, b) => b.value.length - a.value.length);
        if (textareas.length) return textareas[0].value;

        console.warn('[tm-vscode] fileContent not found.',
            'CodeMirror:', unsafeWindow.document.querySelectorAll('.CodeMirror').length,
            'ace:', Boolean(aceEl), 'monaco editors:', monacoEditors.length,
            'textareas:', doc.querySelectorAll('textarea').length);
        return '';
    }

    function buildVsCodeEnvelope(settings) {
        return {
            tm: 'bigtools-open',
            projectRoot: settings.projectRoot,
            hostName: getVsHostName(),
            fileGroup: getVsFileGroup(),
            varName: getVsVarName(),
            fileExtension: '.bml',
            content: getVsFileContent()
        };
    }

    function openInVsCode(event) {
        const button = event.currentTarget;
        try {
            // projectRoot is optional: the VS Code task runs workspace-relative and
            // only falls back to the envelope's projectRoot when run elsewhere.
            const settings = getVsCodeSettings();
            const envelope = buildVsCodeEnvelope(settings);
            if (!envelope.varName) throw new Error('Could not determine the script name — see the browser console for what was probed.');
            if (!envelope.content) throw new Error('Could not read the script contents — see the browser console for what was probed.');
            GM_setClipboard(JSON.stringify(envelope), 'text');
            showActionNotice(button,
                `Copied ${envelope.varName}.bml for VS Code — run the "Open BML from clipboard" task there (⌘⇧B or your keybinding).`,
                false, true);
        } catch (error) {
            console.error('Copy for VSCode failed:', error);
            showActionNotice(button, `Copy for VSCode failed: ${error.message}`);
        }
    }

    const currentRoute = () => unsafeWindow.location.pathname;
    const isBmlEditorRoute = () => currentRoute().includes('/bml/bml-edit');
    const isPipelineViewerRoute = () => currentRoute().includes('pipeline_viewer_config.jsp');
    const isBmlLibraryRoute = () => currentRoute().includes('/spring/bmllibrary');

    function ensureBmlEditorButtons() {
        ensureTesterInputPanel();
        ensurePrintDataControl();
        if (!doc.getElementById('tm-load-tester-attributes')) {
            const anchor = doc.querySelector(PROPERTIES_BUTTON)?.closest('oj-c-button');
            anchor?.after(createButton('tm-load-tester-attributes', '📋 Load Tester Attributes', loadTesterAttributes));
        }
            if (!doc.getElementById('tm-copy-tester-attributes')) {
                const loadButton = doc.getElementById('tm-load-tester-attributes');
                loadButton?.after(createButton('tm-copy-tester-attributes', '⎘ Copy Tester Attributes', copyTesterAttributes));
            }
        if (!doc.getElementById('tm-open-in-vscode')) {
            const copyButton = doc.getElementById('tm-copy-tester-attributes');
            copyButton?.after(createButton('tm-open-in-vscode', '⧉ Copy for VSCode', openInVsCode));
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
        const copyButton = createButton('tm-copy-tester-attributes', '⎘ Copy Test Attr Values', copyDebug);
        copyButton.style.cssText += 'height: 25px;';
        pageTabs.appendChild(copyButton);
    }

    // The Spring BML Library page gets no other enhancements — just the
    // "Copy for VSCode" button, slotted into the ExtJS footer button row
    // (Validate / Apply / Update / Back), falling back to a floating button.
    function ensureBmlLibraryButton() {
        if (doc.getElementById('tm-open-in-vscode')) return;
        if (!doc.body) return;
        const button = createButton('tm-open-in-vscode', '⧉ Copy for VSCode', openInVsCode);
        const validateBtn = [...doc.querySelectorAll('.x-panel-btns button.x-btn-text')]
            .find(candidate => candidate.textContent.trim() === 'Validate');
        const buttonRow = validateBtn?.closest('td.x-panel-btn-td');
        if (buttonRow) {
            const cell = doc.createElement('td');
            cell.className = 'x-panel-btn-td';
            button.style.cssText += 'white-space:nowrap;margin-right:6px;';
            cell.append(button);
            buttonRow.before(cell);
        } else {
            button.style.cssText += 'position:fixed;right:20px;top:14px;z-index:2147483646;';
            doc.body.append(button);
        }
    }

    function initializeCurrentRoute() {
        if (isBmlEditorRoute()) ensureBmlEditorButtons();
        if (isPipelineViewerRoute()) ensurePipelineCopyButton();
        if (isBmlLibraryRoute()) ensureBmlLibraryButton();
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
