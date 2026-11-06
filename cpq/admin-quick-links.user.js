// ==UserScript==
// @name         CPQ Admin Quick Links
// @namespace    http://tampermonkey.net
// @version      1.3
// @description  Provides quick access to known configuration pages
// @author       Sven Hansen (PW)
// @match        https://*.oraclegovcloud2.com/ords/r/cx-cpq/administration/*
// @match        https://*.oraclegovcloud2.com/*
// @match        https://*.bigmachines.com/ords/r/cx-cpq/administration/*
// @match        https://*.bigmachines.com/*
// @updateURL    https://github.com/Pierce-Washington/cpq-qol-scripts-dist/raw/main/cpq/admin-quick-links.user.js
// @downloadURL  https://github.com/Pierce-Washington/cpq-qol-scripts-dist/raw/main/cpq/admin-quick-links.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @noframes
// ==/UserScript==
(function () {
    'use strict';

    // 1. Build the necessary data from what's available on the page (mostly APEX).

    const DETAIL_ABOUT = window.location.href.includes('config-detail-about');
    const COMMERCE_KEYWORDS = ['quote-detail-', 'commerce/analytics', 'steps-diagram?'];
    const COMMERCE_DETAIL = COMMERCE_KEYWORDS.some(keyword => window.location.href.includes(keyword));

    const SITE_NAME = window.location.host.split(".")[0];
    const CONFIG_MEMORY_KEY = `ConfigDir_${SITE_NAME}`;
    const COMMERCE_MEMORY_KEY = `CommerceDir_${SITE_NAME}`;

    const IN_APEX = typeof apex !== 'undefined';

    // Record which LB node served this page so the log viewer can offer node
    // switching/merging without ever having visited the log page on that node.
    // Shared with log-viewer.user.js via localStorage (GM storage is per-script).
    try {
        const nodeValue = document.cookie.split('; ').find(c => c.startsWith('APACHE_LB_NODE='))?.split('=')[1];
        if (nodeValue) {
            const nodeName = decodeURIComponent(nodeValue);
            let knownNodes = [];
            try { knownNodes = JSON.parse(localStorage.getItem('tmKnownNodes') || '[]'); } catch { /* reset */ }
            if (!Array.isArray(knownNodes)) knownNodes = [];
            if (!knownNodes.includes(nodeName)) {
                knownNodes.push(nodeName);
                localStorage.setItem('tmKnownNodes', JSON.stringify(knownNodes));
            }
        }
    } catch { /* cookie/storage unavailable; node recording is best-effort */ }

    // Process trampoline landing: a non-About process quick link routes through
    // the signed quote-detail-about link (which sets the current process
    // server-side), then we redirect to the page the user actually wanted.
    // The target is built here, from the About page's own session, so the page
    // that set the process and the page we open share one session (using the
    // clicking page's session instead yields ORA-01403 / a fresh re-auth).
    (function handleProcessTrampoline() {
        let pending;
        try { pending = JSON.parse(sessionStorage.getItem('tmProcessTrampoline') || 'null'); } catch { return; }
        if (!pending) return;
        sessionStorage.removeItem('tmProcessTrampoline');
        if (!pending.page || !/^[a-z0-9-]+$/.test(pending.page) || Date.now() - (pending.ts || 0) > 30000) return;
        const here = new URL(window.location.href);
        if (!here.pathname.endsWith('/quote-detail-about')) return;
        if (here.searchParams.get('current_process_id') !== String(pending.processId)) return;
        const session = here.searchParams.get('session');
        const target = `${here.origin}/ords/r/cx-cpq/administration/${pending.page}` +
            (session ? `?session=${encodeURIComponent(session)}` : '');
        window.location.replace(target);
    })();


    // This may be a constant, but keep it dynamic to reflect the current page context.
    // const pId = (window.location.href.match(/(p[0-9]+)_segment_id/) || [])[1];

    // Collect page data into a single object for easy access.
    // let pageData = {};
    // Select elements that have an APEX item ID structure.
    // apex.jQuery("input[id^='P'], select[id^='P'], textarea[id^='P']").each(function () {
    //     let itemId = this.id;
    //     if (itemId) {
    //         // Use apex.item API to safely fetch the value
    //         pageData[itemId] = apex.item(itemId).getValue();
    //     }
    // });


    const CONFIG_DIR = JSON.parse(GM_getValue(CONFIG_MEMORY_KEY, '{"name":"All Products","var":"AllProductFamilies","children":[]}'));

    const COMMERCE_DIR = JSON.parse(GM_getValue(COMMERCE_MEMORY_KEY, '[]'));

    // This contains the full hierarchy on config-detail-about pages.
    // It does not contain variable names, only IDs and names.
    if (IN_APEX) {
        if (apex.item('P225_JSON_DATA')) {
            const PAGE_HIERARCHY = JSON.parse(apex?.item('P225_JSON_DATA')?.getValue() || '[]');
            if (DETAIL_ABOUT && PAGE_HIERARCHY.length > 0) {
                /***********************
                 * Data comes in like so:
                [
                    {
                        type: "Family",
                        children: [
                            {
                                type: "Line",
                                children: [{
                                    type: "Model Header",
                                    children: [{
                                        type: "Model"
                                    }]
                                }]
                            }
                        ]
                    }
                ]
                */

                // This generates the Family -> Line -> Model breadcrumb at the top of the page.
                const BREADCRUMB_DETAILS = apex.item('P0_PRODUCT_FAMILY_BREADCRUMB_LINK').getValue();
                const tmpDoc = document.createElement('div');
                tmpDoc.insertAdjacentHTML('beforeend', BREADCRUMB_DETAILS);
                const breadcrumbLinks = tmpDoc.querySelectorAll('a');

                const PAGE_PRODUCT_FAMILY_VAR = apex.item('PRODUCT_FAMILY').getValue();
                const PAGE_PRODUCT_FAMILY_NAME = breadcrumbLinks[0]?.innerText;
                const PAGE_PROD_LINE_VAR = apex.item('PRODUCT_LINE').getValue();
                const PAGE_PROD_LINE_NAME = breadcrumbLinks[1]?.innerText;
                const PAGE_MODEL_VAR = apex.item('P225_BM_VARIABLE_NAME').getValue();
                const PAGE_MODEL_NAME = apex.item('P225_BM_NAME').getValue();

                // Refresh data with the hierarchy from PAGE_HIERARCHY.
                // CONFIG_DIR.children = PAGE_HIERARCHY;

                const familyInfo = PAGE_HIERARCHY[0];

                let FAMILY_DATA = CONFIG_DIR.children.find(child => child.segId === familyInfo.SegmentID);
                if (!FAMILY_DATA) {
                    CONFIG_DIR.children.push({ children: [] });
                    FAMILY_DATA = CONFIG_DIR.children[CONFIG_DIR.children.length - 1];
                    }
                FAMILY_DATA.name = familyInfo.Name;
                FAMILY_DATA.segId = familyInfo.SegmentID;
                FAMILY_DATA.var = PAGE_PRODUCT_FAMILY_VAR;
                //console.log('Processing family:', familyInfo);
                familyInfo.children.forEach((pLine) => {
                    let lineObj = FAMILY_DATA.children.find(child => child.id === pLine.Id);
                    //console.log('Processing product line:', pLine);
                    if (!lineObj) {
                        lineObj = { children: [], id: pLine.Id };
                        FAMILY_DATA.children.push(lineObj);
                    }
                    lineObj.name = pLine.Name;
                    if (pLine.Name == PAGE_PROD_LINE_NAME) {
                        lineObj.var = PAGE_PROD_LINE_VAR;
                    }

                    // Handle models.
                    pLine.children.forEach((modelHeader) => {
                        // There is an extra layer between line and model.
                        modelHeader.children.forEach((model) => {
                            let modelObj = lineObj.children.find(child => child.id === model.Id);
                            if (!modelObj) {
                                modelObj = { children: [], id: model.Id };
                                lineObj.children.push(modelObj);
                            }
                            modelObj.name = model.Name;
                            if (model.Name == PAGE_MODEL_NAME) {
                                modelObj.var = PAGE_MODEL_VAR;
                            }
                        });
                    });
                });
                GM_setValue(CONFIG_MEMORY_KEY, JSON.stringify(CONFIG_DIR));
                //console.log('Updated History:', CONFIG_DIR);
            }
        }
        if (COMMERCE_DETAIL) {
            const COMMERCE_PROCESS_NAME = apex.item('P15_PROCESS_NAME').getValue() || `Unknown Process Name (${COMMERCE_DIR.length})`;
            const COMMERCE_PROCESS_ID = apex.item('PROCESSID').getValue() || apex.item('P43_PROCESS_ID').getValue();
            const COMMERCE_PROCESS_VAR = apex.item('P15_VARIABLE_NAME').getValue() || apex.item('P43_PROCESS_VARIABLE_NAME').getValue() || apex.item('P43_CURRENT_PROCESS_VARIABLE_NAME').getValue();

            if (COMMERCE_PROCESS_ID && COMMERCE_PROCESS_VAR) {

                let COMMERCE_DATA = COMMERCE_DIR.find(child => child.id === COMMERCE_PROCESS_ID);
                if (!COMMERCE_DATA) {
                    COMMERCE_DIR.push({ id: COMMERCE_PROCESS_ID, name: COMMERCE_PROCESS_NAME, var: COMMERCE_PROCESS_VAR });
                    COMMERCE_DATA = COMMERCE_DIR[COMMERCE_DIR.length - 1];
                }
                if (COMMERCE_PROCESS_NAME.indexOf('Unknown Process Name') === -1) {
                    COMMERCE_DATA.name = COMMERCE_PROCESS_NAME;
                }
                COMMERCE_DATA.var = COMMERCE_PROCESS_VAR;
                GM_setValue(COMMERCE_MEMORY_KEY, JSON.stringify(COMMERCE_DIR));
            }
        }
    }



    // 2. Inject CSS styles.
    GM_addStyle(`
        /* Theme — edit these to restyle the sidebar */
        #tm-sidebar {
            --tm-width: 320px;
            --tm-radius: 8px;
            --tm-font-size: 16px;
            --tm-font: 'Nunito', 'Segoe UI', system-ui, -apple-system, sans-serif;

            --tm-bg: #242424;
            --tm-surface: #282e3c;
            --tm-hover: #2f3647;
            --tm-text: #e2e4ee;
            --tm-muted: #8a93ab;
            --tm-line: #505c7c;
            --tm-on-accent: #1d2130;
            --tm-shadow: rgba(0, 0, 0, 0.45);

            --tm-accent: #8b95d6;
            --tm-accent-hover: #a5adec;
            --tm-accent-soft: rgba(139, 149, 214, 0.18);
            --tm-highlight: #fdff00;
            --tm-on-highlight: #242424;
            --tm-fav: var(--tm-highlight);
            --tm-header-bg: #3c455c;
            --tm-header-text: #e2e4ee;
            --tm-match-bg: rgba(152, 136, 41, 0.55);

            --tm-family: #b3b9f0;
            --tm-family-guide: #505c7c;
            --tm-line-color: #8fc9a3;
            --tm-line-guide: #3d5a4a;
            --tm-model: #c9cfe0;

            /* Per-depth values, overridden on li[data-depth] below */
            --tm-depth-color: var(--tm-text);
            --tm-depth-guide: var(--tm-line);
            --tm-depth-weight: 400;
        }
        #tm-sidebar li[data-depth="1"] { --tm-depth-color: var(--tm-family);     --tm-depth-guide: var(--tm-family-guide); --tm-depth-weight: 700; }
        #tm-sidebar li[data-depth="2"] { --tm-depth-color: var(--tm-line-color); --tm-depth-guide: var(--tm-line-guide);   --tm-depth-weight: 600; }
        #tm-sidebar li[data-depth="3"] { --tm-depth-color: var(--tm-model);      --tm-depth-weight: 400; }

        /* Container */
        #tm-sidebar {
            position: fixed;
            top: 0;
            right: calc(-1 * var(--tm-width));
            width: var(--tm-width);
            height: 100vh;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            background: var(--tm-bg);
            color: var(--tm-text);
            font-family: var(--tm-font);
            font-size: var(--tm-font-size);
            line-height: 1.4;
            border-left: 1px solid var(--tm-line);
            box-shadow: -6px 0 24px var(--tm-shadow);
            transition: right 0.3s ease-in-out;
            z-index: 999999;
        }
        #tm-sidebar.open { right: 0; }

        /* Toggle button */
        #tm-sidebar-toggle {
            position: absolute;
            left: -40px;
            top: 20px;
            width: 40px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--tm-accent);
            color: var(--tm-on-accent);
            border: none;
            border-radius: 10px 0 0 10px;
            box-shadow: -3px 3px 10px var(--tm-shadow);
            font-size: 16px;
            cursor: grab;
            touch-action: none;
            user-select: none;
        }
        #tm-sidebar-toggle:hover { background: var(--tm-accent-hover); }
        #tm-sidebar-toggle.dragging { cursor: grabbing; }

        /* Error-log popup tab, pinned under the sidebar toggle */
        #tm-error-log-btn {
            position: absolute;
            left: -32px;
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--tm-surface);
            color: var(--tm-text);
            border: 1px solid var(--tm-line);
            border-right: none;
            border-radius: 10px 0 0 10px;
            box-shadow: -3px 3px 10px var(--tm-shadow);
            font-size: 15px;
            cursor: pointer;
            user-select: none;
        }
        #tm-error-log-btn:hover { background: var(--tm-accent); }

        /* Header & content */
        .tm-sidebar-header {
            padding: 18px 20px 14px;
            font-size: 1.1em;
            font-weight: 700;
            color: var(--tm-header-text);
            background: var(--tm-header-bg);
        }
        .tm-sidebar-content {
            flex-grow: 1;
            overflow-y: auto;
        }

        /* Drawers */
        .tm-section { border-bottom: 1px solid var(--tm-line); }
        .tm-section-header {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            padding: 10px 18px;
            background: var(--tm-surface);
            color: var(--tm-text);
            border: none;
            font: inherit;
            font-size: 0.8em;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            text-align: left;
            cursor: pointer;
        }
        .tm-section-header:hover { background: var(--tm-hover); }
        .tm-section-caret {
            color: var(--tm-muted);
            font-size: 9px;
            transition: transform 0.15s;
        }
        .tm-section:not(.collapsed) .tm-section-caret { transform: rotate(90deg); }
        .tm-section-body { padding: 12px 18px 16px; }
        .tm-section.collapsed > .tm-section-body { display: none; }
        .tm-empty-message { display: none; color: var(--tm-muted); font-size: 0.85em; }
        .tm-section.tm-empty .tm-toolbar,
        .tm-section.tm-empty .tm-tree { display: none; }
        .tm-section.tm-empty .tm-empty-message { display: block; }
        .tm-group-label {
            flex: 1;
            color: var(--tm-depth-color);
            font-size: 0.9em;
            font-weight: var(--tm-depth-weight);
            cursor: pointer;
            user-select: none;
        }
        .tm-fav-btn {
            flex: 0 0 auto;
            margin-left: auto;
            padding: 0 2px;
            background: none;
            border: none;
            color: var(--tm-muted);
            font-size: 0.85em;
            cursor: pointer;
            opacity: 0;
        }
        .tm-tree-row:hover > .tm-fav-btn,
        .tm-fav-btn.active,
        .tm-fav-btn:focus-visible { opacity: 1; }
        @media (hover: none) {
            .tm-fav-btn { opacity: 1; }
        }
        .tm-fav-btn.active { color: var(--tm-fav); }
        .tm-fav-btn:hover { color: var(--tm-fav); }
        .tm-custom-form {
            display: grid;
            gap: 6px;
            margin-bottom: 12px;
        }
        .tm-custom-form[hidden] { display: none; }
        .tm-custom-form .tm-search-input { width: 100%; }
        .tm-custom-form button { justify-self: start; width: auto; padding: 6px 10px; }
        .tm-custom-error { color: var(--tm-highlight); font-size: 0.85em; }
        .tm-custom-error:empty { display: none; }
        .tm-delete-btn { margin-left: 0; }
        .tm-tree-row:hover > .tm-delete-btn { opacity: 1; }

        /* Toolbar: search + expand/collapse */
        .tm-toolbar {
            display: flex;
            gap: 6px;
            margin-bottom: 12px;
        }
        .tm-search-input,
        .tm-tree-action {
            box-sizing: border-box;
            background: var(--tm-surface);
            border: 1px solid var(--tm-line);
            border-radius: var(--tm-radius);
            outline: none;
        }
        .tm-search-input {
            flex: 1;
            min-width: 0;
            padding: 6px 10px;
            color: var(--tm-text);
            font-size: 0.9em;
        }
        .tm-search-input:focus {
            border-color: var(--tm-accent);
            box-shadow: 0 0 0 3px var(--tm-accent-soft);
        }
        .tm-tree-action {
            width: 30px;
            color: var(--tm-muted);
            font-size: 14px;
            cursor: pointer;
        }
        .tm-tree-action:hover {
            color: var(--tm-accent);
            border-color: var(--tm-accent);
        }

        /* Tree */
        .tm-tree, .tm-tree ul {
            list-style: none;
            margin: 0;
            padding: 0;
        }
        .tm-tree ul {
            margin-left: 7px;
            padding-left: 14px;
            border-left: 2px solid var(--tm-depth-guide);
        }
        .tm-tree li[data-depth="0"] > ul {
            margin-left: 0;
            padding-left: 0;
            border-left: none;
        }
        .tm-tree li.collapsed > ul,
        .tm-tree li.collapsed > .tm-detail-links,
        .tm-tree li.tm-hidden { display: none; }

        .tm-tree-row {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 3px 4px;
            border-radius: 6px;
        }
        .tm-tree-row:hover { background: var(--tm-hover); }

        .tm-tree-caret {
            flex: 0 0 16px;
            padding: 0;
            background: none;
            border: none;
            color: var(--tm-muted);
            font-size: 9px;
            cursor: pointer;
            transition: transform 0.15s;
        }
        .tm-tree-caret:disabled { visibility: hidden; }
        .tm-tree li:not(.collapsed) > .tm-tree-row > .tm-tree-caret { transform: rotate(90deg); }

        .tm-tree-row > a,
        .tm-tree-row > .tm-inactive {
            font-size: 0.9em;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .tm-tree-row > a {
            color: var(--tm-depth-color);
            font-weight: var(--tm-depth-weight);
            text-decoration: none;
        }
        .tm-tree-row > a:hover {
            text-decoration: underline;
            text-decoration-color: var(--tm-accent);
        }
        .tm-tree-row > a.tm-current {
            color: var(--tm-highlight);
            font-weight: 700;
        }
        .tm-tree-row > .tm-inactive {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            color: var(--tm-muted);
            font-style: italic;
            cursor: not-allowed;
        }
        .tm-inactive-icon {
            font-size: 0.85em;
            font-style: normal;
        }
        .tm-tree .tm-match {
            padding: 0 2px;
            background: var(--tm-match-bg);
            border-radius: 3px;
        }

        /* Detail page pills: Attrs / Actions / Rules / Flows */
        .tm-detail-links {
            display: flex;
            flex-wrap: nowrap;
            gap: 3px;
            margin: 1px 0 4px 24px;
        }
        .tm-tree li[data-depth="0"] > .tm-detail-links { margin-left: 4px; }
        .tm-detail-links a {
            padding: 1px 6px;
            font-size: 0.68em;
            font-weight: 600;
            line-height: 1.5;
            white-space: nowrap;
            text-decoration: none;
            color: var(--tm-accent);
            background: var(--tm-accent-soft);
            border-radius: 999px;
        }
        .tm-detail-links a:hover {
            color: var(--tm-on-accent);
            background: var(--tm-accent);
        }
        .tm-detail-links a.tm-current {
            color: var(--tm-on-highlight);
            background: var(--tm-highlight);
        }

        .tm-deploy-btn {
            flex: 0 0 auto;
            padding: 0 6px;
            font: inherit;
            font-size: 0.68em;
            font-weight: 600;
            line-height: 1.5;
            color: var(--tm-accent);
            background: transparent;
            border: 1px solid var(--tm-accent);
            border-radius: 999px;
            cursor: pointer;
        }
        .tm-deploy-btn:hover,
        .tm-deploy-btn:focus-visible {
            color: var(--tm-highlight);
            border-color: var(--tm-highlight);
            outline: none;
        }

        /* Push the page's native right-hand drawer (e.g. deployment center) left of the open sidebar */
        .ui-dialog--drawer { transition: right 0.3s ease-in-out; }
        /* px must match --tm-width on #tm-sidebar */
        body:has(#tm-sidebar.open) div.ui-dialog--apex.rw-DrawerDialog--pulloutEnd { right: 320px!important; }
    `);

    // 3. Create DOM structure.
    const sidebar = document.createElement('div');
    sidebar.id = 'tm-sidebar';

    sidebar.innerHTML = `
        <button id="tm-sidebar-toggle">◀</button>
        <div class="tm-sidebar-header">Quick Links</div>
        <div class="tm-sidebar-content">
            <section class="tm-section" data-section="admin">
                <button type="button" class="tm-section-header"><span class="tm-section-caret">▶</span>Admin</button>
                <div class="tm-section-body">
                    <div class="tm-toolbar">
                        <input type="search" id="tm-admin-search" class="tm-search-input" placeholder="Search admin links...">
                        <button type="button" id="tm-add-link" class="tm-tree-action" title="Add custom link" aria-label="Add custom link">+</button>
                    </div>
                    <form id="tm-custom-form" class="tm-custom-form" hidden>
                        <input class="tm-search-input" name="label" placeholder="Link name" aria-label="Link name">
                        <input class="tm-search-input" name="url" placeholder="URL on this site" aria-label="URL on this site">
                        <span class="tm-custom-error" role="alert"></span>
                        <button type="submit" class="tm-tree-action">Add link</button>
                    </form>
                    <ul id="tm-admin-links" class="tm-tree"></ul>
                </div>
            </section>
            <section class="tm-section" data-section="process">
                <button type="button" class="tm-section-header"><span class="tm-section-caret">▶</span>Process Quick Links</button>
                <div class="tm-section-body">
                    <div class="tm-empty-message">No data yet.  Visit a commerce process page to discover quick links.</div>
                    <ul id="tm-process-links" class="tm-tree"></ul>
                </div>
            </section>
            <section class="tm-section" data-section="config">
                <button type="button" class="tm-section-header"><span class="tm-section-caret">▶</span>Config Quick Links</button>
                <div class="tm-section-body">
                    <div class="tm-empty-message">No data yet.  Visit a configuration detail page (config-detail-.*) to discover quick links.</div>
                    <div class="tm-toolbar">
                        <input type="search" id="tm-search" class="tm-search-input" placeholder="Search name or var...">
                        <button type="button" id="tm-expand-all" class="tm-tree-action" title="Expand all">⊞</button>
                        <button type="button" id="tm-collapse-all" class="tm-tree-action" title="Collapse all">⊟</button>
                    </div>
                    <ul id="tm-tree" class="tm-tree"></ul>
                </div>
            </section>
        </div>
    `;
    document.body.appendChild(sidebar);

    /**
     * This can be hacked to perform regardless of page but it does require a few pieces.  These are what Apex uses to form the url params
     * APP_PAGE_ID = p_flow_step_id = 225 for a model page (seemignly constant across site)
     * APP_ID = p_flow_id (varies per page)
     * APP_SESSION = p_instance (varies per page)
     */
    function deployProductFamily(productFamily) {
        const prevEnv = JSON.stringify(apex.env);
        apex.env.APP_PAGE_ID = 225; // example assignment, adjust as needed
        apex.server.process('getCatalogDefDeploymentCenterURL', {}, {
            dataType: 'text',
            success: function (url) {
                apex.env.APP_PAGE_ID = JSON.parse(prevEnv).APP_PAGE_ID; // restore previous environment
                //this URL will be built to match our desired product family by replacing a url param
                //shape: #action$a-dialog-open?url=...config-deployment-center%3Fp61_prod_fam_var_name%3D<family>%26debug%3DNO%26session%3D<session>%26dialogCs%3D<checksum>&appId=...&pageId=61&tmpl=DRAWER&...

                const updatedFamilyURL = url.replace(/p61_prod_fam_var_name%3D.+?(?=%26)+/, `p61_prod_fam_var_name%3D${encodeURIComponent(productFamily)}`);
                apex.navigation.redirect(updatedFamilyURL);
            }
        });
    }

    // 4. Element and logic wiring.
    const toggleBtn = sidebar.querySelector('#tm-sidebar-toggle');
    const treeContainer = sidebar.querySelector('#tm-tree');
    const searchInput = sidebar.querySelector('#tm-search');
    const adminLinksContainer = sidebar.querySelector('#tm-admin-links');
    const adminSearchInput = sidebar.querySelector('#tm-admin-search');
    const processLinksContainer = sidebar.querySelector('#tm-process-links');

    sidebar.querySelector('[data-section="config"]').classList.toggle('tm-empty', !CONFIG_DIR.children?.length);
    sidebar.querySelector('[data-section="process"]').classList.toggle('tm-empty', !COMMERCE_DIR.some(process => process?.id));

    // Section and process group state persists across pages
    const SECTION_STATE_KEY = `sectionState_${SITE_NAME}`;
    const sectionState = JSON.parse(GM_getValue(SECTION_STATE_KEY, '{}'));
    const expandedProcesses = new Set(Array.isArray(sectionState.processGroups) ? sectionState.processGroups : []);
    function saveSectionState() {
        sectionState.processGroups = [...expandedProcesses];
        delete sectionState.sidebarOpen;
        GM_setValue(SECTION_STATE_KEY, JSON.stringify(sectionState));
    }

    function setSidebarOpen(open) {
        sidebar.classList.toggle('open', open);
        toggleBtn.textContent = open ? '▶' : '◀';
    }

    sidebar.querySelectorAll('.tm-section').forEach(section => {
        const key = section.dataset.section;
        section.classList.toggle('collapsed', !!sectionState[key]);
        section.querySelector('.tm-section-header').addEventListener('click', () => {
            sectionState[key] = section.classList.toggle('collapsed');
            if (key === 'process' && !sectionState[key]) refreshSuggestedProcessLinks();
            saveSectionState();
        });
    });

    sidebar.addEventListener('click', (event) => {
        const link = event.target.closest('a[href]');
        const section = link?.closest('.tm-section');
        if (!section) return;
        section.classList.remove('collapsed');
        sectionState[section.dataset.section] = false;
        const processGroup = link.closest('#tm-process-links > li[data-process-id]');
        if (processGroup) {
            processGroup.classList.remove('collapsed');
            expandedProcesses.add(processGroup.dataset.processId);
        }
        saveSectionState();
    });

    const ORDS = '/ords/r/cx-cpq/administration/';
    const PROCESS_PAGES = [
        ['About', 'quote-detail-about'],
        ['Manage Transaction', 'quote-detail-transaction'],
        ['Manage Transaction Line', 'quote-detail-transaction-line'],
        ['Views and Templates', 'quote-detail-templates'],
        ['Steps', 'steps-diagram']
//        ['Integrations', 'quote-detail-integration']
    ];

    function processHref(page, params = {}) {
        const url = new URL(page, window.location.origin);
        Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
        if (IN_APEX && apex?.env?.APP_SESSION && url.pathname.startsWith('/ords/')) {
            url.searchParams.set('session', apex.env.APP_SESSION);
        }
        return url.pathname + url.search;
    }

    const suggestedProcessLinks = [];

    // The process we're currently "inside" (its pages take plain links already).
    const CURRENT_PROCESS_ID = IN_APEX ? String(
        apex.item('PROCESSID')?.getValue() ||
        apex.item('P43_PROCESS_ID')?.getValue() || '') : '';

    function tmSession() {
        return (IN_APEX && apex?.env?.APP_SESSION) ? String(apex.env.APP_SESSION) : null;
    }

    // Signed quote-detail-about links are only rendered on pages that happen to
    // "suggest" them. Persist them (scoped to the APEX session) so a process
    // stays reachable after navigating away, instead of forcing a trip
    // through the Processes list.
    const SIGNED_LINKS_KEY = `tmSignedProcessLinks_${SITE_NAME}`;
    function loadSignedProcessLinks() {
        const session = tmSession();
        try {
            const data = JSON.parse(localStorage.getItem(SIGNED_LINKS_KEY) || 'null');
            if (data && data.processes && (!session || data.session === session)) return data;
        } catch { /* reset */ }
        return { session, processes: {} };
    }
    let signedLinkStore = loadSignedProcessLinks();

    function signedProcessHref(page, processId) {
        for (const suggestion of document.querySelectorAll('a.rw-AO-SuggestionItem-link[href]')) {
            const url = new URL(suggestion.href, window.location.href);
            if (url.origin !== window.location.origin || url.pathname !== `${ORDS}${page}` || !url.searchParams.get('cs')) continue;
            if (IN_APEX && apex?.env?.APP_SESSION && url.searchParams.get('session') !== String(apex.env.APP_SESSION)) continue;
            const currentId = url.searchParams.get('current_process_id');
            const processParam = url.searchParams.get('processid');
            if ((currentId || processParam) && (!currentId || currentId === String(processId)) &&
                (!processParam || processParam === String(processId))) return suggestion.href;
        }
        return null;
    }

    // Harvest any signed About links on this page into the session-scoped cache.
    (function harvestSignedAboutLinks() {
        signedLinkStore.session = tmSession();
        let changed = false;
        // Scan directly (signedProcessHref requires a known processId).
        for (const suggestion of document.querySelectorAll('a.rw-AO-SuggestionItem-link[href]')) {
            let url;
            try { url = new URL(suggestion.href, window.location.href); } catch { continue; }
            if (url.origin !== window.location.origin || url.pathname !== `${ORDS}quote-detail-about`) continue;
            if (!url.searchParams.get('cs')) continue;
            const session = tmSession();
            if (session && url.searchParams.get('session') && url.searchParams.get('session') !== session) continue;
            const pid = url.searchParams.get('current_process_id');
            if (!pid) continue;
            if (signedLinkStore.processes[pid]?.about !== suggestion.href) {
                signedLinkStore.processes[pid] = { about: suggestion.href };
                changed = true;
            }
        }
        if (changed) {
            try { localStorage.setItem(SIGNED_LINKS_KEY, JSON.stringify(signedLinkStore)); } catch { /* best effort */ }
        }
    })();

    // A signed About link, from the current DOM or the persisted cache. It both
    // navigates in and sets the current process server-side.
    function signedAboutHref(processId) {
        return signedProcessHref('quote-detail-about', processId) ||
            signedLinkStore.processes[String(processId)]?.about || null;
    }

    function makeProcessLink(text, page, processId) {
        const pid = String(processId);
        // Already inside this process: plain (session-only) links work directly.
        if (pid && pid === CURRENT_PROCESS_ID) {
            const a = document.createElement('a');
            a.textContent = text;
            a.href = processHref(`${ORDS}${page}`);
            return a;
        }
        if (page === 'quote-detail-about') {
            const href = signedAboutHref(processId);
            if (href) {
                const a = document.createElement('a');
                a.textContent = text;
                a.href = href;
                return a;
            }
        } else {
            // Rare: a signed link for this exact page is on the current page.
            const direct = signedProcessHref(page, processId);
            if (direct) {
                const a = document.createElement('a');
                a.textContent = text;
                a.href = direct;
                return a;
            }
            // Otherwise trampoline through About, which sets the process, then
            // redirect to the target (see handleProcessTrampoline at the top).
            const about = signedAboutHref(processId);
            if (about) {
                const a = document.createElement('a');
                a.textContent = text;
                a.href = about;
                a.title = `Selects the process, then opens ${text}`;
                a.addEventListener('click', () => {
                    try {
                        sessionStorage.setItem('tmProcessTrampoline', JSON.stringify({
                            processId: pid, page, ts: Date.now()
                        }));
                    } catch { /* best effort; falls back to landing on About */ }
                });
                return a;
            }
        }
        const span = document.createElement('span');
        span.className = 'tm-inactive';
        span.textContent = text;
        span.title = 'Visit this process once (via Commerce › Processes) to enable direct navigation';
        return span;
    }

    function refreshSuggestedProcessLinks() {
        signedLinkStore = loadSignedProcessLinks();
        suggestedProcessLinks.forEach(({ row, text, page, processId }) => {
            row.replaceChildren(makeProcessLink(text, page, processId));
        });
    }

    COMMERCE_DIR.slice().sort((left, right) => (left.name || '').localeCompare(right.name || '')).forEach(process => {
        if (!process?.id) return;
        const groupLi = document.createElement('li');
        groupLi.dataset.depth = 1;
        groupLi.dataset.processId = String(process.id);
        groupLi.classList.toggle('collapsed', !expandedProcesses.has(groupLi.dataset.processId));
        const row = document.createElement('div');
        row.className = 'tm-tree-row';
        const caret = document.createElement('button');
        caret.type = 'button';
        caret.className = 'tm-tree-caret';
        caret.textContent = '▶';
        const label = document.createElement('span');
        label.className = 'tm-group-label';
        label.textContent = process.name || process.var || String(process.id);
        row.append(caret, label);
        [caret, label].forEach(element => element.addEventListener('click', () => {
            if (groupLi.classList.toggle('collapsed')) {
                expandedProcesses.delete(groupLi.dataset.processId);
            } else {
                expandedProcesses.add(groupLi.dataset.processId);
            }
            saveSectionState();
        }));

        const links = document.createElement('ul');
        const addProcessLink = (text, page, params) => {
            const item = document.createElement('li');
            item.dataset.depth = 3;
            const linkRow = document.createElement('div');
            linkRow.className = 'tm-tree-row';
            const link = document.createElement('a');
            link.href = processHref(page, params);
            link.textContent = text;
            linkRow.append(link);
            item.append(linkRow);
            links.append(item);
        };

        PROCESS_PAGES.forEach(([text, page]) => {
            const item = document.createElement('li');
            item.dataset.depth = 3;
            const linkRow = document.createElement('div');
            linkRow.className = 'tm-tree-row';
            item.append(linkRow);
            links.append(item);
            suggestedProcessLinks.push({ row: linkRow, text, page, processId: process.id });
        });
        // Requires checksum.
        //addProcessLink('Steps', `${ORDS}steps-diagram`, { p500_process_id: process.id });
        // addProcessLink('Formulas', '/cpq/admin/formulas/formula-management.ftl', {
        //     process_id: process.id, process_name: process.name || ''
        // });
        // addProcessLink('Analytics', '/cpq/admin/commerce/analytics/list_analytics.jsp', { process_id: process.id });
        // if (process.var) {
        //     addProcessLink('Shopping Cart', '/cpq/admin/commerce/shopping-cart', { processVarName: process.var });
        // }
        addProcessLink('Quotes', `/fscmUI/redwood/cx-cpq/application/container/quotes`, { process: process.var });
        groupLi.append(row, links);
        processLinksContainer.append(groupLi);
    });
    refreshSuggestedProcessLinks();

    // Host-relative paths; session/checksum params are stripped because they are per-login.
    const DETAIL_NAV = `${ORDS}detail-navigation?clear=239&p239_target_page=`;
    const ADMIN_LINKS = {
        'Legacy Links': [
            ['Util Library', '/cpq/admin/bmllib/list_functions.jsp?_bm_trail_refresh_=true'],
            ['Doc Designer', '/cpq/admin/document-designer'],
            ['Commerce Process', '/cpq/admin/commerce/processes/list_processes.jsp?_bm_trail_refresh_=true']
        ],
        'Products': [
            ['Products', `${ORDS}product-workbench`],
            ['BOM', '/cpq/admin/configuration/admin_bom.jsp'],
            ['Eligibility Rules', '/cpq/admin/pages/productEligibilityList'],
            ['Part Custom Fields', '/cpq/admin/customattributes/list_fields.jsp?ref_type=1'],
            ['Parts', '/cpq/admin/parts/manage_parts.jsp?_bm_trail_refresh_=true'],
            ['Intelligence Portal', `${ORDS}intelligence-portal`]
        ],
        'Configurations': [
            ['Configurations', `${ORDS}config-dashboard`],
            ['Favorites List', '/cpq/admin/ui/branding/commercelist/update_commerce_list.jsp'],
            ['Home Page', '/cpq/admin/homepage/setup_home_page.jsp'],
            // Home Page Flows needs a site-specific dir_id — add it per site via Custom Links
            ['Page Templates', '/cpq/admin/ui/branding/list_templated_pages.jsp']
        ],
        'Prices': [
            ['Prices', '/cpq/admin/pricing/portal'],
            ['Price Models', '/cpq/admin/pricing/models'],
            ['Price Agreements', '/cpq/admin/pricing/agreements'],
            ['Rate Cards', '/cpq/admin/pricing/ratecards'],
            ['Pricing Preview', '/cpq/admin/pricing/preview'],
            ['Pricing Rules', '/cpq/admin/pricing/rules'],
            ['Pricing Attributes', '/cpq/admin/pricing/attributes'],
            ['Agreement Attributes', '/cpq/admin/pricing/agreementAttributes'],
            ['Pricing Matrix Templates', '/cpq/admin/pricing/matrixTemplates'],
            ['Charge Definitions', '/cpq/admin/pricing/chargeDefinitions'],
            ['Pricing Options', '/cpq/admin/pricing/options']
        ],
        'Commerce': [
            ['Processes', `${ORDS}processes`],
            ['Process Invocation', '/cpq/admin/commerce/processes/list_pages.jsp?_bm_trail_refresh_=true'],
            ['Assets', '/cpq/admin/customattributes/list_cust_attrs.jsp?ref_type=5']
        ],
        'Users': [
            ['Users', '/cpq/admin/users/list_users.jsp?_bm_trail_refresh_=true'],
            ['Host Company', '/cpq/admin/company/edit_company.jsp'],
            ['Partner Organizations', '/cpq/admin/company/list_external_companies.jsp'],
            ['Single Sign-On', '/cpq/admin/sso/edit_sso_settings.jsp'],
            ['Groups', `${ORDS}groups`],
            ['Integration Users', `${ORDS}integration-users`]
        ],
        'Integrations': [
            ['Integrations', '/cpq/admin/integration/edit'],
            ['XML Integration', '/cpq/admin/ui/branding/edit_wm_integration_settings.jsp'],
            ['Interface Catalogs', '/cpq/admin/interfaceCatalogs/list_ics_resources.jsp'],
            ['Web Services', '/cpq/admin/webservices/test_soap_api.jsp'],
            ['Accounts', '/cpq/admin/accounts/list_accounts.jsp?_bm_trail_refresh_=true']
        ],
        'Developer Tools & Utilities': [
            ['Data Tables', '/cpq/admin/data-tables'],
            ['Migration', '/fscmUI/redwood/cx-cpq/application/container/migration']
        ],
        'Logs': [
            ['Administration Logs', '/cpq/adminaudit/view_admin_logs.jsp'],
            ['Error Logs', '/cpq/admin/log/edit_logging_properties.jsp'],
            ['Performance Logs', '/cpq/admin/pages/performanceLogsList']
        ],
        'Development Tools': [
            ['BML Library', '/fscmUI/redwood/cx-cpq/application/container/bml'],
            ['Global Search on BML', '/cpq/admin/scripts/search_script.jsp'],
            ['Developer Toolkit CLI', '/cpq/admin/dev-toolkit/index'],
            ['Performance Reviewer', '/cpq/admin/pages/perfReviewReportsList'],
            ['Implementation Report', '/cpq/admin/pages/custReportsList'],
            ['File Manager', '/cpq/admin/filemanager/list_files.jsp']
        ],
        'Bulk Data Services': [
            ['Download', '/cpq/admin/bulkservices/list_entities.jsp?target=admin-home'],
            ['Download Status', '/cpq/admin/bulkservices/list_download_status.jsp'],
            ['Upload', '/cpq/admin/bulkservices/list_upload_files.jsp?target=admin-home'],
            ['Upload Status', '/cpq/admin/bulkservices/list_upload_status.jsp']
        ],
        'Settings & Preferences': [
            ['Countries And States', '/cpq/admin/address/edit_country.jsp'],
            ['Email Signature', '/cpq/admin/ui/branding/edit_email_signature.jsp'],
            ['Configuration Settings', '/cpq/admin/ui/branding/edit_configuration_settings.jsp'],
            ['Quotes Settings', '/cpq/admin/ui/branding/edit_commerce_settings.jsp'],
            ['Integration Settings', '/cpq/admin/ui/branding/edit_wm_integration_settings.jsp'],
            ['General Settings', '/cpq/admin/ui/branding/edit_site_settings.jsp'],
            ['Text Administration', '/cpq/admin/ui/branding/list_site_text.jsp'],
            ['Lookups', '/cpq/admin/lookups'],
            ['UI Designer', '/cpq/admin/ui-designer/list']
        ],
        'Styles And Templates': [
            ['Global Header Branding', '/cpq/admin/branding/edit'],
            ['Header And Footer', '/cpq/admin/ui/branding/edit_header_footer.jsp'],
            ['Navigation Menus', '/cpq/admin/navigation/list_navigations.jsp'],
            ['Stylesheet', '/cpq/admin/ui/branding/edit_site_branding.jsp'],
            ['Custom Fonts', '/fscmUI/redwood/cx-cpq/application/container/setup/custom-fonts-list']
        ]
    };

    function adminHref(path) {
        if (!path.startsWith('/ords/') || (IN_APEX && !apex?.env?.APP_SESSION)) return path;
        const url = new URL(path, window.location.origin);
        if (IN_APEX) url.searchParams.set('session', apex?.env.APP_SESSION);
        return url.pathname + url.search;
    }

    const FAV_KEY = `adminFavorites_${SITE_NAME}`;
    const FAV_GROUP = 'Favorites';
    const CUSTOM_GROUP = 'Custom Links';
    const CUSTOM_KEY = `customLinks_${SITE_NAME}`;
    let customLinks = JSON.parse(GM_getValue(CUSTOM_KEY, '[]'));
    let adminFavorites = JSON.parse(GM_getValue(FAV_KEY, '[]'));
    const expandedGroups = new Set();
    const customForm = sidebar.querySelector('#tm-custom-form');

    function customPath(value) {
        const url = new URL(value, window.location.origin);
        if (!value.startsWith('/') && !/^https?:\/\//i.test(value) || !['http:', 'https:'].includes(url.protocol)) {
            throw new Error('Enter an HTTP(S) URL or a path starting with /.');
        }
        return url.origin === window.location.origin ? url.pathname + url.search + url.hash : url.href;
    }

    const linkKey = (category, text) => `${category}|${text}`;
    const isCurrentPath = (path) => new URL(path, window.location.origin).pathname === window.location.pathname;

    const ADMIN_ITEMS = new Map();
    Object.entries(ADMIN_LINKS).forEach(([category, links]) => {
        links.forEach(([text, path]) => {
            ADMIN_ITEMS.set(linkKey(category, text), { category, text, path });
            if (isCurrentPath(path)) expandedGroups.add(category);
        });
    });
    customLinks.forEach(({ text, path }) => {
        ADMIN_ITEMS.set(linkKey(CUSTOM_GROUP, text), { category: CUSTOM_GROUP, text, path });
    });

    sidebar.querySelector('#tm-add-link').addEventListener('click', () => {
        customForm.hidden = !customForm.hidden;
        if (!customForm.hidden) customForm.elements.label.focus();
    });

    customForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const text = customForm.elements.label.value.trim();
        const urlValue = customForm.elements.url.value.trim();
        const error = customForm.querySelector('.tm-custom-error');
        try {
            if (!text) {
                throw new Error('Enter a link name.');
            }
            if (!urlValue) {
                throw new Error('Enter a URL.');
            }
            if (customLinks.some(link => link.text.toLowerCase() === text.toLowerCase())) {
                throw new Error('Enter a unique link name.');
            }
            const path = customPath(urlValue);
            customLinks.push({ text, path });
            ADMIN_ITEMS.set(linkKey(CUSTOM_GROUP, text), { category: CUSTOM_GROUP, text, path });
            GM_setValue(CUSTOM_KEY, JSON.stringify(customLinks));
            expandedGroups.add(CUSTOM_GROUP);
            error.textContent = '';
            customForm.reset();
            customForm.hidden = true;
            renderAdminLinks();
        } catch (validationError) {
            error.textContent = validationError.message;
        }
    });

    function deleteCustomLink(text) {
        const key = linkKey(CUSTOM_GROUP, text);
        customLinks = customLinks.filter(link => link.text !== text);
        adminFavorites = adminFavorites.filter(favorite => favorite !== key);
        ADMIN_ITEMS.delete(key);
        GM_setValue(CUSTOM_KEY, JSON.stringify(customLinks));
        GM_setValue(FAV_KEY, JSON.stringify(adminFavorites));
        renderAdminLinks();
    }

    function toggleFavorite(key) {
        adminFavorites = adminFavorites.includes(key)
            ? adminFavorites.filter(k => k !== key)
            : [...adminFavorites, key];
        GM_setValue(FAV_KEY, JSON.stringify(adminFavorites));
        renderAdminLinks();
    }

    function buildAdminGroup(name, items, isFavorites) {
        const groupLi = document.createElement('li');
        groupLi.dataset.depth = 1;
        groupLi.dataset.group = name;
        if (!isFavorites && !expandedGroups.has(name)) groupLi.classList.add('collapsed');

        const row = document.createElement('div');
        row.className = 'tm-tree-row';
        const caret = document.createElement('button');
        caret.className = 'tm-tree-caret';
        caret.type = 'button';
        caret.textContent = '▶';
        const label = document.createElement('span');
        label.className = 'tm-group-label';
        label.textContent = isFavorites ? `★ ${name}` : name;
        row.append(caret, label);

        if (isFavorites) {
            caret.remove();
        } else {
            [caret, label].forEach(el => el.addEventListener('click', () => {
                const collapsed = groupLi.classList.toggle('collapsed');
                collapsed ? expandedGroups.delete(name) : expandedGroups.add(name);
            }));
        }

        const ul = document.createElement('ul');
        items.forEach(({ category, text, path }) => {
            const key = linkKey(category, text);
            const li = document.createElement('li');
            li.dataset.depth = 3;
            li.dataset.search = `${text} ${category}`.toLowerCase();

            const linkRow = document.createElement('div');
            linkRow.className = 'tm-tree-row';
            const a = document.createElement('a');
            a.href = adminHref(path);
            a.textContent = text;
            a.title = isFavorites ? `${category} › ${text}` : text;
            if (isCurrentPath(path)) a.classList.add('tm-current');

            const fav = document.createElement('button');
            fav.type = 'button';
            fav.className = 'tm-fav-btn';
            fav.classList.toggle('active', isFavorites);
            fav.textContent = isFavorites ? '★' : '☆';
            fav.title = isFavorites ? 'Remove from favorites' : 'Add to favorites';
            fav.addEventListener('click', () => toggleFavorite(key));

            linkRow.append(a, fav);
            if (category === CUSTOM_GROUP) {
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'tm-fav-btn tm-delete-btn';
                remove.textContent = '×';
                remove.title = `Delete ${text}`;
                remove.setAttribute('aria-label', `Delete ${text}`);
                remove.addEventListener('click', () => deleteCustomLink(text));
                linkRow.append(remove);
            }
            li.appendChild(linkRow);
            ul.appendChild(li);
        });

        groupLi.append(row, ul);
        return groupLi;
    }

    function renderAdminLinks() {
        adminLinksContainer.replaceChildren();

        const favItems = adminFavorites.map(key => ADMIN_ITEMS.get(key)).filter(Boolean);
        if (favItems.length) adminLinksContainer.appendChild(buildAdminGroup(FAV_GROUP, favItems, true));

        Object.entries(ADMIN_LINKS).forEach(([category, links]) => {
            const items = links
                .filter(([text]) => !adminFavorites.includes(linkKey(category, text)))
                .map(([text]) => ADMIN_ITEMS.get(linkKey(category, text)));
            if (items.length) adminLinksContainer.appendChild(buildAdminGroup(category, items, false));
        });
        const customItems = customLinks
            .filter(({ text }) => !adminFavorites.includes(linkKey(CUSTOM_GROUP, text)))
            .map(({ text }) => ADMIN_ITEMS.get(linkKey(CUSTOM_GROUP, text)));
        if (customItems.length) adminLinksContainer.appendChild(buildAdminGroup(CUSTOM_GROUP, customItems, false));

        applyAdminFilter();
    }

    function applyAdminFilter() {
        const query = adminSearchInput.value.trim().toLowerCase();
        adminLinksContainer.querySelectorAll(':scope > li').forEach(groupLi => {
            const name = groupLi.dataset.group;
            const groupMatch = !!query && name.toLowerCase().includes(query);
            let anyVisible = false;

            groupLi.querySelectorAll(':scope > ul > li').forEach(li => {
                const selfMatch = !!query && li.dataset.search.includes(query);
                const visible = !query || groupMatch || selfMatch;
                li.classList.toggle('tm-hidden', !visible);
                li.querySelector('a').classList.toggle('tm-match', selfMatch);
                if (visible) anyVisible = true;
            });

            groupLi.classList.toggle('tm-hidden', !anyVisible);
            if (query) {
                groupLi.classList.remove('collapsed');
            } else if (name !== FAV_GROUP) {
                groupLi.classList.toggle('collapsed', !expandedGroups.has(name));
            }
        });
    }

    adminSearchInput.addEventListener('input', applyAdminFilter);
    renderAdminLinks();

    const BASE_PATH = '/ords/r/cx-cpq/administration/';
    const URL_PARAMS = new URLSearchParams(window.location.search);

    function buildUrl(page, params) {
        const query = new URLSearchParams(params);
        if (IN_APEX && apex?.env?.APP_SESSION) query.set('session', apex.env.APP_SESSION);
        const qs = query.toString();
        // query.set('debug', 'LEVEL2');
        //console.log('Building URL with params:', qs, 'for page:', page);
        return `${BASE_PATH}${page}${qs ? '?' + qs : ''}`;
    }

    // depth: 0 = root, 1 = family, 2 = line, 3 = model
    function getNodeUrl(node, depth, family, line) {
        switch (depth) {
            case 0:
                return buildUrl('config-dashboard', {});
            case 1:
                return buildUrl('config-detail-about', { product_family: node.var });
            case 2:
                return buildUrl('config-detail-about', { product_family: family.var, product_line: node.var });
            default:
                return buildUrl('config-detail-about', { product_family: family.var, product_line: line.var, model: node.var });
        }
    }

    const DETAIL_PAGES = [
        { label: 'Attrs', page: 'config-detail-attributes' },
        //{ label: 'Actions', page: 'config-detail-actions' },
        { label: 'Rules', page: 'config-detail-rules' },
        { label: 'Flows', page: 'config-detail-flows' }
    ];

    // Returns null when a required variable name hasn't been captured yet
    function getDetailParams(node, depth, family, line) {
        switch (depth) {
            case 0:
                return node.var ? { product_family: node.var } : null;
            case 1:
                return node.var ? { product_family: node.var } : null;
            case 2:
                return family?.var && node.var ? { product_family: family.var, product_line: node.var } : null;
            default:
                return family?.var && line?.var && node.var
                    ? { product_family: family.var, product_line: line.var, model: node.var }
                    : null;
        }
    }

    function isCurrentParams(params) {
        return ['product_family', 'product_line', 'model'].every(key => (params[key] || null) === URL_PARAMS.get(key));
    }

    function isCurrentNode(node, depth) {
        if (DETAIL_ABOUT) return depth === 3 && !!node.var && node.var === URL_PARAMS.get('model');
        const pId = URL_PARAMS.get('p215_id');
        if (!pId) return false;
        if (depth === 1) return String(node.segId) === pId;
        return depth > 1 && String(node.id) === pId;
    }

    // Config favorites are per-site, since CONFIG_DIR is per-site
    const CONFIG_FAV_KEY = `ConfigFavorites_${SITE_NAME}`;
    let configFavorites = JSON.parse(GM_getValue(CONFIG_FAV_KEY, '[]'));

    const nodeKey = (node, depth) => `${depth}:${node.segId ?? node.id ?? node.var}`;

    const CONFIG_INDEX = new Map();
    (function indexNode(node, depth, family, line, trail) {
        const path = depth > 0 ? [...trail, node.name || node.var] : [];
        CONFIG_INDEX.set(nodeKey(node, depth), { node, depth, family, line, path });
        (node.children || []).forEach(child => indexNode(
            child, depth + 1,
            depth === 1 ? node : family,
            depth === 2 ? node : line,
            path
        ));
    })(CONFIG_DIR, 0, null, null, []);

    function toggleConfigFavorite(key) {
        configFavorites = configFavorites.includes(key)
            ? configFavorites.filter(k => k !== key)
            : [...configFavorites, key];
        GM_setValue(CONFIG_FAV_KEY, JSON.stringify(configFavorites));
        renderConfigTree();
    }

    function renderConfigTree() {
        const expanded = new Set(
            [...treeContainer.querySelectorAll('li[data-key]:not(.collapsed)')].map(li => li.dataset.key)
        );
        treeContainer.replaceChildren();

        const favEntries = configFavorites.map(key => CONFIG_INDEX.get(key)).filter(Boolean);
        if (favEntries.length) {
            const favLi = document.createElement('li');
            favLi.dataset.depth = 0;
            favLi.dataset.favorites = 'true';
            favLi.dataset.search = '';
            favLi.dataset.defaultCollapsed = 'false';
            const row = document.createElement('div');
            row.className = 'tm-tree-row';
            const label = document.createElement('span');
            label.className = 'tm-group-label';
            label.textContent = '★ Favorites';
            row.append(label);
            const favUl = document.createElement('ul');
            favLi.append(row, favUl);
            treeContainer.appendChild(favLi);

            favEntries.forEach(({ node, depth, family, line, path }) => {
                renderNode(node, depth, favUl, family, line, depth === 3);
                const favLink = favUl.lastElementChild.querySelector(':scope > .tm-tree-row > a, :scope > .tm-tree-row > .tm-inactive');
                favLink.title = path.join(' › ');
            });
        }

        renderNode(CONFIG_DIR, 0, treeContainer, null, null);

        treeContainer.querySelectorAll('li[data-key]').forEach(li => {
            if (expanded.has(li.dataset.key)) li.classList.remove('collapsed');
        });
        if (searchInput.value.trim()) applyConfigFilter();
    }

    // Returns true if this node or a descendant is the current page, so that path stays expanded
    // pinned: always expanded with no caret (favorited models)
    function renderNode(node, depth, parentUl, family, line, pinned = false) {
        const li = document.createElement('li');
        const row = document.createElement('div');
        row.className = 'tm-tree-row';

        const caret = document.createElement('button');
        caret.className = 'tm-tree-caret';
        caret.type = 'button';
        caret.textContent = '▶';

        const label = node.name || node.var || String(node.id ?? node.segId ?? '');
        const detailParams = getDetailParams(node, depth, family, line);
        // Root always links to the dashboard; other levels need the full var chain
        const isActive = depth === 0 || !!detailParams;

        let link;
        if (isActive) {
            link = document.createElement('a');
            link.href = getNodeUrl(node, depth, family, line);
            link.textContent = label;
            link.title = label;
        } else {
            link = document.createElement('span');
            link.className = 'tm-inactive';
            link.title = `${label} — variable name not captured yet; visit its About page to enable`;
            const icon = document.createElement('span');
            icon.className = 'tm-inactive-icon';
            icon.textContent = '⊘';
            link.append(icon, document.createTextNode(label));
        }

        li.dataset.search = `${node.name || ''} ${node.var || ''}`.toLowerCase();
        li.dataset.depth = depth;
        li.dataset.key = nodeKey(node, depth);
        if (depth > 0 && !pinned) row.append(caret);
        row.append(link);
        if (depth === 1 && IN_APEX) {
            const deploy = document.createElement('button');
            deploy.type = 'button';
            deploy.className = 'tm-deploy-btn';
            deploy.textContent = 'Deploy';
            deploy.title = `Deploy ${label}`;
            deploy.addEventListener('click', () => deployProductFamily(node.var));
            row.append(deploy);
        }
        if (depth > 0) {
            const isFav = configFavorites.includes(li.dataset.key);
            const fav = document.createElement('button');
            fav.type = 'button';
            fav.className = 'tm-fav-btn';
            fav.classList.toggle('active', isFav);
            fav.textContent = isFav ? '★' : '☆';
            fav.title = isFav ? 'Remove from favorites' : 'Add to favorites';
            fav.addEventListener('click', () => toggleConfigFavorite(li.dataset.key));
            row.append(fav);
        }
        li.appendChild(row);
        parentUl.appendChild(li);

        const isCurrent = isCurrentNode(node, depth);
        if (isCurrent) link.classList.add('tm-current');

        let onDetailPage = false;
        if (detailParams) {
            const detailRow = document.createElement('div');
            detailRow.className = 'tm-detail-links';
            const paramsMatch = isCurrentParams(detailParams);
            DETAIL_PAGES.forEach(({ label, page }) => {
                const a = document.createElement('a');
                a.href = buildUrl(page, detailParams);
                a.textContent = label;
                if (paramsMatch && window.location.pathname.endsWith(page)) {
                    a.classList.add('tm-current');
                    onDetailPage = true;
                }
                detailRow.appendChild(a);
            });
            li.appendChild(detailRow);
        }

        const children = node.children || [];
        let containsCurrent = onDetailPage;
        if (children.length) {
            const childUl = document.createElement('ul');
            li.appendChild(childUl);
            const nextFamily = depth === 1 ? node : family;
            const nextLine = depth === 2 ? node : line;
            children
                .filter(child => !configFavorites.includes(nodeKey(child, depth + 1)))
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                .forEach(child => {
                    if (renderNode(child, depth + 1, childUl, nextFamily, nextLine)) containsCurrent = true;
                });
        }

        if (depth > 0 && (children.length || detailParams)) {
            caret.addEventListener('click', () => li.classList.toggle('collapsed'));
        } else {
            caret.disabled = true;
        }

        if (pinned) li.dataset.pinned = 'true';
        if (depth > 0 && !pinned && !containsCurrent) li.classList.add('collapsed');
        li.dataset.defaultCollapsed = li.classList.contains('collapsed');
        return isCurrent || containsCurrent;
    }

    renderConfigTree();

    // Returns whether this li or a descendant matches; ancestors of matches are expanded
    function filterNode(li, query, ancestorMatched) {
        const selfMatch = !!query && li.dataset.search.includes(query);
        let descendantMatch = false;
        li.querySelectorAll(':scope > ul > li').forEach(child => {
            if (filterNode(child, query, ancestorMatched || selfMatch)) descendantMatch = true;
        });

        const label = li.querySelector(':scope > .tm-tree-row > a, :scope > .tm-tree-row > .tm-inactive, :scope > .tm-tree-row > .tm-group-label');
        label.classList.toggle('tm-match', selfMatch);

        if (!query) {
            li.classList.remove('tm-hidden');
            li.classList.toggle('collapsed', li.dataset.defaultCollapsed === 'true');
            return false;
        }

        const isRoot = li.parentElement === treeContainer;
        const alwaysShown = isRoot && !li.dataset.favorites;
        li.classList.toggle('tm-hidden', !(alwaysShown || selfMatch || descendantMatch || ancestorMatched));
        li.classList.toggle('collapsed', !isRoot && !li.dataset.pinned && !descendantMatch);
        return selfMatch || descendantMatch;
    }

    function applyConfigFilter() {
        const query = searchInput.value.trim().toLowerCase();
        treeContainer.querySelectorAll(':scope > li').forEach(li => filterNode(li, query, false));
    }

    searchInput.addEventListener('input', applyConfigFilter);

    sidebar.querySelector('#tm-expand-all').addEventListener('click', () => {
        treeContainer.querySelectorAll('li').forEach(li => li.classList.remove('collapsed'));
    });

    sidebar.querySelector('#tm-collapse-all').addEventListener('click', () => {
        treeContainer.querySelectorAll('li:not([data-depth="0"]):not([data-pinned])').forEach(li => li.classList.add('collapsed'));
    });

    // Toggle button: vertical drag to reposition, click to open/close
    const TOGGLE_POS_KEY = `toggleTop_${SITE_NAME}`;
    const DRAG_THRESHOLD = 4;

    function clampTop(top) {
        return Math.max(0, Math.min(window.innerHeight - toggleBtn.offsetHeight, top));
    }

    // Error-log tab rides along under the (draggable) sidebar toggle.
    // log-viewer.user.js auto-loads the file named in tmLastLogFile (shared via
    // localStorage) when it sees the empty GET template, defaulting to bm.log.
    const errorLogBtn = document.createElement('button');
    errorLogBtn.type = 'button';
    errorLogBtn.id = 'tm-error-log-btn';
    errorLogBtn.textContent = '📜';
    function lastLogFile() {
        return localStorage.getItem('tmLastLogFile') || 'bm.log';
    }
    function refreshErrorLogTitle() {
        const label = `Open ${lastLogFile()} in a new tab`;
        errorLogBtn.title = label;
        errorLogBtn.setAttribute('aria-label', label);
    }
    refreshErrorLogTitle();
    errorLogBtn.addEventListener('mouseenter', refreshErrorLogTitle);
    errorLogBtn.addEventListener('click', () => {
        // Same call the log viewer makes to refresh: log_file.jsp fails without a fileName
        window.open(`/cpq/admin/log/log_file.jsp?fileName=${encodeURIComponent(lastLogFile())}`, '_blank');
    });
    sidebar.appendChild(errorLogBtn);

    function positionErrorLogBtn() {
        errorLogBtn.style.top = `${toggleBtn.offsetTop + toggleBtn.offsetHeight + 6}px`;
    }

    const savedTop = parseInt(GM_getValue(TOGGLE_POS_KEY, ''), 10);
    if (!Number.isNaN(savedTop)) toggleBtn.style.top = `${clampTop(savedTop)}px`;
    positionErrorLogBtn();

    let dragStartY = 0;
    let dragStartTop = 0;
    let dragged = false;

    toggleBtn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        dragStartY = e.clientY;
        dragStartTop = toggleBtn.offsetTop;
        dragged = false;
        toggleBtn.setPointerCapture(e.pointerId);
    });

    toggleBtn.addEventListener('pointermove', (e) => {
        if (!toggleBtn.hasPointerCapture(e.pointerId)) return;
        const delta = e.clientY - dragStartY;
        if (!dragged && Math.abs(delta) < DRAG_THRESHOLD) return;
        dragged = true;
        toggleBtn.classList.add('dragging');
        toggleBtn.style.top = `${clampTop(dragStartTop + delta)}px`;
        positionErrorLogBtn();
    });

    toggleBtn.addEventListener('pointerup', (e) => {
        if (!toggleBtn.hasPointerCapture(e.pointerId)) return;
        toggleBtn.releasePointerCapture(e.pointerId);
        toggleBtn.classList.remove('dragging');
        if (dragged) {
            GM_setValue(TOGGLE_POS_KEY, String(toggleBtn.offsetTop));
        }
    });

    toggleBtn.addEventListener('click', () => {
        // Suppress the click that follows a drag
        if (dragged) {
            dragged = false;
            return;
        }
        if (!sidebar.classList.contains('open')) refreshSuggestedProcessLinks();
        setSidebarOpen(!sidebar.classList.contains('open'));
    });

    window.addEventListener('resize', () => {
        toggleBtn.style.top = `${clampTop(toggleBtn.offsetTop)}px`;
        positionErrorLogBtn();
    });

})();