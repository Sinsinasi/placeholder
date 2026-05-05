/**
 * Finances.js - Income & Expense tracker with balance
 * Tracks total balance, income, expenses with charts and statistics.
 */
var Finances = (function () {
    'use strict';

    // ── Constants ─────────────────────────────────────────────────────────

    var STORAGE_KEY = 'was_expenses';
    var BUDGET_KEY = 'was_budget';

    var EXPENSE_CATEGORIES = [
        { name: 'Food & Dining', color: '#ef4444' },
        { name: 'Transport', color: '#f59e0b' },
        { name: 'Housing', color: '#3b82f6' },
        { name: 'Entertainment', color: '#8b5cf6' },
        { name: 'Shopping', color: '#ec4899' },
        { name: 'Health', color: '#22c55e' },
        { name: 'Education', color: '#06b6d4' },
        { name: 'Utilities', color: '#64748b' },
        { name: 'Subscriptions', color: '#7c5cfc' },
        { name: 'Other', color: '#6b7280' }
    ];

    var INCOME_CATEGORIES = [
        { name: 'Salary', color: '#22c55e' },
        { name: 'Freelance', color: '#10b981' },
        { name: 'Trading', color: '#7c5cfc' },
        { name: 'Investment', color: '#3b82f6' },
        { name: 'Gift', color: '#f59e0b' },
        { name: 'Refund', color: '#06b6d4' },
        { name: 'Other Income', color: '#6b7280' }
    ];

    // ── Chart Defaults ────────────────────────────────────────────────────

    if (typeof Chart !== 'undefined') {
        Chart.defaults.color = '#9898b0';
        Chart.defaults.borderColor = '#252540';
    }

    // ── State ─────────────────────────────────────────────────────────────

    var transactions = [];
    var pieChart = null;
    var barChart = null;
    var currentModalType = 'expense'; // 'income' or 'expense'

    // ── DOM References ────────────────────────────────────────────────────

    function el(id) {
        return document.getElementById(id);
    }

    // ── Persistence ───────────────────────────────────────────────────────

    function loadTransactions() {
        try {
            var data = localStorage.getItem(STORAGE_KEY);
            transactions = data ? JSON.parse(data) : [];
            for (var i = 0; i < transactions.length; i++) {
                // Backward compat: old expenses without type default to 'expense'
                if (!transactions[i].type) {
                    transactions[i].type = 'expense';
                }
                // Backward compat: default budgeted to true
                if (typeof transactions[i].budgeted === 'undefined') {
                    transactions[i].budgeted = true;
                }
            }
        } catch (e) {
            transactions = [];
        }
    }

    function saveTransactions() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
    }

    // ── Budget Persistence ──────────────────────────────────────────────

    function loadBudget() {
        try {
            var stored = localStorage.getItem(BUDGET_KEY);
            var val = parseFloat(stored);
            return isNaN(val) ? 0 : val;
        } catch (e) {
            return 0;
        }
    }

    function saveBudget(amount) {
        localStorage.setItem(BUDGET_KEY, String(amount));
    }

    // ── Balance Calculation ─────────────────────────────────────────────

    function calcBalance() {
        var balance = 0;
        for (var i = 0; i < transactions.length; i++) {
            if (transactions[i].type === 'income') {
                balance += transactions[i].amount;
            } else {
                balance -= transactions[i].amount;
            }
        }
        return balance;
    }

    function isFuture(dateStr) {
        return dateStr > todayString();
    }

    function updateBalanceDisplay() {
        var balance = calcBalance();
        var balEl = el('balance-amount');
        if (balEl) {
            balEl.textContent = App.formatCurrency(Math.abs(balance));
            if (balance < 0) {
                balEl.textContent = '-' + balEl.textContent;
                balEl.className = 'balance-amount negative';
            } else {
                balEl.className = 'balance-amount positive';
            }
        }
    }

    // ── Budget Display ──────────────────────────────────────────────────

    function updateBudget() {
        var budget = loadBudget();
        var currentMonth = getCurrentMonthKey();
        var monthSpent = 0;
        var monthIncome = 0;
        for (var i = 0; i < transactions.length; i++) {
            if (!transactions[i].budgeted || getMonthKey(transactions[i].date) !== currentMonth) continue;
            if (transactions[i].type === 'expense') {
                monthSpent += transactions[i].amount;
            } else if (transactions[i].type === 'income') {
                monthIncome += transactions[i].amount;
            }
        }

        var displayEl = el('budget-amount-display');
        var progressFill = el('budget-progress-fill');
        var spentLabel = el('budget-spent-label');
        var remainingLabel = el('budget-remaining-label');

        // Effective budget = set budget + budgeted income
        var effectiveBudget = budget + monthIncome;

        if (budget === 0) {
            if (displayEl) displayEl.textContent = 'Set Budget';
            if (progressFill) {
                progressFill.style.width = '0%';
                progressFill.className = 'progress-fill under-budget';
            }
            if (spentLabel) spentLabel.textContent = App.formatCurrency(monthSpent) + ' spent';
            if (remainingLabel) remainingLabel.textContent = App.formatCurrency(0) + ' remaining';
            return;
        }

        var percentage = (monthSpent / effectiveBudget) * 100;
        var cappedPercent = percentage > 100 ? 100 : percentage;

        var fillClass = 'under-budget';
        if (percentage > 100) {
            fillClass = 'over-budget';
        } else if (percentage >= 75) {
            fillClass = 'near-budget';
        }

        if (displayEl) {
            displayEl.textContent = App.formatCurrency(monthSpent) + ' / ' + App.formatCurrency(effectiveBudget);
        }
        if (progressFill) {
            progressFill.style.width = cappedPercent.toFixed(1) + '%';
            progressFill.className = 'progress-fill ' + fillClass;
        }
        if (spentLabel) {
            spentLabel.textContent = App.formatCurrency(monthSpent) + ' spent';
            spentLabel.style.color = fillClass === 'over-budget' ? '#ef4444' : fillClass === 'near-budget' ? '#f59e0b' : '#22c55e';
        }
        if (remainingLabel) {
            var remaining = effectiveBudget - monthSpent;
            if (remaining >= 0) {
                remainingLabel.textContent = App.formatCurrency(remaining) + ' remaining';
                remainingLabel.style.color = fillClass === 'near-budget' ? '#f59e0b' : '#22c55e';
            } else {
                remainingLabel.textContent = App.formatCurrency(Math.abs(remaining)) + ' over budget';
                remainingLabel.style.color = '#ef4444';
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    function getCategoryColor(categoryName) {
        var allCats = EXPENSE_CATEGORIES.concat(INCOME_CATEGORIES);
        for (var i = 0; i < allCats.length; i++) {
            if (allCats[i].name === categoryName) {
                return allCats[i].color;
            }
        }
        return '#6b7280';
    }

    function todayString() {
        var d = new Date();
        var year = d.getFullYear();
        var month = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
    }

    function getMonthKey(dateStr) {
        return dateStr.substring(0, 7);
    }

    function formatMonthLabel(monthKey) {
        var parts = monthKey.split('-');
        var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        var monthIdx = parseInt(parts[1], 10) - 1;
        return months[monthIdx] + ' ' + parts[0];
    }

    function getCurrentMonthKey() {
        var d = new Date();
        var year = d.getFullYear();
        var month = String(d.getMonth() + 1).padStart(2, '0');
        return year + '-' + month;
    }

    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ── Filtering ─────────────────────────────────────────────────────────

    function getSelectedMonth() {
        var select = el('finance-month-filter');
        return select ? select.value : 'all';
    }

    function getSelectedCategory() {
        var select = el('finance-category-filter');
        return select ? select.value : 'all';
    }

    function getFilteredTransactions() {
        var monthFilter = getSelectedMonth();
        var categoryFilter = getSelectedCategory();

        return transactions.filter(function (txn) {
            if (monthFilter !== 'all' && getMonthKey(txn.date) !== monthFilter) {
                return false;
            }
            if (categoryFilter !== 'all' && txn.category !== categoryFilter) {
                return false;
            }
            return true;
        });
    }

    // ── Stats ─────────────────────────────────────────────────────────────

    function updateStats(filtered) {
        // Total Income (filtered)
        var totalIncome = 0;
        var totalExpenses = 0;
        for (var i = 0; i < filtered.length; i++) {
            if (filtered[i].type === 'income') {
                totalIncome += filtered[i].amount;
            } else {
                totalExpenses += filtered[i].amount;
            }
        }

        var incomeEl = el('stat-total-income');
        if (incomeEl) {
            incomeEl.textContent = '+' + App.formatCurrency(totalIncome);
        }

        var totalEl = el('stat-total-spent');
        if (totalEl) {
            totalEl.textContent = '-' + App.formatCurrency(totalExpenses);
        }

        // This Month net (budgeted only)
        var currentMonth = getCurrentMonthKey();
        var monthExpenses = 0;
        var monthIncBudgeted = 0;
        for (var j = 0; j < transactions.length; j++) {
            if (!transactions[j].budgeted || getMonthKey(transactions[j].date) !== currentMonth) continue;
            if (transactions[j].type === 'expense') {
                monthExpenses += transactions[j].amount;
            } else if (transactions[j].type === 'income') {
                monthIncBudgeted += transactions[j].amount;
            }
        }
        var monthNet = monthIncBudgeted - monthExpenses;
        var monthEl = el('stat-month-spent');
        if (monthEl) {
            if (monthNet >= 0) {
                monthEl.textContent = '+' + App.formatCurrency(monthNet);
                monthEl.className = 'stat-value stat-income';
            } else {
                monthEl.textContent = '-' + App.formatCurrency(Math.abs(monthNet));
                monthEl.className = 'stat-value stat-expense';
            }
        }

        // Top Category (expenses only, filtered)
        var topCatEl = el('stat-top-category');
        if (topCatEl) {
            var expenseOnly = filtered.filter(function (t) { return t.type === 'expense'; });
            if (expenseOnly.length === 0) {
                topCatEl.textContent = '--';
            } else {
                var catTotals = {};
                for (var m = 0; m < expenseOnly.length; m++) {
                    var cat = expenseOnly[m].category;
                    catTotals[cat] = (catTotals[cat] || 0) + expenseOnly[m].amount;
                }
                var topCat = '';
                var topAmount = 0;
                for (var catName in catTotals) {
                    if (catTotals.hasOwnProperty(catName) && catTotals[catName] > topAmount) {
                        topAmount = catTotals[catName];
                        topCat = catName;
                    }
                }
                topCatEl.textContent = topCat;
            }
        }
    }

    // ── Table Rendering ───────────────────────────────────────────────────

    function renderTable(filtered) {
        var tbody = el('expenses-tbody');
        var table = el('expenses-table');
        var empty = el('expenses-empty');

        if (!tbody) return;

        var sorted = filtered.slice().sort(function (a, b) {
            if (a.date > b.date) return -1;
            if (a.date < b.date) return 1;
            if (a.createdAt > b.createdAt) return -1;
            if (a.createdAt < b.createdAt) return 1;
            return 0;
        });

        var tableContainer = table ? table.closest('.table-container') : null;

        if (sorted.length === 0) {
            tbody.innerHTML = '';
            if (tableContainer) tableContainer.style.display = 'none';
            if (empty) empty.style.display = '';
            return;
        }

        if (tableContainer) tableContainer.style.display = '';
        if (empty) empty.style.display = 'none';

        var editIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">'
            + '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>'
            + '<path d="m15 5 4 4"/>'
            + '</svg>';

        var deleteIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">'
            + '<polyline points="3 6 5 6 21 6"/>'
            + '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'
            + '</svg>';

        var html = '';
        var today = todayString();
        for (var i = 0; i < sorted.length; i++) {
            var txn = sorted[i];
            var color = getCategoryColor(txn.category);
            var isIncome = txn.type === 'income';
            var future = txn.date > today;
            var typeClass = future ? 'txn-badge-planned' : (isIncome ? 'txn-badge-income' : 'txn-badge-expense');
            var typeLabel = future ? 'Planned' : (isIncome ? 'Income' : 'Expense');
            var amountClass = future ? 'amount-planned' : (isIncome ? 'amount-income' : 'amount-expense');
            var amountPrefix = isIncome ? '+' : '-';
            var rowClass = future ? ' class="row-planned"' : '';

            var budgetToggle = '<label class="budget-toggle" title="Include in monthly budget">'
                + '<input type="checkbox" data-action="toggle-budget"' + (txn.budgeted ? ' checked' : '') + '>'
                + '<span class="budget-toggle-slider"></span>'
                + '</label>';

            html += '<tr data-id="' + txn.id + '"' + rowClass + '>'
                + '<td>' + App.formatDate(txn.date) + '</td>'
                + '<td><span class="txn-badge ' + typeClass + '">' + typeLabel + '</span></td>'
                + '<td><span class="category-badge" style="color: ' + color + '">&bull; ' + escapeHtml(txn.category) + '</span></td>'
                + '<td>' + escapeHtml(txn.description) + '</td>'
                + '<td class="' + amountClass + '">' + amountPrefix + App.formatCurrency(txn.amount) + '</td>'
                + '<td class="td-budget">' + budgetToggle + '</td>'
                + '<td class="td-actions">'
                + '<button class="btn-icon" data-action="edit" title="Edit">' + editIcon + '</button>'
                + '<button class="btn-icon" data-action="delete" title="Delete">' + deleteIcon + '</button>'
                + '</td>'
                + '</tr>';
        }

        tbody.innerHTML = html;
    }

    // ── Charts ────────────────────────────────────────────────────────────

    function updatePieChart(monthFilter) {
        var canvas = el('expense-chart-pie');
        if (!canvas || typeof Chart === 'undefined') return;

        // Pie chart shows expense breakdown only
        var filtered = transactions.filter(function (txn) {
            if (txn.type !== 'expense') return false;
            if (monthFilter !== 'all' && getMonthKey(txn.date) !== monthFilter) return false;
            return true;
        });

        var catTotals = {};
        for (var i = 0; i < filtered.length; i++) {
            var cat = filtered[i].category;
            catTotals[cat] = (catTotals[cat] || 0) + filtered[i].amount;
        }

        var labels = [];
        var data = [];
        var colors = [];

        for (var j = 0; j < EXPENSE_CATEGORIES.length; j++) {
            var catName = EXPENSE_CATEGORIES[j].name;
            if (catTotals[catName] && catTotals[catName] > 0) {
                labels.push(catName);
                data.push(catTotals[catName]);
                colors.push(EXPENSE_CATEGORIES[j].color);
            }
        }

        if (pieChart) {
            pieChart.destroy();
            pieChart = null;
        }

        pieChart = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors,
                    borderColor: '#0d0d22',
                    borderWidth: 3,
                    hoverBorderColor: '#1a1a3e',
                    hoverBorderWidth: 2,
                    hoverOffset: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                animation: { animateRotate: true, duration: 800, easing: 'easeOutQuart' },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#9898b0',
                            padding: 16,
                            usePointStyle: true,
                            pointStyle: 'circle',
                            font: { size: 12 }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(13, 13, 34, 0.9)',
                        borderColor: 'rgba(124, 92, 252, 0.2)',
                        borderWidth: 1,
                        titleColor: '#ededff',
                        bodyColor: '#a0a0c0',
                        cornerRadius: 10,
                        padding: 12,
                        callbacks: {
                            label: function (context) {
                                var total = context.dataset.data.reduce(function (sum, val) {
                                    return sum + val;
                                }, 0);
                                var value = context.parsed;
                                var pct = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                return context.label + ': ' + App.formatCurrency(value) + ' (' + pct + '%)';
                            }
                        }
                    }
                }
            }
        });
    }

    function updateBarChart() {
        var canvas = el('expense-chart-bar');
        if (!canvas || typeof Chart === 'undefined') return;

        // Last 6 months: income vs expenses
        var now = new Date();
        var monthKeys = [];
        for (var i = 5; i >= 0; i--) {
            var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
            monthKeys.push(key);
        }

        var monthIncome = {};
        var monthExpense = {};
        for (var j = 0; j < monthKeys.length; j++) {
            monthIncome[monthKeys[j]] = 0;
            monthExpense[monthKeys[j]] = 0;
        }
        for (var k = 0; k < transactions.length; k++) {
            var mk = getMonthKey(transactions[k].date);
            if (transactions[k].type === 'income' && monthIncome.hasOwnProperty(mk)) {
                monthIncome[mk] += transactions[k].amount;
            } else if (transactions[k].type === 'expense' && monthExpense.hasOwnProperty(mk)) {
                monthExpense[mk] += transactions[k].amount;
            }
        }

        var labels = monthKeys.map(formatMonthLabel);
        var incomeData = monthKeys.map(function (mk) { return monthIncome[mk]; });
        var expenseData = monthKeys.map(function (mk) { return monthExpense[mk]; });

        if (barChart) {
            barChart.destroy();
            barChart = null;
        }

        barChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Income',
                        data: incomeData,
                        backgroundColor: 'rgba(34, 197, 94, 0.7)',
                        borderColor: 'transparent',
                        borderWidth: 0,
                        borderRadius: 6,
                        borderSkipped: false
                    },
                    {
                        label: 'Expenses',
                        data: expenseData,
                        backgroundColor: 'rgba(239, 68, 68, 0.7)',
                        borderColor: 'transparent',
                        borderWidth: 0,
                        borderRadius: 6,
                        borderSkipped: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 800, easing: 'easeOutQuart' },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.03)', drawBorder: false },
                        ticks: { color: '#9898b0', font: { size: 11 } }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255,255,255,0.03)', drawBorder: false },
                        ticks: {
                            color: '#9898b0',
                            callback: function (value) { return 'CHF ' + value; },
                            font: { size: 11 }
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            color: '#9898b0',
                            padding: 16,
                            usePointStyle: true,
                            pointStyle: 'circle',
                            font: { size: 12 }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(13, 13, 34, 0.9)',
                        borderColor: 'rgba(124, 92, 252, 0.2)',
                        borderWidth: 1,
                        titleColor: '#ededff',
                        bodyColor: '#a0a0c0',
                        cornerRadius: 10,
                        padding: 12,
                        callbacks: {
                            label: function (context) {
                                return context.dataset.label + ': ' + App.formatCurrency(context.parsed.y);
                            }
                        }
                    }
                }
            }
        });
    }

    // ── Month Filter Population ───────────────────────────────────────────

    function populateMonthFilter() {
        var select = el('finance-month-filter');
        if (!select) return;

        var currentValue = select.value;
        var monthSet = {};
        for (var i = 0; i < transactions.length; i++) {
            var mk = getMonthKey(transactions[i].date);
            monthSet[mk] = true;
        }

        var months = Object.keys(monthSet).sort().reverse();
        var html = '<option value="all">All Time</option>';
        for (var j = 0; j < months.length; j++) {
            html += '<option value="' + months[j] + '">' + formatMonthLabel(months[j]) + '</option>';
        }

        select.innerHTML = html;
        if (currentValue && select.querySelector('option[value="' + currentValue + '"]')) {
            select.value = currentValue;
        }
    }

    // ── Category Select Population ────────────────────────────────────────

    function populateCategorySelect() {
        var select = el('expense-category');
        if (!select) return;

        var cats = currentModalType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
        var html = '';
        for (var i = 0; i < cats.length; i++) {
            html += '<option value="' + escapeHtml(cats[i].name) + '">' + escapeHtml(cats[i].name) + '</option>';
        }
        select.innerHTML = html;
    }

    function populateCategoryFilter() {
        var select = el('finance-category-filter');
        if (!select) return;

        var currentValue = select.value;
        var allCats = EXPENSE_CATEGORIES.concat(INCOME_CATEGORIES);
        var html = '<option value="all">All Categories</option>';
        for (var i = 0; i < allCats.length; i++) {
            html += '<option value="' + escapeHtml(allCats[i].name) + '">' + escapeHtml(allCats[i].name) + '</option>';
        }
        select.innerHTML = html;

        if (currentValue && select.querySelector('option[value="' + CSS.escape(currentValue) + '"]')) {
            select.value = currentValue;
        }
    }

    // ── Modal Type Toggle ─────────────────────────────────────────────────

    function setModalType(type) {
        currentModalType = type;
        var typeField = el('expense-type');
        if (typeField) typeField.value = type;

        var incBtn = el('txn-type-income');
        var expBtn = el('txn-type-expense');
        if (incBtn) incBtn.classList.toggle('active', type === 'income');
        if (expBtn) expBtn.classList.toggle('active', type === 'expense');

        populateCategorySelect();

        var titleEl = el('expense-modal-title');
        if (titleEl) {
            var idField = el('expense-id');
            var isEdit = idField && idField.value;
            if (type === 'income') {
                titleEl.textContent = isEdit ? 'Edit Income' : 'Add Income';
            } else {
                titleEl.textContent = isEdit ? 'Edit Expense' : 'Add Expense';
            }
        }
    }

    // ── Full Render ───────────────────────────────────────────────────────

    function render() {
        populateMonthFilter();
        var filtered = getFilteredTransactions();
        renderTable(filtered);
        updateStats(filtered);
        updatePieChart(getSelectedMonth());
        updateBarChart();
        updateBudget();
        updateBalanceDisplay();
    }

    // ── CRUD Operations ───────��───────────────────────────────────────────

    function openAddModal(type) {
        var form = el('expense-form');
        if (form) form.reset();

        var idField = el('expense-id');
        if (idField) idField.value = '';

        var dateField = el('expense-date');
        if (dateField) dateField.value = todayString();

        setModalType(type || 'expense');
        App.showModal('expense-modal');
    }

    function openEditModal(id) {
        var txn = transactions.find(function (t) { return t.id === id; });
        if (!txn) return;

        var idField = el('expense-id');
        if (idField) idField.value = txn.id;

        setModalType(txn.type || 'expense');

        var dateField = el('expense-date');
        if (dateField) dateField.value = txn.date;

        var catField = el('expense-category');
        if (catField) catField.value = txn.category;

        var descField = el('expense-description');
        if (descField) descField.value = txn.description;

        var amountField = el('expense-amount');
        if (amountField) amountField.value = txn.amount;

        var budgetedField = el('expense-budgeted');
        if (budgetedField) budgetedField.checked = txn.budgeted !== false;

        App.showModal('expense-modal');
    }

    function handleFormSubmit(e) {
        e.preventDefault();

        var idField = el('expense-id');
        var typeField = el('expense-type');
        var dateField = el('expense-date');
        var catField = el('expense-category');
        var descField = el('expense-description');
        var amountField = el('expense-amount');

        var budgetedField = el('expense-budgeted');

        var id = idField ? idField.value : '';
        var type = typeField ? typeField.value : 'expense';
        var date = dateField ? dateField.value : '';
        var category = catField ? catField.value : '';
        var description = descField ? descField.value.trim() : '';
        var amount = amountField ? parseFloat(amountField.value) : 0;
        var budgeted = budgetedField ? budgetedField.checked : true;

        if (!date || !category || !description || isNaN(amount) || amount <= 0) {
            App.toast('Please fill in all fields correctly', 'error');
            return;
        }

        if (id) {
            var txn = transactions.find(function (t) { return t.id === id; });
            if (txn) {
                txn.type = type;
                txn.date = date;
                txn.category = category;
                txn.description = description;
                txn.amount = amount;
                txn.budgeted = budgeted;
                App.toast('Transaction updated', 'success');
            }
        } else {
            transactions.push({
                id: App.generateId(),
                type: type,
                date: date,
                category: category,
                description: description,
                amount: amount,
                budgeted: budgeted,
                createdAt: new Date().toISOString()
            });
            App.toast((type === 'income' ? 'Income' : 'Expense') + ' added', 'success');
        }

        saveTransactions();
        App.closeModal('expense-modal');
        render();
    }

    function deleteTransaction(id) {
        transactions = transactions.filter(function (t) { return t.id !== id; });
        saveTransactions();
        render();
        App.toast('Transaction deleted', 'success');
    }

    // ── Event Handlers ────────────────────────────────────────────────────

    function handleTableClick(e) {
        var actionEl = e.target.closest('[data-action]');
        if (!actionEl) return;

        var row = actionEl.closest('tr');
        if (!row) return;

        var id = row.getAttribute('data-id');
        var action = actionEl.getAttribute('data-action');

        if (action === 'edit') {
            openEditModal(id);
        } else if (action === 'delete') {
            deleteTransaction(id);
        } else if (action === 'toggle-budget') {
            var txn = transactions.find(function (t) { return t.id === id; });
            if (txn) {
                txn.budgeted = !txn.budgeted;
                saveTransactions();
                updateBudget();
                updateStats(getFilteredTransactions());
            }
        }
    }

    // ── Initialization ────────────────────────────────────────────────────

    function init() {
        loadTransactions();
        populateCategorySelect();
        populateCategoryFilter();
        render();

        // Add Income button
        var incomeBtn = el('add-income-btn');
        if (incomeBtn) {
            incomeBtn.addEventListener('click', function () { openAddModal('income'); });
        }

        // Add Expense button
        var addBtn = el('add-expense-btn');
        if (addBtn) {
            addBtn.addEventListener('click', function () { openAddModal('expense'); });
        }

        // Modal type toggle buttons
        var txnIncBtn = el('txn-type-income');
        var txnExpBtn = el('txn-type-expense');
        if (txnIncBtn) {
            txnIncBtn.addEventListener('click', function () { setModalType('income'); });
        }
        if (txnExpBtn) {
            txnExpBtn.addEventListener('click', function () { setModalType('expense'); });
        }

        // Budget edit button
        var budgetBtn = el('budget-edit-btn');
        if (budgetBtn) {
            budgetBtn.addEventListener('click', function () {
                var current = loadBudget();
                var input = prompt('Enter monthly budget amount:', current > 0 ? current : '');
                if (input === null) return;
                var amount = parseFloat(input);
                if (isNaN(amount) || amount <= 0) {
                    App.toast('Please enter a valid amount greater than 0', 'error');
                    return;
                }
                saveBudget(amount);
                updateBudget();
                App.toast('Budget set to ' + App.formatCurrency(amount), 'success');
            });
        }

        // Form submit
        var form = el('expense-form');
        if (form) {
            form.addEventListener('submit', handleFormSubmit);
        }

        // Table click delegation
        var tbody = el('expenses-tbody');
        if (tbody) {
            tbody.addEventListener('click', handleTableClick);
        }

        // Filter change handlers
        var monthFilter = el('finance-month-filter');
        if (monthFilter) {
            monthFilter.addEventListener('change', function () {
                var filtered = getFilteredTransactions();
                renderTable(filtered);
                updateStats(filtered);
                updatePieChart(getSelectedMonth());
            });
        }

        var categoryFilter = el('finance-category-filter');
        if (categoryFilter) {
            categoryFilter.addEventListener('change', function () {
                var filtered = getFilteredTransactions();
                renderTable(filtered);
                updateStats(filtered);
            });
        }
    }

    // ── Bootstrap ─────────────────────────────────────────────────────────

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // ── Public API ────────────────────────────────────────────────────────

    return {
        addExpense: function () { openAddModal('expense'); },
        addIncome: function () { openAddModal('income'); },
        render: render
    };
})();