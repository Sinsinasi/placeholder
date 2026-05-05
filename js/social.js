/**
 * Social — multi-brand page-management tool.
 * One Brand = one identity (e.g. "Cooking", "Tech reviews"). Each brand can
 * enable any of TikTok / Instagram / YouTube. Per platform, the user manages:
 *   - Account info: handle, URL, connected email, recovery email/phone, 2FA, cadence,
 *     follower count, niche, goals
 *   - Current focus: free text — what they're working on right now
 *   - Ideas: a backlog of content ideas with status (idea / drafting / ready / posted / abandoned)
 *   - Notes: free text — anything else (collabs, hashtags, lessons learned)
 *
 * Storage keys:
 *   was_social_brands         — brand objects with nested platforms
 *   was_active_social_brand   — id of active brand
 *   was_active_social_platform — 'tiktok' | 'instagram' | 'youtube'
 */
const Social = (function () {
    'use strict';

    const BRANDS_KEY = 'was_social_brands';
    const ACTIVE_BRAND_KEY = 'was_active_social_brand';
    const ACTIVE_PLATFORM_KEY = 'was_active_social_platform';

    const PLATFORMS = [
        { id: 'tiktok', label: 'TikTok' },
        { id: 'instagram', label: 'Instagram' },
        { id: 'youtube', label: 'YouTube' }
    ];

    const STATUS_LABELS = {
        idea: 'Idea',
        drafting: 'Drafting',
        ready: 'Ready',
        posted: 'Posted',
        abandoned: 'Abandoned'
    };

    // ── Storage ─────────────────────────────────────────────────────────

    function loadBrands() {
        try {
            const raw = localStorage.getItem(BRANDS_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) { return []; }
    }
    function saveBrands(brands) {
        localStorage.setItem(BRANDS_KEY, JSON.stringify(brands));
    }

    function getActiveBrandId() { return localStorage.getItem(ACTIVE_BRAND_KEY) || null; }
    function setActiveBrandId(id) {
        if (id) localStorage.setItem(ACTIVE_BRAND_KEY, id);
        else localStorage.removeItem(ACTIVE_BRAND_KEY);
    }
    function getActivePlatform() { return localStorage.getItem(ACTIVE_PLATFORM_KEY) || null; }
    function setActivePlatform(p) {
        if (p) localStorage.setItem(ACTIVE_PLATFORM_KEY, p);
        else localStorage.removeItem(ACTIVE_PLATFORM_KEY);
    }

    function defaultPlatform() {
        return {
            enabled: true,
            handle: '', url: '',
            email: '', recoveryEmail: '', recoveryPhone: '',
            twoFactor: '',
            cadence: '',
            currentFollowers: 0,
            niche: '',
            goals: '',
            currentFocus: '',
            notes: '',
            ideas: [] // [{ id, title, details, status, createdAt }]
        };
    }

    function defaultPlatforms() {
        return {
            tiktok:    defaultPlatform(),
            instagram: defaultPlatform(),
            youtube:   defaultPlatform()
        };
    }

    /** Backfill missing fields on a platform object so older brands work. */
    function ensurePlatformShape(p) {
        if (!p) return defaultPlatform();
        const def = defaultPlatform();
        for (const k in def) {
            if (!Object.prototype.hasOwnProperty.call(p, k)) p[k] = def[k];
        }
        if (!Array.isArray(p.ideas)) p.ideas = [];
        return p;
    }

    function ensureBrandShape(b) {
        if (!b.platforms) b.platforms = defaultPlatforms();
        for (let i = 0; i < PLATFORMS.length; i++) {
            const id = PLATFORMS[i].id;
            if (!b.platforms[id]) b.platforms[id] = defaultPlatform();
            ensurePlatformShape(b.platforms[id]);
            if (typeof b.platforms[id].enabled !== 'boolean') b.platforms[id].enabled = true;
        }
    }

    function findBrand(id) {
        const list = loadBrands();
        for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
    }

    function activeBrand() { return findBrand(getActiveBrandId()); }

    function firstEnabledPlatform(brand) {
        if (!brand || !brand.platforms) return null;
        for (let i = 0; i < PLATFORMS.length; i++) {
            const p = PLATFORMS[i].id;
            if (brand.platforms[p] && brand.platforms[p].enabled) return p;
        }
        return null;
    }

    // ── DOM helpers ─────────────────────────────────────────────────────

    function el(id) { return document.getElementById(id); }
    function escapeHtml(str) {
        if (!str) return '';
        const d = document.createElement('div');
        d.appendChild(document.createTextNode(str));
        return d.innerHTML;
    }
    function escapeAttr(str) {
        if (str == null) return '';
        return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /** Mutate the active platform's data via a function and persist. */
    function updateActivePlatform(mutator) {
        const brandId = getActiveBrandId();
        const platform = getActivePlatform();
        if (!brandId || !platform) return;
        const brands = loadBrands();
        for (let i = 0; i < brands.length; i++) {
            if (brands[i].id === brandId) {
                ensureBrandShape(brands[i]);
                mutator(brands[i].platforms[platform], brands[i]);
                break;
            }
        }
        saveBrands(brands);
    }

    function getActivePlatformData() {
        const b = activeBrand();
        const p = getActivePlatform();
        if (!b || !p || !b.platforms[p]) return null;
        return b.platforms[p];
    }

    // ── Rendering: brand filter ─────────────────────────────────────────

    function renderBrandFilter() {
        const sel = el('social-brand-filter');
        if (!sel) return;
        const brands = loadBrands();
        const activeId = getActiveBrandId();
        sel.innerHTML = '';
        if (brands.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'No brands yet';
            sel.appendChild(opt);
            sel.disabled = true;
            return;
        }
        sel.disabled = false;
        for (let i = 0; i < brands.length; i++) {
            const opt = document.createElement('option');
            opt.value = brands[i].id;
            opt.textContent = brands[i].name;
            if (brands[i].id === activeId) opt.selected = true;
            sel.appendChild(opt);
        }
    }

    // ── Rendering: platform tabs ───────────────────────────────────────

    function renderTabs() {
        const container = el('social-tabs');
        if (!container) return;
        const brand = activeBrand();
        if (!brand) { container.innerHTML = ''; return; }

        const activeP = getActivePlatform();
        let html = '';
        for (let i = 0; i < PLATFORMS.length; i++) {
            const p = PLATFORMS[i];
            const enabled = brand.platforms && brand.platforms[p.id] && brand.platforms[p.id].enabled;
            if (!enabled) continue;
            const isActive = p.id === activeP ? ' active' : '';
            html += '<button class="social-tab' + isActive + '" data-platform="' + p.id + '" type="button">'
                + p.label + '</button>';
        }
        container.innerHTML = html;
    }

    // ── Rendering: profile / focus / notes ─────────────────────────────

    function renderProfile() {
        const data = getActivePlatformData();
        if (!data) return;
        el('social-handle').value = data.handle || '';
        el('social-url').value = data.url || '';
        el('social-email').value = data.email || '';
        el('social-recovery-email').value = data.recoveryEmail || '';
        el('social-recovery-phone').value = data.recoveryPhone || '';
        el('social-twofa').value = data.twoFactor || '';
        el('social-cadence').value = data.cadence || '';
        el('social-followers').value = data.currentFollowers || 0;
        el('social-niche').value = data.niche || '';
        el('social-goals').value = data.goals || '';

        const visit = el('social-visit-link');
        if (visit) {
            if (data.url) {
                visit.href = data.url;
                visit.style.display = '';
            } else {
                visit.style.display = 'none';
            }
        }
    }

    function renderFocus() {
        const data = getActivePlatformData();
        const ta = el('social-focus');
        if (ta && data) ta.value = data.currentFocus || '';
    }

    function renderNotes() {
        const data = getActivePlatformData();
        const ta = el('social-notes');
        if (ta && data) ta.value = data.notes || '';
    }

    function handleSaveProfile() {
        updateActivePlatform(function (p) {
            p.handle = el('social-handle').value.trim();
            p.url = el('social-url').value.trim();
            p.email = el('social-email').value.trim();
            p.recoveryEmail = el('social-recovery-email').value.trim();
            p.recoveryPhone = el('social-recovery-phone').value.trim();
            p.twoFactor = el('social-twofa').value.trim();
            p.cadence = el('social-cadence').value.trim();
            p.currentFollowers = parseInt(el('social-followers').value, 10) || 0;
            p.niche = el('social-niche').value.trim();
            p.goals = el('social-goals').value;
        });
        if (typeof App !== 'undefined' && App.toast) App.toast('Account info saved.', 'success');
        renderProfile();
    }

    function handleSaveFocus() {
        const value = el('social-focus').value;
        updateActivePlatform(function (p) { p.currentFocus = value; });
        if (typeof App !== 'undefined' && App.toast) App.toast('Saved.', 'success');
    }

    function handleSaveNotes() {
        const value = el('social-notes').value;
        updateActivePlatform(function (p) { p.notes = value; });
        if (typeof App !== 'undefined' && App.toast) App.toast('Notes saved.', 'success');
    }

    // ── Ideas list ─────────────────────────────────────────────────────

    function renderIdeas() {
        const list = el('social-ideas-list');
        const empty = el('social-ideas-empty');
        if (!list) return;
        const data = getActivePlatformData();
        const ideas = data && data.ideas ? data.ideas : [];

        if (ideas.length === 0) {
            list.innerHTML = '';
            if (empty) empty.style.display = '';
            return;
        }
        if (empty) empty.style.display = 'none';

        // Sort: non-abandoned first, then by createdAt desc
        const sorted = ideas.slice().sort(function (a, b) {
            const aDone = (a.status === 'posted' || a.status === 'abandoned') ? 1 : 0;
            const bDone = (b.status === 'posted' || b.status === 'abandoned') ? 1 : 0;
            if (aDone !== bDone) return aDone - bDone;
            return (b.createdAt || '').localeCompare(a.createdAt || '');
        });

        let html = '';
        for (let i = 0; i < sorted.length; i++) {
            const idea = sorted[i];
            const statusLabel = STATUS_LABELS[idea.status] || 'Idea';
            const isMuted = idea.status === 'posted' || idea.status === 'abandoned';
            const detailsHtml = idea.details
                ? '<div class="social-idea-details">' + escapeHtml(idea.details) + '</div>'
                : '';
            html += '<div class="social-idea' + (isMuted ? ' social-idea-muted' : '') + '" data-id="' + idea.id + '">'
                + '<div class="social-idea-row">'
                +   '<div class="social-idea-text">'
                +     '<div class="social-idea-title">' + escapeHtml(idea.title || '(untitled)') + '</div>'
                +     detailsHtml
                +   '</div>'
                +   '<span class="social-idea-status status-' + idea.status + '">' + statusLabel + '</span>'
                +   '<div class="social-idea-actions">'
                +     '<button class="btn-icon" data-action="edit" data-id="' + idea.id + '" title="Edit">'
                +       '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
                +     '</button>'
                +     '<button class="btn-icon" data-action="delete" data-id="' + idea.id + '" title="Delete">'
                +       '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7c-1 0-2-1-2-2V6"/></svg>'
                +     '</button>'
                +   '</div>'
                + '</div>'
                + '</div>';
        }
        list.innerHTML = html;
    }

    function resetIdeaForm() {
        const f = el('social-idea-form');
        if (f) f.reset();
        el('social-idea-id').value = '';
        el('social-idea-status').value = 'idea';
        el('social-idea-modal-title').textContent = 'Add Idea';
    }

    function openAddIdea() {
        if (!getActivePlatformData()) {
            if (typeof App !== 'undefined' && App.toast) App.toast('Pick a brand and platform first.', 'error');
            return;
        }
        resetIdeaForm();
        if (typeof App !== 'undefined' && App.showModal) App.showModal('social-idea-modal');
        setTimeout(function () {
            const t = el('social-idea-title');
            if (t) t.focus();
        }, 80);
    }

    function openEditIdea(id) {
        const data = getActivePlatformData();
        if (!data) return;
        const idea = (data.ideas || []).find(function (x) { return x.id === id; });
        if (!idea) return;
        resetIdeaForm();
        el('social-idea-modal-title').textContent = 'Edit Idea';
        el('social-idea-id').value = idea.id;
        el('social-idea-title').value = idea.title || '';
        el('social-idea-details').value = idea.details || '';
        el('social-idea-status').value = idea.status || 'idea';
        if (typeof App !== 'undefined' && App.showModal) App.showModal('social-idea-modal');
    }

    function handleIdeaSubmit(e) {
        e.preventDefault();
        const id = el('social-idea-id').value;
        const title = el('social-idea-title').value.trim();
        const details = el('social-idea-details').value.trim();
        const status = el('social-idea-status').value || 'idea';
        if (!title) {
            if (typeof App !== 'undefined' && App.toast) App.toast('Add a title.', 'error');
            return;
        }
        updateActivePlatform(function (p) {
            if (!Array.isArray(p.ideas)) p.ideas = [];
            if (id) {
                for (let i = 0; i < p.ideas.length; i++) {
                    if (p.ideas[i].id === id) {
                        p.ideas[i].title = title;
                        p.ideas[i].details = details;
                        p.ideas[i].status = status;
                        break;
                    }
                }
            } else {
                p.ideas.push({
                    id: App.generateId(),
                    title: title,
                    details: details,
                    status: status,
                    createdAt: new Date().toISOString()
                });
            }
        });
        if (typeof App !== 'undefined') {
            if (App.toast) App.toast(id ? 'Idea updated.' : 'Idea added.', 'success');
            if (App.closeModal) App.closeModal('social-idea-modal');
        }
        renderIdeas();
    }

    function deleteIdea(id) {
        if (!confirm('Delete this idea?')) return;
        updateActivePlatform(function (p) {
            p.ideas = (p.ideas || []).filter(function (x) { return x.id !== id; });
        });
        if (typeof App !== 'undefined' && App.toast) App.toast('Idea deleted.', 'success');
        renderIdeas();
    }

    // ── Master render ─────────────────────────────────────────────────

    function render() {
        renderBrandFilter();
        const brand = activeBrand();

        const empty = el('social-empty');
        const content = el('social-brand-content');
        if (!brand) {
            if (empty) empty.style.display = '';
            if (content) content.style.display = 'none';
            return;
        }
        if (empty) empty.style.display = 'none';
        if (content) content.style.display = '';

        ensureBrandShape(brand);
        let p = getActivePlatform();
        if (!p || !brand.platforms[p] || !brand.platforms[p].enabled) {
            p = firstEnabledPlatform(brand);
            setActivePlatform(p);
        }

        const platformView = el('social-platform-view');
        if (!p) {
            if (platformView) platformView.style.display = 'none';
            renderTabs();
            return;
        }
        if (platformView) platformView.style.display = '';

        renderTabs();
        renderProfile();
        renderFocus();
        renderIdeas();
        renderNotes();
    }

    // ── Brand manager modal ───────────────────────────────────────────

    function openBrandManager() {
        renderBrandManagerList();
        if (typeof App !== 'undefined' && App.showModal) App.showModal('social-brand-modal');
    }

    function renderBrandManagerList() {
        const container = el('social-brand-list');
        if (!container) return;
        const brands = loadBrands();
        let html = '';
        for (let i = 0; i < brands.length; i++) {
            const b = brands[i];
            ensureBrandShape(b);
            html += '<div class="social-brand-item" data-brand-id="' + b.id + '">'
                + '<input type="text" class="input social-brand-input" value="' + escapeAttr(b.name) + '" placeholder="Brand name">'
                + '<div class="social-brand-platforms">';
            for (let j = 0; j < PLATFORMS.length; j++) {
                const pl = PLATFORMS[j];
                const checked = b.platforms[pl.id] && b.platforms[pl.id].enabled ? ' checked' : '';
                html += '<label class="social-brand-plat-toggle"><input type="checkbox" data-platform="' + pl.id + '"' + checked + '>'
                    + '<span>' + pl.label + '</span></label>';
            }
            html += '</div>'
                + '<button class="btn-icon btn-danger-icon" data-action="delete-brand" title="Delete brand">'
                + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7c-1 0-2-1-2-2V6"/></svg>'
                + '</button>'
                + '</div>';
        }
        if (brands.length === 0) {
            html = '<div class="empty-state-mini" style="padding: 12px 0; color: var(--text-muted)">No brands yet. Add one above.</div>';
        }
        container.innerHTML = html;
    }

    function handleBrandAdd() {
        const input = el('social-brand-new');
        if (!input) return;
        const name = input.value.trim();
        if (!name) return;
        const brands = loadBrands();
        const newBrand = { id: App.generateId(), name: name, platforms: defaultPlatforms() };
        brands.push(newBrand);
        saveBrands(brands);
        // If this is the first brand, make it active immediately so Save is idempotent
        if (brands.length === 1) {
            setActiveBrandId(newBrand.id);
            setActivePlatform(firstEnabledPlatform(newBrand));
        }
        input.value = '';
        renderBrandManagerList();
    }

    function handleBrandListClick(e) {
        const btn = e.target.closest('[data-action="delete-brand"]');
        if (!btn) return;
        const item = btn.closest('.social-brand-item');
        if (!item) return;
        const brandId = item.getAttribute('data-brand-id');
        const brand = findBrand(brandId);
        const name = brand ? brand.name : 'this brand';
        if (!confirm('Delete brand "' + name + '"? All info (account details, focus, ideas, notes) for this brand will be erased.')) return;

        const remainingBrands = loadBrands().filter(function (b) { return b.id !== brandId; });
        saveBrands(remainingBrands);
        if (getActiveBrandId() === brandId) {
            setActiveBrandId(remainingBrands.length > 0 ? remainingBrands[0].id : null);
        }
        renderBrandManagerList();
    }

    function handleBrandSave() {
        const container = el('social-brand-list');
        if (!container) return;
        const items = container.querySelectorAll('.social-brand-item');
        const brands = loadBrands();
        for (let i = 0; i < items.length; i++) {
            const id = items[i].getAttribute('data-brand-id');
            const newName = items[i].querySelector('.social-brand-input').value.trim();
            const checks = items[i].querySelectorAll('input[type="checkbox"][data-platform]');
            for (let j = 0; j < brands.length; j++) {
                if (brands[j].id === id) {
                    if (newName) brands[j].name = newName;
                    ensureBrandShape(brands[j]);
                    for (let k = 0; k < checks.length; k++) {
                        const platform = checks[k].getAttribute('data-platform');
                        brands[j].platforms[platform].enabled = !!checks[k].checked;
                    }
                    break;
                }
            }
        }
        saveBrands(brands);
        if (typeof App !== 'undefined') {
            if (App.toast) App.toast('Brands saved.', 'success');
            if (App.closeModal) App.closeModal('social-brand-modal');
        }
        const ab = activeBrand();
        if (ab) {
            const fp = firstEnabledPlatform(ab);
            if (fp) setActivePlatform(fp);
        }
        if (!getActiveBrandId()) {
            const list = loadBrands();
            if (list.length > 0) setActiveBrandId(list[0].id);
        }
        render();
    }

    // ── Event binding ────────────────────────────────────────────────

    function bindEvents() {
        const brandFilter = el('social-brand-filter');
        if (brandFilter) brandFilter.addEventListener('change', function () {
            setActiveBrandId(this.value);
            const ab = activeBrand();
            setActivePlatform(firstEnabledPlatform(ab));
            render();
        });

        const manageBtn = el('social-manage-brands-btn');
        if (manageBtn) manageBtn.addEventListener('click', openBrandManager);

        const emptyAddBtn = el('social-empty-add-btn');
        if (emptyAddBtn) emptyAddBtn.addEventListener('click', openBrandManager);

        const brandAddBtn = el('social-brand-add-btn');
        if (brandAddBtn) brandAddBtn.addEventListener('click', handleBrandAdd);

        const brandNewInput = el('social-brand-new');
        if (brandNewInput) {
            brandNewInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); handleBrandAdd(); }
            });
        }

        const brandList = el('social-brand-list');
        if (brandList) brandList.addEventListener('click', handleBrandListClick);

        const brandSaveBtn = el('social-brand-save-btn');
        if (brandSaveBtn) brandSaveBtn.addEventListener('click', handleBrandSave);

        // Tabs
        const tabsContainer = el('social-tabs');
        if (tabsContainer) tabsContainer.addEventListener('click', function (e) {
            const t = e.target.closest('.social-tab');
            if (!t) return;
            const platform = t.getAttribute('data-platform');
            if (!platform) return;
            setActivePlatform(platform);
            render();
        });

        // Profile, focus, notes save buttons
        const saveProfileBtn = el('social-save-profile-btn');
        if (saveProfileBtn) saveProfileBtn.addEventListener('click', handleSaveProfile);

        const saveFocusBtn = el('social-save-focus-btn');
        if (saveFocusBtn) saveFocusBtn.addEventListener('click', handleSaveFocus);

        const saveNotesBtn = el('social-save-notes-btn');
        if (saveNotesBtn) saveNotesBtn.addEventListener('click', handleSaveNotes);

        // Ideas
        const addIdeaBtn = el('social-add-idea-btn');
        if (addIdeaBtn) addIdeaBtn.addEventListener('click', openAddIdea);

        const ideaForm = el('social-idea-form');
        if (ideaForm) ideaForm.addEventListener('submit', handleIdeaSubmit);

        const ideasList = el('social-ideas-list');
        if (ideasList) ideasList.addEventListener('click', function (e) {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.getAttribute('data-action');
            const ideaId = btn.getAttribute('data-id');
            if (action === 'edit') openEditIdea(ideaId);
            else if (action === 'delete') deleteIdea(ideaId);
        });
    }

    // ── Init ────────────────────────────────────────────────────────

    function init() {
        // Backfill shape on existing brands
        const brands = loadBrands();
        let mutated = false;
        for (let i = 0; i < brands.length; i++) {
            const before = JSON.stringify(brands[i]);
            ensureBrandShape(brands[i]);
            if (JSON.stringify(brands[i]) !== before) mutated = true;
        }
        if (mutated) saveBrands(brands);

        const activeId = getActiveBrandId();
        if (!activeId || !brands.some(function (b) { return b.id === activeId; })) {
            setActiveBrandId(brands.length > 0 ? brands[0].id : null);
        }
        const ab = activeBrand();
        if (ab) {
            const p = getActivePlatform();
            if (!p || !ab.platforms[p] || !ab.platforms[p].enabled) {
                setActivePlatform(firstEnabledPlatform(ab));
            }
        }

        bindEvents();
        render();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return { init, render, loadBrands, saveBrands };
})();
