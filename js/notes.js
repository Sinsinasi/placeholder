/**
 * Notes.js - Enhanced Google Keep-style notes module
 * Supports: text notes, checklist notes, labels, pinning, colors,
 * masonry layout, inline quick-add, and rich card previews.
 * Uses localStorage key "was_notes" and "was_note_labels".
 */
var Notes = (function () {
    'use strict';

    var STORAGE_KEY = 'was_notes';
    var LABELS_KEY = 'was_note_labels';

    var COLORS = [
        { name: 'Default', hex: '#16162a' },
        { name: 'Red',     hex: '#3b1219' },
        { name: 'Orange',  hex: '#3b2810' },
        { name: 'Yellow',  hex: '#3b3510' },
        { name: 'Green',   hex: '#0f3b1a' },
        { name: 'Teal',    hex: '#0f3333' },
        { name: 'Blue',    hex: '#0f1f3b' },
        { name: 'Purple',  hex: '#251a3b' },
        { name: 'Pink',    hex: '#3b1030' },
        { name: 'Brown',   hex: '#2a1f14' },
        { name: 'Gray',    hex: '#1e1e2a' },
        { name: 'Deep',    hex: '#0a0a18' }
    ];

    var COLOR_BORDERS = {
        '#16162a': 'rgba(124,92,252,0.4)',
        '#3b1219': '#ef4444',
        '#3b2810': '#f59e0b',
        '#3b3510': '#eab308',
        '#0f3b1a': '#22c55e',
        '#0f3333': '#14b8a6',
        '#0f1f3b': '#3b82f6',
        '#251a3b': '#7c5cfc',
        '#3b1030': '#ec4899',
        '#2a1f14': '#a0845c',
        '#1e1e2a': '#6b6b80',
        '#0a0a18': '#404058'
    };

    // SVG icons
    var ICON_PIN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>';
    var ICON_CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';
    var ICON_TEXT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><polyline points="14 3 14 9 21 9"/></svg>';
    var ICON_EDIT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>';
    var ICON_DELETE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>';
    var ICON_COPY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    var ICON_LABEL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/></svg>';

    // ── Cached DOM refs (populated in init) ────────────────────────────
    var dom = {};

    function cacheDom() {
        dom.grid = document.getElementById('notes-grid');
        dom.empty = document.getElementById('notes-empty');
        dom.modalTitle = document.getElementById('note-modal-title');
        dom.noteId = document.getElementById('note-id');
        dom.noteTitle = document.getElementById('note-title');
        dom.noteContent = document.getElementById('note-content');
        dom.toolbar = document.getElementById('note-toolbar');
        dom.wordCount = document.getElementById('note-word-count');
        dom.textSection = document.getElementById('note-text-section');
        dom.checkSection = document.getElementById('note-checklist-section');
        dom.textBtn = document.getElementById('note-type-text');
        dom.checkBtn = document.getElementById('note-type-checklist');
        dom.checkEditor = document.getElementById('note-checklist-editor');
        dom.labelPicker = document.getElementById('note-label-picker');
        dom.labelSidebar = document.getElementById('notes-label-sidebar');
        dom.colorPicker = document.getElementById('note-colors');
        dom.searchInput = document.getElementById('notes-search');
    }

    // ── Data access ─────────────────────────────────────────────────────

    function loadNotes() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) { return []; }
    }

    function saveNotes(notes) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(notes)); }
        catch (e) { console.error('Notes: save failed', e); }
    }

    function loadLabels() {
        try {
            var raw = localStorage.getItem(LABELS_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) { return []; }
    }

    function saveLabels(labels) {
        try { localStorage.setItem(LABELS_KEY, JSON.stringify(labels)); }
        catch (e) {}
    }

    // ── Sorting ─────────────────────────────────────────────────────────

    function sortNotes(notes) {
        return notes.slice().sort(function (a, b) {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            return new Date(b.updatedAt) - new Date(a.updatedAt);
        });
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    /** Strip HTML tags to get plain text (for search/word count) */
    function stripHtml(html) {
        if (!html) return '';
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        return tmp.textContent || tmp.innerText || '';
    }

    /** Sanitize HTML — allow only safe formatting tags */
    function sanitizeHtml(html) {
        if (!html) return '';
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        // Remove script/style/iframe elements
        var dangerous = tmp.querySelectorAll('script, style, iframe, object, embed, form, input');
        for (var i = 0; i < dangerous.length; i++) {
            dangerous[i].parentNode.removeChild(dangerous[i]);
        }
        // Remove event handler attributes
        var all = tmp.querySelectorAll('*');
        for (var j = 0; j < all.length; j++) {
            var attrs = all[j].attributes;
            for (var k = attrs.length - 1; k >= 0; k--) {
                if (attrs[k].name.toLowerCase().indexOf('on') === 0) {
                    all[j].removeAttribute(attrs[k].name);
                }
            }
        }
        return tmp.innerHTML;
    }

    function timeAgo(dateStr) {
        var now = Date.now();
        var then = new Date(dateStr).getTime();
        var diff = Math.floor((now - then) / 1000);
        if (diff < 60) return 'just now';
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
        return App.formatDate(dateStr);
    }

    // ── Rendering ───────────────────────────────────────────────────────

    function renderChecklistPreview(items) {
        if (!items || !items.length) return '';
        var max = 5;
        var html = '<div class="note-checklist-preview">';
        for (var i = 0; i < Math.min(items.length, max); i++) {
            var item = items[i];
            var checked = item.checked ? ' checked' : '';
            var textClass = item.checked ? ' note-check-done' : '';
            html += '<div class="note-check-item' + checked + '">'
                + '<span class="note-check-box' + checked + '"></span>'
                + '<span class="note-check-text' + textClass + '">' + escapeHtml(item.text) + '</span>'
                + '</div>';
        }
        if (items.length > max) {
            html += '<div class="note-check-more">+ ' + (items.length - max) + ' more</div>';
        }
        html += '</div>';
        return html;
    }

    function renderLabels(labelIds) {
        if (!labelIds || !labelIds.length) return '';
        var allLabels = loadLabels();
        var html = '<div class="note-labels">';
        for (var i = 0; i < labelIds.length; i++) {
            for (var j = 0; j < allLabels.length; j++) {
                if (allLabels[j].id === labelIds[i]) {
                    html += '<span class="note-label-badge">' + escapeHtml(allLabels[j].name) + '</span>';
                    break;
                }
            }
        }
        html += '</div>';
        return html;
    }

    function renderNoteCard(note) {
        var color = note.color || COLORS[0].hex;
        var borderColor = COLOR_BORDERS[color] || 'rgba(124,92,252,0.4)';
        var pinBadge = note.pinned
            ? '<span class="note-pin-badge" title="Pinned">' + ICON_PIN + '</span>'
            : '';
        var typeIcon = note.type === 'checklist'
            ? '<span class="note-type-icon" title="Checklist">' + ICON_CHECK + '</span>'
            : '';

        var contentHtml = '';
        if (note.type === 'checklist' && note.checklistItems) {
            contentHtml = renderChecklistPreview(note.checklistItems);
        } else {
            var raw = note.content || '';
            // If content looks like HTML (rich text), render it; otherwise escape it
            var isHtml = /<[a-z][\s\S]*>/i.test(raw);
            if (isHtml) {
                contentHtml = '<div class="note-card-content">' + sanitizeHtml(raw) + '</div>';
            } else {
                var text = raw;
                if (text.length > 200) text = text.substring(0, 200);
                contentHtml = '<div class="note-card-content">' + escapeHtml(text) + '</div>';
            }
        }

        var labelsHtml = renderLabels(note.labels);

        return '<div class="note-card" style="background: ' + color + '; border-color: ' + borderColor + '" data-id="' + note.id + '">'
            + '<div class="note-card-header">'
            +     '<span class="note-card-title">' + escapeHtml(note.title || '') + '</span>'
            +     '<div class="note-card-badges">' + typeIcon + pinBadge + '</div>'
            + '</div>'
            + contentHtml
            + labelsHtml
            + '<div class="note-card-footer">'
            +     '<span class="note-card-time">' + timeAgo(note.updatedAt) + '</span>'
            +     '<div class="note-card-actions">'
            +         '<button class="btn-icon" data-action="pin" title="' + (note.pinned ? 'Unpin' : 'Pin') + '">' + ICON_PIN + '</button>'
            +         '<button class="btn-icon" data-action="duplicate" title="Duplicate">' + ICON_COPY + '</button>'
            +         '<button class="btn-icon" data-action="delete" title="Delete">' + ICON_DELETE + '</button>'
            +     '</div>'
            + '</div>'
            + '</div>';
    }

    function renderAll(filter) {
        var grid = dom.grid;
        var empty = dom.empty;
        if (!grid) return;

        var notes = loadNotes();
        var currentLabel = getActiveLabel();

        // Filter by label
        if (currentLabel) {
            notes = notes.filter(function (n) {
                return n.labels && n.labels.indexOf(currentLabel) !== -1;
            });
        }

        // Search filter
        if (filter) {
            var q = filter.toLowerCase();
            notes = notes.filter(function (n) {
                if (n.title && n.title.toLowerCase().indexOf(q) !== -1) return true;
                if (n.content && stripHtml(n.content).toLowerCase().indexOf(q) !== -1) return true;
                if (n.checklistItems) {
                    for (var ci = 0; ci < n.checklistItems.length; ci++) {
                        if (n.checklistItems[ci].text.toLowerCase().indexOf(q) !== -1) return true;
                    }
                }
                return false;
            });
        }

        var sorted = sortNotes(notes);

        if (sorted.length === 0) {
            grid.innerHTML = '';
            if (empty) empty.style.display = '';
            return;
        }

        if (empty) empty.style.display = 'none';

        // Separate pinned and unpinned
        var pinned = sorted.filter(function (n) { return n.pinned; });
        var unpinned = sorted.filter(function (n) { return !n.pinned; });

        var html = '';
        if (pinned.length > 0) {
            html += '<div class="notes-section-label">Pinned</div>';
            for (var p = 0; p < pinned.length; p++) html += renderNoteCard(pinned[p]);
        }
        if (unpinned.length > 0 && pinned.length > 0) {
            html += '<div class="notes-section-label">Others</div>';
        }
        for (var u = 0; u < unpinned.length; u++) html += renderNoteCard(unpinned[u]);

        grid.innerHTML = html;
    }

    // ── Label sidebar ──────────────────────────────────────────────────

    var activeLabel = null;

    function getActiveLabel() { return activeLabel; }

    function renderLabelSidebar() {
        var container = dom.labelSidebar;
        if (!container) return;
        var labels = loadLabels();
        var html = '<div class="notes-label-item' + (!activeLabel ? ' active' : '') + '" data-label="">'
            + ICON_TEXT + ' <span>All Notes</span></div>';
        for (var i = 0; i < labels.length; i++) {
            var isActive = activeLabel === labels[i].id ? ' active' : '';
            html += '<div class="notes-label-item' + isActive + '" data-label="' + labels[i].id + '">'
                + ICON_LABEL + ' <span>' + escapeHtml(labels[i].name) + '</span></div>';
        }
        html += '<div class="notes-label-item notes-label-add" data-action="manage-labels">'
            + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
            + ' <span>Manage Labels</span></div>';
        container.innerHTML = html;
    }

    // ── Color picker ────────────────────────────────────────────────────

    function buildColorPicker() {
        var container = dom.colorPicker;
        if (!container) return;
        container.innerHTML = '';
        for (var i = 0; i < COLORS.length; i++) {
            var div = document.createElement('div');
            div.className = 'color-option' + (i === 0 ? ' selected' : '');
            div.setAttribute('data-color', COLORS[i].hex);
            div.style.backgroundColor = COLORS[i].hex;
            div.style.borderColor = COLOR_BORDERS[COLORS[i].hex] || 'transparent';
            div.title = COLORS[i].name;
            container.appendChild(div);
        }
        container.addEventListener('click', function (e) {
            var option = e.target.closest('.color-option');
            if (!option) return;
            container.querySelectorAll('.color-option').forEach(function (el) {
                el.classList.remove('selected');
            });
            option.classList.add('selected');
        });
    }

    function getSelectedColor() {
        var selected = dom.colorPicker ? dom.colorPicker.querySelector('.color-option.selected') : null;
        return selected ? selected.getAttribute('data-color') : COLORS[0].hex;
    }

    function setSelectedColor(hex) {
        var container = dom.colorPicker;
        if (!container) return;
        container.querySelectorAll('.color-option').forEach(function (el) {
            if (el.getAttribute('data-color') === hex) {
                el.classList.add('selected');
            } else {
                el.classList.remove('selected');
            }
        });
    }

    // ── Checklist editor ───────────────────────────────────────────────

    function buildChecklistEditor(items) {
        var container = dom.checkEditor;
        if (!container) return;
        container.innerHTML = '';
        items = items || [];
        for (var i = 0; i < items.length; i++) {
            addChecklistRow(container, items[i].text, items[i].checked);
        }
        // Always add an empty row at the end
        addChecklistRow(container, '', false);
    }

    function addChecklistRow(container, text, checked) {
        var row = document.createElement('div');
        row.className = 'checklist-edit-row';
        row.innerHTML = '<input type="checkbox"' + (checked ? ' checked' : '') + ' class="checklist-edit-check">'
            + '<input type="text" class="checklist-edit-input input" placeholder="List item..." value="' + escapeHtml(text || '') + '">'
            + '<button type="button" class="btn-icon checklist-edit-remove" title="Remove">&times;</button>';

        var input = row.querySelector('.checklist-edit-input');
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                var next = row.nextElementSibling;
                if (next) {
                    next.querySelector('.checklist-edit-input').focus();
                } else {
                    addChecklistRow(container, '', false);
                    container.lastElementChild.querySelector('.checklist-edit-input').focus();
                }
            }
            if (e.key === 'Backspace' && input.value === '' && container.children.length > 1) {
                e.preventDefault();
                var prev = row.previousElementSibling;
                container.removeChild(row);
                if (prev) prev.querySelector('.checklist-edit-input').focus();
            }
        });

        // Auto-add new row when typing in last row
        input.addEventListener('input', function () {
            if (row === container.lastElementChild && input.value.length > 0) {
                addChecklistRow(container, '', false);
            }
        });

        row.querySelector('.checklist-edit-remove').addEventListener('click', function () {
            if (container.children.length > 1) {
                container.removeChild(row);
            } else {
                input.value = '';
                row.querySelector('.checklist-edit-check').checked = false;
            }
        });

        container.appendChild(row);
    }

    function getChecklistItems() {
        var container = dom.checkEditor;
        if (!container) return [];
        var rows = container.querySelectorAll('.checklist-edit-row');
        var items = [];
        for (var i = 0; i < rows.length; i++) {
            var text = rows[i].querySelector('.checklist-edit-input').value.trim();
            if (text) {
                items.push({
                    text: text,
                    checked: rows[i].querySelector('.checklist-edit-check').checked
                });
            }
        }
        return items;
    }

    // ── Label picker in modal ──────────────────────────────────────────

    var selectedLabels = [];

    function buildLabelPicker(noteLabels) {
        var container = dom.labelPicker;
        if (!container) return;
        selectedLabels = noteLabels ? noteLabels.slice() : [];
        var allLabels = loadLabels();
        var html = '';
        for (var i = 0; i < allLabels.length; i++) {
            var isChecked = selectedLabels.indexOf(allLabels[i].id) !== -1;
            html += '<label class="label-pick-item">'
                + '<input type="checkbox" value="' + allLabels[i].id + '"' + (isChecked ? ' checked' : '') + '>'
                + '<span>' + escapeHtml(allLabels[i].name) + '</span>'
                + '</label>';
        }
        if (allLabels.length === 0) {
            html = '<span class="note-no-labels">No labels yet</span>';
        }
        container.innerHTML = html;
    }

    function getSelectedLabels() {
        var container = dom.labelPicker;
        if (!container) return [];
        var checks = container.querySelectorAll('input[type="checkbox"]');
        var ids = [];
        for (var i = 0; i < checks.length; i++) {
            if (checks[i].checked) ids.push(checks[i].value);
        }
        return ids;
    }

    // ── CRUD operations ─────────────────────────────────────────────────

    function createNote(data) {
        var notes = loadNotes();
        var now = new Date().toISOString();
        var note = {
            id: App.generateId(),
            title: data.title || '',
            content: data.content || '',
            type: data.type || 'text',
            checklistItems: data.checklistItems || [],
            color: data.color || COLORS[0].hex,
            labels: data.labels || [],
            pinned: false,
            createdAt: now,
            updatedAt: now
        };
        notes.push(note);
        saveNotes(notes);
        return note;
    }

    function updateNote(id, data) {
        var notes = loadNotes();
        for (var i = 0; i < notes.length; i++) {
            if (notes[i].id === id) {
                notes[i].title = data.title !== undefined ? data.title : notes[i].title;
                notes[i].content = data.content !== undefined ? data.content : notes[i].content;
                notes[i].type = data.type || notes[i].type;
                notes[i].checklistItems = data.checklistItems !== undefined ? data.checklistItems : notes[i].checklistItems;
                notes[i].color = data.color || notes[i].color;
                notes[i].labels = data.labels !== undefined ? data.labels : notes[i].labels;
                notes[i].updatedAt = new Date().toISOString();
                break;
            }
        }
        saveNotes(notes);
    }

    function deleteNote(id) {
        var notes = loadNotes().filter(function (n) { return n.id !== id; });
        saveNotes(notes);
    }

    function duplicateNote(id) {
        var notes = loadNotes();
        var source = null;
        for (var i = 0; i < notes.length; i++) {
            if (notes[i].id === id) { source = notes[i]; break; }
        }
        if (!source) return;
        var now = new Date().toISOString();
        var copy = JSON.parse(JSON.stringify(source));
        copy.id = App.generateId();
        copy.title = (copy.title || 'Untitled') + ' (copy)';
        copy.pinned = false;
        copy.createdAt = now;
        copy.updatedAt = now;
        notes.push(copy);
        saveNotes(notes);
    }

    function togglePin(id) {
        var notes = loadNotes();
        for (var i = 0; i < notes.length; i++) {
            if (notes[i].id === id) {
                notes[i].pinned = !notes[i].pinned;
                notes[i].updatedAt = new Date().toISOString();
                break;
            }
        }
        saveNotes(notes);
    }

    function getNoteById(id) {
        var notes = loadNotes();
        for (var i = 0; i < notes.length; i++) {
            if (notes[i].id === id) return notes[i];
        }
        return null;
    }

    // ── Word count helper ────────────────────────────────────────────────

    function updateWordCount() {
        var el = dom.wordCount;
        if (!el || !dom.noteContent) return;
        var str = dom.noteContent.innerText || '';
        var words = str.trim().split(/\s+/).filter(function (w) { return w.length > 0; });
        el.textContent = words.length + ' words, ' + str.length + ' chars';
    }

    // ── Note type toggle ─────────────────────────────────────────────────

    var currentNoteType = 'text';

    function setNoteType(type) {
        currentNoteType = type;
        if (type === 'checklist') {
            if (dom.textSection) dom.textSection.style.display = 'none';
            if (dom.checkSection) dom.checkSection.style.display = '';
            if (dom.textBtn) dom.textBtn.classList.remove('active');
            if (dom.checkBtn) dom.checkBtn.classList.add('active');
        } else {
            if (dom.textSection) dom.textSection.style.display = '';
            if (dom.checkSection) dom.checkSection.style.display = 'none';
            if (dom.textBtn) dom.textBtn.classList.add('active');
            if (dom.checkBtn) dom.checkBtn.classList.remove('active');
        }
    }

    // ── Modal helpers ───────────────────────────────────────────────────

    function openCreateModal(type) {
        type = type || 'text';
        if (dom.modalTitle) dom.modalTitle.textContent = 'New Note';
        if (dom.noteId) dom.noteId.value = '';
        if (dom.noteTitle) dom.noteTitle.value = '';
        if (dom.noteContent) dom.noteContent.innerHTML = '';

        updateWordCount();
        setSelectedColor(COLORS[0].hex);
        setNoteType(type);
        buildChecklistEditor([]);
        buildLabelPicker([]);

        App.showModal('note-modal');
        if (dom.noteTitle) setTimeout(function () { dom.noteTitle.focus(); }, 100);
    }

    function openEditModal(id) {
        var note = getNoteById(id);
        if (!note) return;

        if (dom.modalTitle) dom.modalTitle.textContent = 'Edit Note';
        if (dom.noteId) dom.noteId.value = note.id;
        if (dom.noteTitle) dom.noteTitle.value = note.title;

        // Backward compat: plain text notes get escaped, HTML notes load directly
        if (dom.noteContent) {
            var raw = note.content || '';
            if (/<[a-z][\s\S]*>/i.test(raw)) {
                dom.noteContent.innerHTML = raw;
            } else {
                dom.noteContent.innerText = raw;
            }
        }

        setSelectedColor(note.color || COLORS[0].hex);
        setNoteType(note.type || 'text');
        buildChecklistEditor(note.checklistItems || []);
        buildLabelPicker(note.labels || []);
        updateWordCount();

        App.showModal('note-modal');
    }

    // ── Event handlers ──────────────────────────────────────────────────

    function handleFormSubmit(e) {
        e.preventDefault();

        var id = dom.noteId ? dom.noteId.value : '';
        var title = dom.noteTitle ? dom.noteTitle.value.trim() : '';
        var content = dom.noteContent ? dom.noteContent.innerHTML.trim() : '';
        // Treat empty editor (just <br> or whitespace) as empty
        if (content === '<br>' || stripHtml(content).trim() === '') content = '';
        var color = getSelectedColor();
        var labels = getSelectedLabels();
        var checklistItems = getChecklistItems();

        if (currentNoteType === 'text' && !title && !content) {
            App.toast('Please enter a title or content', 'error');
            return;
        }
        if (currentNoteType === 'checklist' && !title && checklistItems.length === 0) {
            App.toast('Please enter a title or add items', 'error');
            return;
        }

        var data = {
            title: title,
            content: content,
            type: currentNoteType,
            checklistItems: checklistItems,
            color: color,
            labels: labels
        };

        if (id) {
            updateNote(id, data);
            App.toast('Note updated', 'success');
        } else {
            createNote(data);
            App.toast('Note created', 'success');
        }

        App.closeModal('note-modal');
        renderAll(getCurrentSearch());
    }

    function handleGridClick(e) {
        var actionBtn = e.target.closest('[data-action]');
        var card = e.target.closest('.note-card');
        if (!card) return;

        var id = card.getAttribute('data-id');

        if (actionBtn) {
            var action = actionBtn.getAttribute('data-action');
            if (action === 'delete') {
                deleteNote(id);
                App.toast('Note deleted', 'info');
                renderAll(getCurrentSearch());
            } else if (action === 'pin') {
                togglePin(id);
                var note = getNoteById(id);
                App.toast(note && note.pinned ? 'Pinned' : 'Unpinned', 'info');
                renderAll(getCurrentSearch());
            } else if (action === 'duplicate') {
                duplicateNote(id);
                App.toast('Note duplicated', 'success');
                renderAll(getCurrentSearch());
            }
        } else {
            openEditModal(id);
        }
    }

    function handleLabelClick(e) {
        var item = e.target.closest('.notes-label-item');
        if (!item) return;
        var action = item.getAttribute('data-action');
        if (action === 'manage-labels') {
            openLabelManager();
            return;
        }
        var labelId = item.getAttribute('data-label');
        activeLabel = labelId || null;
        renderLabelSidebar();
        renderAll(getCurrentSearch());
    }

    // ── Label Manager Modal ─────────────────────────────────────────────

    function openLabelManager() {
        var modal = document.getElementById('label-manager-modal');
        if (!modal) return;
        renderLabelManagerList();
        App.showModal('label-manager-modal');
    }

    function renderLabelManagerList() {
        var container = document.getElementById('label-manager-list');
        if (!container) return;
        var labels = loadLabels();
        var html = '';
        for (var i = 0; i < labels.length; i++) {
            html += '<div class="label-manager-item" data-label-id="' + labels[i].id + '">'
                + '<input type="text" class="input label-manager-input" value="' + escapeHtml(labels[i].name) + '">'
                + '<button class="btn-icon btn-danger-icon" data-action="delete-label" title="Delete">' + ICON_DELETE + '</button>'
                + '</div>';
        }
        container.innerHTML = html;
    }

    function handleLabelManagerAdd() {
        var input = document.getElementById('label-manager-new');
        if (!input) return;
        var name = input.value.trim();
        if (!name) return;

        var labels = loadLabels();
        labels.push({ id: App.generateId(), name: name });
        saveLabels(labels);
        input.value = '';
        renderLabelManagerList();
        renderLabelSidebar();
    }

    function handleLabelManagerAction(e) {
        var btn = e.target.closest('[data-action="delete-label"]');
        if (!btn) return;
        var item = btn.closest('.label-manager-item');
        if (!item) return;
        var labelId = item.getAttribute('data-label-id');

        var labels = loadLabels().filter(function (l) { return l.id !== labelId; });
        saveLabels(labels);

        // Remove label from all notes
        var notes = loadNotes();
        for (var i = 0; i < notes.length; i++) {
            if (notes[i].labels) {
                notes[i].labels = notes[i].labels.filter(function (lid) { return lid !== labelId; });
            }
        }
        saveNotes(notes);

        renderLabelManagerList();
        renderLabelSidebar();
        renderAll(getCurrentSearch());
    }

    function handleLabelManagerSave() {
        var container = document.getElementById('label-manager-list');
        if (!container) return;
        var items = container.querySelectorAll('.label-manager-item');
        var labels = loadLabels();

        for (var i = 0; i < items.length; i++) {
            var id = items[i].getAttribute('data-label-id');
            var newName = items[i].querySelector('.label-manager-input').value.trim();
            for (var j = 0; j < labels.length; j++) {
                if (labels[j].id === id && newName) {
                    labels[j].name = newName;
                }
            }
        }
        saveLabels(labels);
        renderLabelSidebar();
        renderAll(getCurrentSearch());
        App.closeModal('label-manager-modal');
        App.toast('Labels saved', 'success');
    }

    // ── Quick add bar ───────────────────────────────────────────────────

    function handleQuickAdd(e) {
        var bar = document.getElementById('notes-quick-add');
        if (!bar) return;

        // If clicking the quick-add input area itself
        var input = bar.querySelector('.quick-add-input');
        if (e.target === input || e.target.closest('.quick-add-input')) {
            openCreateModal('text');
            return;
        }

        var btn = e.target.closest('[data-quick]');
        if (btn) {
            var type = btn.getAttribute('data-quick');
            openCreateModal(type);
        }
    }

    // ── Search ──────────────────────────────────────────────────────────

    function getCurrentSearch() {
        return dom.searchInput ? dom.searchInput.value.trim() : '';
    }

    var searchTimer = null;
    function handleSearch() {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
            renderAll(getCurrentSearch());
        }, 150);
    }

    // ── Initialisation ──────────────────────────────────────────────────

    function init() {
        cacheDom();
        buildColorPicker();

        // Quick add bar
        var quickAdd = document.getElementById('notes-quick-add');
        if (quickAdd) quickAdd.addEventListener('click', handleQuickAdd);

        // Add note button (fallback)
        var addBtn = document.getElementById('add-note-btn');
        if (addBtn) addBtn.addEventListener('click', function () { openCreateModal('text'); });

        // Form submit
        var form = document.getElementById('note-form');
        if (form) form.addEventListener('submit', handleFormSubmit);

        // Type toggle buttons
        var textBtn = document.getElementById('note-type-text');
        var checkBtn = document.getElementById('note-type-checklist');
        if (textBtn) textBtn.addEventListener('click', function () { setNoteType('text'); });
        if (checkBtn) checkBtn.addEventListener('click', function () { setNoteType('checklist'); });

        // Grid click delegation
        var grid = document.getElementById('notes-grid');
        if (grid) grid.addEventListener('click', handleGridClick);

        // Label sidebar
        var labelSidebar = document.getElementById('notes-label-sidebar');
        if (labelSidebar) labelSidebar.addEventListener('click', handleLabelClick);

        // Label manager
        var labelAddBtn = document.getElementById('label-manager-add-btn');
        if (labelAddBtn) labelAddBtn.addEventListener('click', handleLabelManagerAdd);

        var labelNewInput = document.getElementById('label-manager-new');
        if (labelNewInput) {
            labelNewInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); handleLabelManagerAdd(); }
            });
        }

        var labelList = document.getElementById('label-manager-list');
        if (labelList) labelList.addEventListener('click', handleLabelManagerAction);

        var labelSaveBtn = document.getElementById('label-manager-save-btn');
        if (labelSaveBtn) labelSaveBtn.addEventListener('click', handleLabelManagerSave);

        // Rich editor toolbar
        var toolbar = document.getElementById('note-toolbar');
        if (toolbar) {
            toolbar.addEventListener('click', function (e) {
                var btn = e.target.closest('button[data-cmd]');
                if (!btn) return;
                e.preventDefault();
                var cmd = btn.getAttribute('data-cmd');
                document.execCommand(cmd, false, null);
                dom.noteContent.focus();
                updateWordCount();
            });
            // Format block select
            var formatSelect = toolbar.querySelector('select[data-cmd="formatBlock"]');
            if (formatSelect) {
                formatSelect.addEventListener('change', function () {
                    var val = this.value;
                    if (val) {
                        document.execCommand('formatBlock', false, '<' + val + '>');
                    } else {
                        document.execCommand('formatBlock', false, '<div>');
                    }
                    this.value = val; // keep selection shown
                    dom.noteContent.focus();
                    updateWordCount();
                });
            }
            // Color inputs
            var colorInputs = toolbar.querySelectorAll('input[data-cmd]');
            for (var ci = 0; ci < colorInputs.length; ci++) {
                (function (inp) {
                    inp.addEventListener('input', function () {
                        document.execCommand(inp.getAttribute('data-cmd'), false, inp.value);
                        dom.noteContent.focus();
                    });
                })(colorInputs[ci]);
            }
        }

        // Live word count on contenteditable
        var noteContentArea = document.getElementById('note-content');
        if (noteContentArea) {
            noteContentArea.addEventListener('input', function () {
                updateWordCount();
            });
        }

        // Search
        var searchInput = document.getElementById('notes-search');
        if (searchInput) searchInput.addEventListener('input', handleSearch);

        // Initial render
        renderLabelSidebar();
        renderAll();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        render: renderAll,
        create: createNote,
        update: updateNote,
        remove: deleteNote,
        togglePin: togglePin
    };
})();
