(() => {
  "use strict";

  const KEYS = {
    transactions: "sb_transactions",
    budget: "sb_budget",
    planner: "sb_planner",
    summaryMode: "sb_summary_mode",
    selectedPeriod: "sb_selected_period",
    name: "sb_user_name",
    tourStep: "sb_tour_step",
    tourComplete: "sb_tour_complete"
  };

  const money = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 });
  const monthFormatter = new Intl.DateTimeFormat("en-NG", { month: "long", year: "numeric" });
  const shortMonthFormatter = new Intl.DateTimeFormat("en-NG", { month: "short" });
  const dateFormatter = new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric" });
  const today = localDateKey(new Date());
  const currentMonth = today.slice(0, 7);

  let transactions = loadTransactions();
  let budget = loadBudget();
  let plannedPurchases = loadArray(KEYS.planner);
  let selectedPeriod = currentMonth;
  let activeMode = "inflow";
  let chart = null;
  let toastTimer = 0;
  let tourStep = Number(localStorageGet(KEYS.tourStep) || 0);

  function localStorageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function store(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      showToast("Browser storage is unavailable. Changes may not persist.");
    }
  }

  function storeText(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      showToast("Browser storage is unavailable. Changes may not persist.");
    }
  }

  function loadJSON(key, fallback) {
    const raw = localStorageGet(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function localDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function getTransactionDate(offsetMonths = 0, day = new Date().getDate()) {
    const now = new Date();
    const firstOfTargetMonth = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
    const finalDay = new Date(firstOfTargetMonth.getFullYear(), firstOfTargetMonth.getMonth() + 1, 0).getDate();
    return localDateKey(new Date(firstOfTargetMonth.getFullYear(), firstOfTargetMonth.getMonth(), Math.min(day, finalDay)));
  }

  function createId() {
    return globalThis.crypto?.randomUUID?.() || `tx-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function loadTransactions() {
    const raw = loadJSON(KEYS.transactions, []);
    if (!Array.isArray(raw)) return [];
    const normalized = raw.filter(item => item && Number.isFinite(Number(item.amount)) && item.date && ["inflow", "outflow"].includes(item.type))
      .map(item => ({
        id: item.id || createId(),
        type: item.type,
        amount: Math.abs(Number(item.amount)),
        date: String(item.date).slice(0, 10),
        description: String(item.description || item.source || item.item || "Transaction"),
        category: String(item.category || (item.type === "inflow" ? "Income" : "Other"))
      }));
    if (normalized.length !== raw.length || raw.some((item, index) => !item.id || item.description !== normalized[index]?.description)) {
      store(KEYS.transactions, normalized);
    }
    return normalized;
  }

  function loadBudget() {
    const value = loadJSON(KEYS.budget, { amount: 0 });
    if (typeof value === "number") return { amount: Math.max(0, value), duration: "1" };
    return { ...value, amount: Math.max(0, Number(value?.amount) || 0) };
  }

  function loadArray(key) {
    const value = loadJSON(key, []);
    return Array.isArray(value) ? value.filter(item => item && typeof item === "object") : [];
  }

  function saveTransactions() {
    store(KEYS.transactions, transactions);
  }

  function saveBudget() {
    store(KEYS.budget, budget);
  }

  function formatNaira(value) {
    const amount = Number(value) || 0;
    return `₦${money.format(Math.round(amount))}`;
  }

  function monthKey(date) {
    return String(date).slice(0, 7);
  }

  function formatMonth(key) {
    const [year, month] = key.split("-").map(Number);
    return monthFormatter.format(new Date(year, month - 1, 1));
  }

  function formatDate(key) {
    const [year, month, day] = key.split("-").map(Number);
    return dateFormatter.format(new Date(year, month - 1, day));
  }

  function periodBounds(period) {
    if (period.startsWith("year:")) {
      const year = Number(period.slice(5));
      return { year, monthly: false };
    }
    return { month: period, year: Number(period.slice(0, 4)), monthly: true };
  }

  function transactionsForPeriod(period) {
    const bounds = periodBounds(period);
    return transactions.filter(transaction => bounds.monthly
      ? monthKey(transaction.date) === bounds.month
      : Number(transaction.date.slice(0, 4)) === bounds.year);
  }

  function addTransaction({ type, amount, description, category, date }) {
    const transaction = {
      id: createId(),
      type,
      amount: Math.abs(Number(amount)),
      description: String(description).trim(),
      category: String(category || (type === "inflow" ? "Income" : "Other")).trim(),
      date
    };
    transactions.push(transaction);
    saveTransactions();
    selectedPeriod = monthKey(date);
    storeText(KEYS.selectedPeriod, selectedPeriod);
    renderDashboard();
    return transaction;
  }

  function escapeText(value) {
    return String(value ?? "");
  }

  function updateGreeting() {
    const name = localStorageGet(KEYS.name)?.trim();
    const greeting = name ? `Welcome, ${name}` : "Welcome";
    document.getElementById("welcome-message").textContent = greeting;
    document.getElementById("user-avatar").textContent = name ? name.charAt(0).toLocaleUpperCase() : "C";
  }

  function updateFilterOptions() {
    const filter = document.getElementById("period-filter");
    const availableMonths = new Set([currentMonth, ...transactions.map(item => monthKey(item.date))]);
    const years = new Set([String(new Date().getFullYear()), ...Array.from(availableMonths, value => value.slice(0, 4))]);
    const options = [];

    Array.from(availableMonths).sort((a, b) => b.localeCompare(a)).forEach(key => {
      options.push({ value: key, label: formatMonth(key) });
    });
    Array.from(years).sort((a, b) => b.localeCompare(a)).forEach(year => {
      options.push({ value: `year:${year}`, label: `Yearly overview · ${year}` });
    });

    filter.replaceChildren(...options.map(option => {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      return element;
    }));

    if (!options.some(option => option.value === selectedPeriod)) selectedPeriod = currentMonth;
    filter.value = selectedPeriod;
    storeText(KEYS.selectedPeriod, selectedPeriod);
  }

  function calculateSummary(period) {
    const list = transactionsForPeriod(period);
    const inflow = list.reduce((sum, item) => sum + (item.type === "inflow" ? item.amount : 0), 0);
    const outflow = list.reduce((sum, item) => sum + (item.type === "outflow" ? item.amount : 0), 0);
    const { monthly } = periodBounds(period);
    const target = budget.amount * (monthly ? 1 : 12);
    return { inflow, outflow, balance: inflow - outflow, target, remaining: target - outflow, count: list.length };
  }

  function renderKPIs(summary) {
    const balance = document.getElementById("kpi-balance");
    const remaining = document.getElementById("kpi-remaining");
    balance.textContent = formatNaira(summary.balance);
    balance.classList.toggle("is-negative", summary.balance < 0);
    document.getElementById("kpi-inflow").textContent = formatNaira(summary.inflow);
    document.getElementById("kpi-outflow").textContent = formatNaira(summary.outflow);
    remaining.textContent = formatNaira(summary.remaining);
    remaining.classList.toggle("is-negative", summary.remaining < 0);
    document.getElementById("kpi-budget-note").textContent = budget.amount
      ? `Target: ${formatNaira(summary.target)}`
      : "Set a monthly budget";
    document.getElementById("kpi-balance-note").textContent = periodBounds(selectedPeriod).monthly
      ? formatMonth(periodBounds(selectedPeriod).month)
      : `Full year ${periodBounds(selectedPeriod).year}`;
  }

  function renderTransactions() {
    const listElement = document.getElementById("transaction-list");
    const emptyState = document.getElementById("transaction-empty");
    const periodTransactions = transactionsForPeriod(selectedPeriod).sort((a, b) => b.date.localeCompare(a.date));
    document.getElementById("transaction-count").textContent = `${periodTransactions.length} ${periodTransactions.length === 1 ? "entry" : "entries"}`;
    listElement.replaceChildren();
    emptyState.hidden = periodTransactions.length > 0;

    periodTransactions.forEach(transaction => {
      const row = document.createElement("tr");
      const description = document.createElement("td");
      description.dataset.label = "description";
      description.textContent = escapeText(transaction.description);

      const categoryCell = document.createElement("td");
      categoryCell.dataset.label = "category";
      const badge = document.createElement("span");
      badge.className = `category-badge${transaction.type === "inflow" ? " income" : ""}`;
      badge.textContent = escapeText(transaction.category);
      categoryCell.append(badge);

      const dateCell = document.createElement("td");
      dateCell.dataset.label = "date";
      dateCell.textContent = formatDate(transaction.date);

      const amountCell = document.createElement("td");
      amountCell.dataset.label = "amount";
      amountCell.className = `amount-cell ${transaction.type}`;
      amountCell.textContent = `${transaction.type === "inflow" ? "+" : "−"}${formatNaira(transaction.amount)}`;

      const actionCell = document.createElement("td");
      actionCell.dataset.label = "action";
      const deleteButton = document.createElement("button");
      deleteButton.className = "delete-transaction";
      deleteButton.type = "button";
      deleteButton.dataset.deleteId = transaction.id;
      deleteButton.setAttribute("aria-label", `Delete ${transaction.description}`);
      deleteButton.title = "Delete transaction";
      deleteButton.textContent = "×";
      actionCell.append(deleteButton);

      row.append(description, categoryCell, dateCell, amountCell, actionCell);
      listElement.append(row);
    });
  }

  function renderBudget(summary) {
    document.getElementById("budget-amount").textContent = formatNaira(budget.amount);
    document.getElementById("budget-spent-label").textContent = `${formatNaira(summary.outflow)} spent`;
    const percentage = budget.amount > 0 ? Math.round((summary.outflow / summary.target) * 100) : 0;
    const overBudget = summary.outflow > summary.target && summary.target > 0;
    const fill = document.getElementById("budget-progress-fill");
    fill.style.width = `${Math.min(100, percentage)}%`;
    fill.classList.toggle("is-over", overBudget);
    const progress = document.getElementById("budget-progress");
    progress.setAttribute("aria-valuenow", String(Math.min(100, percentage)));
    progress.setAttribute("aria-valuetext", `${percentage}% spent${overBudget ? ", over budget" : ""}`);
    document.getElementById("budget-percent").textContent = `${percentage}%`;
    const status = document.getElementById("budget-status");
    status.classList.toggle("is-over", overBudget);
    status.textContent = !budget.amount
      ? "Set a target to start tracking."
      : overBudget
        ? `You are ${formatNaira(summary.outflow - summary.target)} over your budget.`
        : `${formatNaira(summary.remaining)} left in this ${periodBounds(selectedPeriod).monthly ? "month" : "year"}.`;
  }

  function renderPlanner() {
    const list = document.getElementById("planned-list");
    const total = plannedPurchases.reduce((sum, item) => sum + (Number(item.cost) || 0), 0);
    document.getElementById("planner-total").textContent = plannedPurchases.length
      ? `${plannedPurchases.length} planned · ${formatNaira(total)} total`
      : "No planned purchases";
    list.replaceChildren();

    plannedPurchases.forEach(item => {
      const li = document.createElement("li");
      li.className = "planned-item";
      const name = document.createElement("span");
      name.className = "planned-item-name";
      name.textContent = escapeText(item.item || item.name || "Planned purchase");
      const duration = document.createElement("span");
      duration.className = "planned-item-detail";
      duration.textContent = escapeText(item.duration || "This month");
      const cost = document.createElement("span");
      cost.className = "planned-item-cost";
      cost.textContent = formatNaira(item.cost);
      li.append(name, duration, cost);
      list.append(li);
    });

    const affordability = document.getElementById("planner-affordability");
    const fits = budget.amount === 0 || total <= budget.amount;
    affordability.classList.toggle("is-over", !fits);
    affordability.textContent = !plannedPurchases.length
      ? "Add upcoming purchases to check them against your budget."
      : !budget.amount
        ? `Planned total: ${formatNaira(total)}. Set a budget to check affordability.`
        : fits
          ? `${formatNaira(budget.amount - total)} of your monthly target remains after planned purchases.`
          : `Planned purchases exceed the monthly target by ${formatNaira(total - budget.amount)}.`;
  }

  function buildChartSeries(period) {
    const { monthly, month, year } = periodBounds(period);
    const count = monthly ? new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate() : 12;
    const movement = Array(count).fill(0);
    const expenses = Array(count).fill(0);
    const list = transactionsForPeriod(period);

    list.forEach(transaction => {
      const index = monthly ? Number(transaction.date.slice(8, 10)) - 1 : Number(transaction.date.slice(5, 7)) - 1;
      const signedAmount = transaction.type === "inflow" ? transaction.amount : -transaction.amount;
      movement[index] += signedAmount;
      if (transaction.type === "outflow") expenses[index] += transaction.amount;
    });

    let runningBalance = 0;
    const balances = movement.map(amount => {
      runningBalance += amount;
      return runningBalance;
    });

    const labels = Array.from({ length: count }, (_, index) => monthly
      ? String(index + 1)
      : shortMonthFormatter.format(new Date(year, index, 1)));
    const periodOutflow = expenses.reduce((sum, amount) => sum + amount, 0);
    const periodBudget = budget.amount * (monthly ? 1 : 12);
    const positive = runningBalance >= 0 && (periodBudget <= 0 || periodOutflow <= periodBudget);
    return { labels, movement, balances, positive, monthly };
  }

  function renderChart() {
    const canvas = document.getElementById("cashflow-chart");
    const empty = document.getElementById("chart-empty");
    const series = buildChartSeries(selectedPeriod);
    const hasActivity = series.movement.some(value => value !== 0);
    empty.hidden = hasActivity;
    canvas.hidden = !hasActivity;

    if (chart) {
      chart.destroy();
      chart = null;
    }
    if (!hasActivity || typeof Chart === "undefined") {
      if (typeof Chart === "undefined") empty.hidden = false;
      if (typeof Chart === "undefined") empty.textContent = "Chart is unavailable while offline. Your transactions are still saved.";
      return;
    }

    const color = series.positive ? "#10b981" : "#ef4444";
    const softColor = series.positive ? "rgba(16, 185, 129, 0.14)" : "rgba(239, 68, 68, 0.14)";
    const context = canvas.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, 0, 280);
    gradient.addColorStop(0, softColor);
    gradient.addColorStop(1, "rgba(16, 24, 32, 0)");

    chart = new Chart(context, {
      type: "line",
      data: {
        labels: series.labels,
        datasets: [{
          label: "Running balance",
          data: series.balances,
          movement: series.movement,
          borderColor: color,
          backgroundColor: gradient,
          borderWidth: 2.5,
          pointRadius: series.monthly ? 0 : 3,
          pointHoverRadius: 5,
          pointBackgroundColor: color,
          pointBorderColor: "#17232d",
          pointBorderWidth: 2,
          tension: 0.25,
          fill: { target: "origin" }
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            backgroundColor: "#0c131a",
            borderColor: "#2b3a45",
            borderWidth: 1,
            titleColor: "#edf2f4",
            bodyColor: "#c2cdd2",
            padding: 11,
            callbacks: {
              title: items => series.monthly
                ? `${formatMonth(periodBounds(selectedPeriod).month)} · ${items[0].label}`
                : `${items[0].label} ${periodBounds(selectedPeriod).year}`,
              label: item => `Balance: ${formatNaira(item.parsed.y)}`,
              afterLabel: item => {
                const delta = item.dataset.movement[item.dataIndex] || 0;
                return `Net movement: ${delta >= 0 ? "+" : "−"}${formatNaira(Math.abs(delta))}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: "#91a1ac",
              maxTicksLimit: series.monthly ? 8 : 12,
              maxRotation: 0,
              callback(value, index) {
                if (!series.monthly) return this.getLabelForValue(value);
                const day = Number(this.getLabelForValue(value));
                return day === 1 || day % 5 === 0 ? day : "";
              }
            }
          },
          y: {
            grid: { color: "rgba(145, 161, 172, 0.11)" },
            border: { display: false },
            ticks: {
              color: "#91a1ac",
              maxTicksLimit: 5,
              callback: value => formatNaira(value)
            }
          }
        }
      }
    });
  }

  function renderInsight(summary) {
    const message = summary.balance > 0
      ? `You are net positive by ${formatNaira(summary.balance)} this period.`
      : summary.balance < 0
        ? `Spending is ahead of income by ${formatNaira(Math.abs(summary.balance))} this period.`
        : summary.count
          ? "Income and spending are currently balanced for this period."
          : "Add your first transaction to see how this period is going.";
    document.getElementById("period-insight").textContent = message;
  }

  function renderDashboard() {
    updateFilterOptions();
    const summary = calculateSummary(selectedPeriod);
    renderKPIs(summary);
    renderTransactions();
    renderBudget(summary);
    renderPlanner();
    renderChart();
    renderInsight(summary);
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2800);
  }

  function setTransactionMode(mode) {
    activeMode = mode;
    const inflow = mode === "inflow";
    document.getElementById("cashin-button").classList.toggle("is-selected", inflow);
    document.getElementById("cashout-button").classList.toggle("is-selected", !inflow);
    document.getElementById("transaction-dialog-title").textContent = inflow ? "Add cash in" : "Add cash out";
    document.getElementById("description-label").textContent = inflow ? "Income source" : "What did you buy?";
    document.getElementById("transaction-description").placeholder = inflow ? "Salary, client gig..." : "Groceries, transport...";
    document.getElementById("category-label").textContent = inflow ? "Income category (optional)" : "Category or reason";
    document.getElementById("transaction-category").placeholder = inflow ? "Salary, freelance..." : "Food, transport...";
    document.getElementById("transaction-category").required = !inflow;
    document.getElementById("transaction-submit").textContent = inflow ? "Save cash in" : "Save cash out";
  }

  function openDialog(id) {
    const dialog = document.getElementById(id);
    if (dialog && !dialog.open) dialog.showModal();
  }

  function closeDialog(dialog) {
    if (dialog?.open) dialog.close();
  }

  function setupDialogs() {
    document.querySelectorAll("[data-open-dialog]").forEach(button => {
      button.addEventListener("click", () => openDialog(button.dataset.openDialog));
    });
    document.querySelectorAll("[data-close-dialog]").forEach(button => {
      button.addEventListener("click", () => closeDialog(button.closest("dialog")));
    });
    document.querySelectorAll("[data-open-transaction]").forEach(button => {
      button.addEventListener("click", () => {
        setTransactionMode(button.dataset.openTransaction);
        const dateInput = document.getElementById("transaction-date");
        if (!dateInput.value) dateInput.value = today;
        openDialog("transaction-dialog");
        window.setTimeout(() => document.getElementById("transaction-amount").focus(), 0);
      });
    });
    document.querySelectorAll("[data-mode]").forEach(button => {
      button.addEventListener("click", () => setTransactionMode(button.dataset.mode));
    });

    document.getElementById("transaction-form").addEventListener("submit", event => {
      event.preventDefault();
      const amount = Number(document.getElementById("transaction-amount").value);
      const description = document.getElementById("transaction-description").value.trim();
      const category = document.getElementById("transaction-category").value.trim();
      const date = document.getElementById("transaction-date").value;
      if (!(amount > 0) || !description || !date || (activeMode === "outflow" && !category)) return;
      addTransaction({ type: activeMode, amount, description, category: category || "Income", date });
      event.currentTarget.reset();
      document.getElementById("transaction-date").value = today;
      closeDialog(document.getElementById("transaction-dialog"));
      showToast(activeMode === "inflow" ? "Cash in recorded." : "Cash out recorded.");
    });

    document.getElementById("budget-form").addEventListener("submit", event => {
      event.preventDefault();
      budget = { ...budget, amount: Math.max(0, Number(document.getElementById("budget-input").value) || 0) };
      saveBudget();
      renderDashboard();
      closeDialog(document.getElementById("budget-dialog"));
      showToast("Monthly budget saved.");
    });

    document.getElementById("planner-form").addEventListener("submit", event => {
      event.preventDefault();
      const item = document.getElementById("planned-item").value.trim();
      const cost = Number(document.getElementById("planned-cost").value);
      const duration = document.getElementById("planned-duration").value;
      if (!item || !(cost > 0)) return;
      plannedPurchases.unshift({ id: createId(), item, cost, duration });
      store(KEYS.planner, plannedPurchases);
      event.currentTarget.reset();
      renderPlanner();
      showToast("Purchase added to your plan.");
    });

    document.getElementById("transaction-list").addEventListener("click", event => {
      const button = event.target.closest("[data-delete-id]");
      if (!button) return;
      transactions = transactions.filter(item => item.id !== button.dataset.deleteId);
      saveTransactions();
      renderDashboard();
      showToast("Transaction deleted.");
    });

    document.getElementById("period-filter").addEventListener("change", event => {
      selectedPeriod = event.target.value;
      storeText(KEYS.selectedPeriod, selectedPeriod);
      renderDashboard();
    });
  }

  function setupNavigation() {
    const sidebar = document.getElementById("sidebar");
    const toggle = document.getElementById("menu-toggle");
    const backdrop = document.getElementById("sidebar-backdrop");
    const setOpen = open => {
      sidebar.classList.toggle("is-open", open);
      backdrop.classList.toggle("is-visible", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    };
    toggle.addEventListener("click", () => setOpen(!sidebar.classList.contains("is-open")));
    backdrop.addEventListener("click", () => setOpen(false));
    sidebar.querySelectorAll(".nav-link").forEach(link => link.addEventListener("click", () => {
      sidebar.querySelectorAll(".nav-link").forEach(item => item.classList.toggle("is-active", item === link));
      setOpen(false);
    }));
  }

  const tourSteps = [
    {
      target: "#kpi-grid",
      title: "Your money at a glance",
      copy: "These four figures summarize income, spending, available balance, and the budget left for the period you select.",
      kind: "continue"
    },
    {
      target: "#planner",
      title: "Set your monthly baseline",
      copy: "What is your monthly budget/income? We will save this as your budget target and add it as income for this month.",
      label: "Monthly budget and income",
      kind: "amount",
      save(value) {
        budget = { amount: value, duration: "1" };
        saveBudget();
        addTransaction({ type: "inflow", amount: value, description: "Monthly income", category: "Income", date: today });
      }
    },
    {
      target: "#cashflow-panel",
      title: "Start with last month",
      copy: "How much did you spend last month? We will add it to the last day of the previous month, so it appears in that month’s chart and ledger.",
      label: "Total spent last month",
      kind: "amount",
      save(value) {
        const date = getTransactionDate(-1, 31);
        addTransaction({ type: "outflow", amount: value, description: "Last month's spending", category: "Expenses", date });
      }
    },
    {
      target: "#ledger-panel",
      title: "Add today's spending",
      copy: "How much have you spent today? This will be saved as a starting expense. You can add a specific description later from Cash out.",
      label: "Total spent today",
      kind: "amount",
      save(value) {
        addTransaction({ type: "outflow", amount: value, description: "Today's spending", category: "Expenses", date: today });
      }
    },
    {
      target: "#period-filter",
      title: "Move through your timeline",
      copy: "Choose any month in your transaction history or switch to a yearly overview. Your chart, ledger, and summary update together.",
      kind: "finish"
    }
  ];

  function updateTourPosition() {
    const card = document.getElementById("tour-card");
    const spotlight = document.getElementById("tour-spotlight");
    if (card.hidden || !tourSteps[tourStep]) return;
    const target = document.querySelector(tourSteps[tourStep].target);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const padding = 7;
    spotlight.style.left = `${Math.max(4, rect.left - padding)}px`;
    spotlight.style.top = `${Math.max(4, rect.top - padding)}px`;
    spotlight.style.width = `${Math.min(window.innerWidth - 8, rect.width + padding * 2)}px`;
    spotlight.style.height = `${Math.min(window.innerHeight - 8, rect.height + padding * 2)}px`;

    const cardWidth = Math.min(352, window.innerWidth - 32);
    const cardHeight = card.offsetHeight || 220;
    let left = Math.min(Math.max(16, rect.left), window.innerWidth - cardWidth - 16);
    let top = rect.bottom + 16;
    if (top + cardHeight > window.innerHeight - 16) top = rect.top - cardHeight - 16;
    if (top < 12) top = Math.max(12, window.innerHeight - cardHeight - 16);
    if (tourSteps[tourStep].target === "#period-filter" && window.innerWidth <= 864) {
      left = Math.max(12, window.innerWidth - cardWidth - 12);
      top = Math.max(12, rect.bottom + 12);
      if (top + cardHeight > window.innerHeight - 16) top = window.innerHeight - cardHeight - 16;
    }
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  function showTourStep() {
    const step = tourSteps[tourStep];
    if (!step) return finishTour();
    const target = document.querySelector(step.target);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    const card = document.getElementById("tour-card");
    const form = document.getElementById("tour-form");
    const continueButton = document.getElementById("tour-continue");
    document.getElementById("tour-step-count").textContent = `STEP ${tourStep + 1} OF ${tourSteps.length}`;
    document.getElementById("tour-title").textContent = step.title;
    document.getElementById("tour-copy").textContent = step.copy;
    form.hidden = step.kind !== "amount";
    continueButton.hidden = step.kind === "amount";
    continueButton.textContent = step.kind === "finish" ? "Finish tour" : "Continue →";
    if (step.kind === "amount") {
      document.getElementById("tour-input-label").textContent = step.label;
      document.getElementById("tour-amount").value = "";
      document.getElementById("tour-amount").focus({ preventScroll: true });
    }
    card.hidden = false;
    document.getElementById("tour-shade").hidden = false;
    document.getElementById("tour-spotlight").hidden = false;
    storeText(KEYS.tourStep, String(tourStep));
    window.requestAnimationFrame(updateTourPosition);
  }

  function startTour() {
    tourStep = Math.max(0, Math.min(tourStep, tourSteps.length - 1));
    showTourStep();
  }

  function advanceTour() {
    tourStep += 1;
    if (tourStep >= tourSteps.length) return finishTour();
    showTourStep();
  }

  function finishTour() {
    document.getElementById("tour-card").hidden = true;
    document.getElementById("tour-shade").hidden = true;
    document.getElementById("tour-spotlight").hidden = true;
    storeText(KEYS.tourComplete, "true");
    storeText(KEYS.tourStep, "0");
    renderDashboard();
    showToast("Your dashboard is ready.");
  }

  function setupTour() {
    const name = document.getElementById("onboarding-name");
    const welcome = document.getElementById("welcome-dialog");
    document.getElementById("onboarding-form").addEventListener("submit", event => {
      event.preventDefault();
      const value = name.value.trim();
      if (!value) return;
      storeText(KEYS.name, value);
      updateGreeting();
      closeDialog(welcome);
      tourStep = 0;
      storeText(KEYS.tourStep, "0");
      window.setTimeout(startTour, 250);
    });

    document.getElementById("tour-form").addEventListener("submit", event => {
      event.preventDefault();
      const value = Number(document.getElementById("tour-amount").value);
      if (!Number.isFinite(value) || value < 0) return;
      tourSteps[tourStep].save(value);
      renderDashboard();
      advanceTour();
    });

    document.getElementById("tour-continue").addEventListener("click", () => {
      if (tourSteps[tourStep]?.kind === "finish") return finishTour();
      advanceTour();
    });
    document.getElementById("tour-skip").addEventListener("click", finishTour);
    window.addEventListener("resize", updateTourPosition);
    window.addEventListener("scroll", updateTourPosition, { passive: true });

    const hasStoredData = [KEYS.transactions, KEYS.budget, KEYS.planner].some(key => localStorageGet(key) !== null);
    const nameIsSaved = Boolean(localStorageGet(KEYS.name)?.trim());
    const tourDone = localStorageGet(KEYS.tourComplete) === "true";
    if (!hasStoredData && !nameIsSaved) {
      welcome.showModal();
      window.setTimeout(() => name.focus(), 0);
    } else if (nameIsSaved && !tourDone) {
      startTour();
    }
  }

  function setupInitialValues() {
    document.getElementById("budget-input").value = budget.amount || "";
    document.getElementById("transaction-date").value = today;
    updateGreeting();
  }

  function init() {
    setupInitialValues();
    setupDialogs();
    setupNavigation();
    renderDashboard();
    setupTour();
  }

  init();
})();