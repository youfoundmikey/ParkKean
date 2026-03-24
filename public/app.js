const STATUS_META = {
  OPEN: { label: "Open", pillClass: "status-pill--open" },
  LIMITED: { label: "Limited", pillClass: "status-pill--limited" },
  FULL: { label: "Full", pillClass: "status-pill--full" },
};

const STATUS_ORDER = ["OPEN", "LIMITED", "FULL"];
const STORAGE_KEYS = {
  user: "pk_user_data",
  ecoInputs: "pk_eco_inputs_v1",
  theme: "pk_theme_pref",
};
const NOTIFICATION_POLL_INTERVAL = 60 * 1000;
const LOT_POLL_INTERVAL = 60 * 1000;
const CO2_PER_MILE_KG = 0.404;
const THEMES = {
  LIGHT: "light",
  DARK: "dark",
};
const ECO_BADGE_STEPS = [
  { name: "Starter Sprout", threshold: 0 },
  { name: "Shuttle Ally", threshold: 20 },
  { name: "Carpool Captain", threshold: 40 },
  { name: "Impact Steward", threshold: 70 },
  { name: "Carbon Neutral", threshold: 110 },
];
const ECO_GOAL_PERCENT = 70;
let notificationPollHandle = null;
let lotPollHandle = null;
let isLoadingLots = false;

const state = {
  lots: [],
  filter: "ALL",
  search: "",
  activePage: "lots",
  theme: THEMES.DARK,
  currentUser: null,
  leaderboard: [],
  dataSource: null,
  isDesktopSidebarCollapsed: false,
  location: {
    isRequesting: false,
    error: "",
  },
  notifications: [],
  notificationsLoading: false,
  admin: {
    search: "",
    filter: "ALL",
    isSubmittingEvent: false,
    feedbackTimeout: null,
  },
  report: {
    selectedLotId: null,
    selectedStatus: null,
    isSubmitting: false,
  },
  ecoInputs: {
    oneWayMiles: 6,
    shuttle: 2,
    walk: 2,
    bike: 1,
    carpool: 1,
    carpoolRiders: 3,
    idleMinutes: 10,
  },
  ecoCommute: {
    isSubmitting: false,
    message: "",
  },
};
const GUEST_USER = Object.freeze({
  username: "Guest",
  email: "guest@parkkean.local",
  is_admin: false,
  points: 0,
  reports: 0,
  last_latitude: null,
  last_longitude: null,
  location_accuracy: null,
  location_updated_at: null,
  last_eco_log_date: null,
});

function clampValue(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function getDefaultEcoInputs() {
  return {
    oneWayMiles: 6,
    shuttle: 2,
    walk: 2,
    bike: 1,
    carpool: 1,
    carpoolRiders: 3,
    idleMinutes: 10,
  };
}

function restoreStoredUser() {
  const raw = localStorage.getItem(STORAGE_KEYS.user);
  if (!raw) return;
  try {
    state.currentUser = JSON.parse(raw);
  } catch (error) {
    console.warn("Failed to restore stored user", error);
    localStorage.removeItem(STORAGE_KEYS.user);
  }
}

function getStoredTheme() {
  try {
    const value = localStorage.getItem(STORAGE_KEYS.theme);
    if (value === THEMES.LIGHT || value === THEMES.DARK) {
      return value;
    }
  } catch (error) {
    console.warn("Failed to read stored theme", error);
  }
  return null;
}

function initializeTheme() {
  const preferred =
    getStoredTheme() ||
    (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
      ? THEMES.LIGHT
      : THEMES.DARK);
  applyTheme(preferred, { skipPersist: true });
}

function applyTheme(theme, options = {}) {
  const next = theme === THEMES.LIGHT ? THEMES.LIGHT : THEMES.DARK;
  state.theme = next;
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
  if (!options.skipPersist) {
    try {
      localStorage.setItem(STORAGE_KEYS.theme, next);
    } catch (error) {
      console.warn("Failed to save theme", error);
    }
  }
  updateThemeToggle();
}

function toggleTheme() {
  const next = state.theme === THEMES.LIGHT ? THEMES.DARK : THEMES.LIGHT;
  applyTheme(next);
}

function updateThemeToggle() {
  if (!dom.themeToggle) return;
  const isLight = state.theme === THEMES.LIGHT;
  dom.themeToggle.setAttribute("aria-pressed", isLight ? "true" : "false");
  dom.themeToggle.setAttribute("aria-label", isLight ? "Switch to dark mode" : "Switch to light mode");
  dom.themeToggle.title = isLight ? "Switch to dark mode" : "Switch to light mode";
  if (dom.themeSunIcon) {
    dom.themeSunIcon.hidden = !isLight;
  }
  if (dom.themeMoonIcon) {
    dom.themeMoonIcon.hidden = isLight;
  }
}

function getEcoStorageKey() {
  const username = state.currentUser?.username?.toLowerCase() || "_anon";
  return `${STORAGE_KEYS.ecoInputs}:${username}`;
}

function loadEcoInputsForUser() {
  const raw = localStorage.getItem(getEcoStorageKey());
  state.ecoInputs = getDefaultEcoInputs();
  if (!raw) {
    renderEcoInputsForm();
    renderEcoSection();
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    state.ecoInputs = { ...state.ecoInputs, ...parsed };
  } catch (error) {
    console.warn("Failed to restore eco inputs", error);
  }
  renderEcoInputsForm();
  renderEcoSection();
}

function persistEcoInputs() {
  try {
    localStorage.setItem(getEcoStorageKey(), JSON.stringify(state.ecoInputs));
  } catch (error) {
    console.warn("Failed to save eco inputs", error);
  }
}

function renderEcoInputsForm() {
  if (!dom.ecoInputs?.length) return;
  dom.ecoInputs.forEach((input) => {
    const name = input.dataset.ecoInput;
    const value = state.ecoInputs?.[name];
    if (typeof value === "number" && !Number.isNaN(value)) {
      input.value = value;
    }
  });
}

function persistCurrentUser(user) {
  if (user) {
    localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
  } else {
    localStorage.removeItem(STORAGE_KEYS.user);
  }
}

function setCurrentUser(user) {
  state.currentUser = user ? { ...user } : null;
  persistCurrentUser(state.currentUser);
}

const dom = {
  lotGrid: document.getElementById("lot-grid"),
  emptyLots: document.querySelector("[data-empty]"),
  filterButtons: Array.from(document.querySelectorAll("[data-filter]")),
  countAll: document.querySelector("[data-count-all]"),
  countOpen: document.querySelector("[data-count-open]"),
  countLimited: document.querySelector("[data-count-limited]"),
  countFull: document.querySelector("[data-count-full]"),
  searchInput: document.querySelector("[data-search]"),
  refreshButton: document.querySelector("[data-refresh]"),
  navButtons: Array.from(document.querySelectorAll(".sidebar__nav-button[data-nav]")),
  adminNavButton: document.querySelector('.sidebar__nav-button[data-nav="admin"]'),
  pageTitle: document.querySelector("[data-page-title]"),
  pageSubtitle: document.querySelector("[data-page-subtitle]"),
  toolbar: document.querySelector("[data-toolbar]"),
  pageSections: Array.from(document.querySelectorAll("[data-page]")),
  adminPage: document.querySelector('[data-page="admin"]'),
  leaderboardBody: document.getElementById("leaderboard-body"),
  leaderboardEmpty: document.querySelector("[data-leaderboard-empty]"),
  statPoints: document.querySelector("[data-stat-points]"),
  statEco: document.querySelector("[data-stat-eco]"),
  statStreak: document.querySelector("[data-stat-streak]"),
  username: document.querySelector("[data-username]"),
  usernameInitials: document.querySelector("[data-username-initials]"),
  userEmail: document.querySelector("[data-user-email]"),
  sidebar: document.getElementById("app-sidebar"),
  themeToggle: document.querySelector("[data-theme-toggle]"),
  themeSunIcon: document.querySelector(".sidebar__mode-icon--sun"),
  themeMoonIcon: document.querySelector(".sidebar__mode-icon--moon"),
  mobileNavToggle: document.querySelector("[data-nav-toggle]"),
  reportForm: document.querySelector("[data-report-form]"),
  reportLotSelect: document.querySelector("[data-report-lot]"),
  reportStatusContainer: document.querySelector("[data-report-status]"),
  reportNote: document.querySelector("[data-report-note]"),
  reportFeedback: document.querySelector("[data-report-feedback]"),
  reportSubmit: document.querySelector("[data-report-submit]"),
  reportReset: document.querySelector("[data-report-reset]"),
  authOpen: document.querySelector("[data-auth-open]"),
  liveIndicator: document.querySelector("[data-live-indicator]"),
  liveIndicatorText: document.querySelector("[data-live-indicator-text]"),
  locateButton: document.querySelector("[data-locate]"),
  locationStatus: document.querySelector("[data-location-status]"),
  adminSearch: document.querySelector("[data-admin-search]"),
  adminFilterButtons: Array.from(document.querySelectorAll("[data-admin-filter]")),
  adminLotList: document.querySelector("[data-admin-lot-list]"),
  adminLotEmpty: document.querySelector("[data-admin-lot-empty]"),
  adminReportFeed: document.querySelector("[data-admin-report-feed]"),
  adminReportEmpty: document.querySelector("[data-admin-report-empty]"),
  adminEventForm: document.querySelector("[data-admin-event-form]"),
  adminEventFeedback: document.querySelector("[data-admin-event-feedback]"),
  adminEventSubmit: document.querySelector("[data-admin-event-submit]"),
  adminEventLots: document.querySelector("[data-admin-event-lots]"),
  adminEventImpact: document.querySelector("[data-admin-event-impact]"),
  adminEventMessage: document.querySelector("[data-admin-event-message]"),
  notificationsList: document.querySelector("[data-notification-list]"),
  notificationsEmpty: document.querySelector("[data-notifications-empty]"),
  notificationsLoading: document.querySelector("[data-notifications-loading]"),
  notificationsRefresh: document.querySelector("[data-notifications-refresh]"),
  ecoScore: document.querySelector("[data-eco-score]"),
  ecoHint: document.querySelector("[data-eco-hint]"),
  ecoNext: document.querySelector("[data-eco-next]"),
  ecoProgress: document.querySelector("[data-eco-progress]"),
  ecoCarbon: document.querySelector("[data-eco-carbon]"),
  ecoDistance: document.querySelector("[data-eco-distance]"),
  ecoTrips: document.querySelector("[data-eco-trips]"),
  ecoWeek: document.querySelector("[data-eco-week]"),
  ecoMetricCarbon: document.querySelector("[data-eco-metric-carbon]"),
  ecoMetricDistance: document.querySelector("[data-eco-metric-distance]"),
  ecoMetricTrees: document.querySelector("[data-eco-metric-trees]"),
  ecoModeList: document.querySelector("[data-eco-mode-list]"),
  ecoActionList: document.querySelector("[data-eco-action-list]"),
  ecoGoal: document.querySelector("[data-eco-goal]"),
  ecoIntro: document.querySelector("[data-eco-intro]"),
  ecoInputsForm: document.querySelector("[data-eco-inputs-form]"),
  ecoInputs: Array.from(document.querySelectorAll("[data-eco-input]")),
  ecoReset: document.querySelector("[data-eco-reset]"),
  authBanner: document.querySelector("[data-auth-banner]"),
  ecoCommuteForm: document.querySelector("[data-eco-commute-form]"),
  ecoCommuteSelect: document.querySelector("[data-eco-commute-select]"),
  ecoCommuteButton: document.querySelector("[data-eco-commute-submit]"),
  ecoCommuteFeedback: document.querySelector("[data-eco-commute-feedback]"),
};

const mobileMediaQuery = window.matchMedia ? window.matchMedia("(max-width: 720px)") : null;

init();

async function init() {
  initializeTheme();
  restoreStoredUser();
  if (!state.currentUser?.username) {
    setCurrentUser({ ...GUEST_USER });
  }
  loadEcoInputsForUser();
  updateUserProfile();
  updateStats();
  updateEcoCommuteAccess();
  renderNotifications();
  setActivePage("lots");
  attachEventListeners();
  setupReportForm();
  setupAdminDashboard();
  setupResponsiveNav();
  updateLocationControls();
  updateLocationStatus();
  await loadLots();
  startLotPolling();
}

function attachEventListeners() {
  dom.filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setFilter(button.dataset.filter);
    });
  });

  dom.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.toLowerCase();
    renderLots();
  });

  dom.refreshButton.addEventListener("click", async () => {
    dom.refreshButton.disabled = true;
    try {
      await refreshLots();
    } finally {
      dom.refreshButton.disabled = false;
    }
  });

  dom.navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const page = button.dataset.nav;
      setActivePage(page);
      closeMobileNav();
    });
  });

  if (dom.authOpen) {
    dom.authOpen.addEventListener("click", () => {
      openAuthModal(state.currentUser ? "login" : "register");
    });
  }

  if (dom.themeToggle) {
    dom.themeToggle.addEventListener("click", () => {
      toggleTheme();
    });
  }

  if (dom.locateButton) {
    dom.locateButton.addEventListener("click", handleShareLocation);
  }

  if (dom.notificationsRefresh) {
    dom.notificationsRefresh.addEventListener("click", () => {
      loadNotifications();
    });
  }

  dom.ecoInputs?.forEach((input) => {
    input.addEventListener("input", handleEcoInputChange);
    input.addEventListener("change", handleEcoInputChange);
  });

  if (dom.ecoReset) {
    dom.ecoReset.addEventListener("click", resetEcoInputs);
  }

  if (dom.ecoCommuteForm) {
    dom.ecoCommuteForm.addEventListener("submit", handleEcoCommuteSubmit);
  }
}

function setupResponsiveNav() {
  if (!dom.mobileNavToggle || !dom.sidebar) return;

  dom.mobileNavToggle.addEventListener("click", () => {
    toggleMobileNav();
  });

  const handleBreakpointChange = (event) => {
    if (!event.matches) {
      setMobileNavState(false);
      setDesktopSidebarCollapsed(state.isDesktopSidebarCollapsed);
    } else {
      setDesktopSidebarCollapsed(false);
    }
  };

  if (mobileMediaQuery) {
    if (typeof mobileMediaQuery.addEventListener === "function") {
      mobileMediaQuery.addEventListener("change", handleBreakpointChange);
    } else if (typeof mobileMediaQuery.addListener === "function") {
      mobileMediaQuery.addListener(handleBreakpointChange);
    }
  } else {
    window.addEventListener("resize", () => {
      if (!isMobileViewport()) {
        setMobileNavState(false);
        setDesktopSidebarCollapsed(state.isDesktopSidebarCollapsed);
      } else {
        setDesktopSidebarCollapsed(false);
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dom.sidebar?.classList.contains("is-open")) {
      closeMobileNav();
    }
  });

  setMobileNavState(false);
  setDesktopSidebarCollapsed(state.isDesktopSidebarCollapsed);
}

function toggleMobileNav() {
  if (isMobileViewport()) {
    const isOpen = dom.sidebar?.classList.contains("is-open");
    setMobileNavState(!isOpen);
  } else {
    toggleDesktopSidebar();
  }
}

function closeMobileNav() {
  if (isMobileViewport()) {
    setMobileNavState(false);
  }
}

function setMobileNavState(shouldOpen) {
  if (!dom.sidebar || !dom.mobileNavToggle) return;
  const enable = Boolean(shouldOpen && isMobileViewport());
  dom.sidebar.classList.toggle("is-open", enable);
  dom.mobileNavToggle.setAttribute("aria-expanded", enable ? "true" : "false");
  document.body.classList.toggle("nav-open", enable);
}

function toggleDesktopSidebar() {
  setDesktopSidebarCollapsed(!state.isDesktopSidebarCollapsed);
}

function setDesktopSidebarCollapsed(collapsed) {
  const value = Boolean(collapsed);
  state.isDesktopSidebarCollapsed = value;
  if (isMobileViewport()) {
    document.body.classList.remove("sidebar-collapsed");
    if (dom.sidebar) {
      dom.sidebar.setAttribute("aria-hidden", "false");
    }
    return;
  }
  document.body.classList.toggle("sidebar-collapsed", value);
  document.body.classList.remove("nav-open");
  if (dom.sidebar) {
    dom.sidebar.setAttribute("aria-hidden", value ? "true" : "false");
  }
  dom.mobileNavToggle?.setAttribute("aria-expanded", value ? "false" : "true");
}

function startNotificationPolling() {
  stopNotificationPolling();
  if (!state.currentUser?.username) return;
  notificationPollHandle = window.setInterval(() => {
    loadNotifications({ silent: true });
  }, NOTIFICATION_POLL_INTERVAL);
}

function stopNotificationPolling() {
  if (notificationPollHandle) {
    window.clearInterval(notificationPollHandle);
    notificationPollHandle = null;
  }
}

function startLotPolling() {
  stopLotPolling();
  lotPollHandle = window.setInterval(() => {
    loadLots().catch(() => {});
  }, LOT_POLL_INTERVAL);
}

function stopLotPolling() {
  if (lotPollHandle) {
    window.clearInterval(lotPollHandle);
    lotPollHandle = null;
  }
}

function isMobileViewport() {
  if (mobileMediaQuery) {
    return mobileMediaQuery.matches;
  }
  return window.innerWidth <= 720;
}

function setupReportForm() {
  if (!dom.reportForm || !dom.reportStatusContainer) return;

  dom.reportStatusContainer.innerHTML = "";
  STATUS_ORDER.forEach((status) => {
    const option = document.createElement("label");
    option.className = "status-selector__option";
    option.dataset.statusValue = status;

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "report-status";
    input.value = status;
    input.className = "status-selector__input";
    input.addEventListener("change", () => {
      updateReportStatus(status);
      showReportFeedback("");
    });

    option.appendChild(input);
    option.append(STATUS_META[status]?.label ?? status);
    dom.reportStatusContainer.appendChild(option);
  });

  dom.reportForm.addEventListener("submit", handleReportSubmit);
  dom.reportForm.addEventListener("reset", handleReportReset);
  dom.reportLotSelect?.addEventListener("change", handleReportLotChange);

  renderReportForm({ suppressEmptyMessage: true });
}

function setupAdminDashboard() {
  if (!dom.adminLotList) return;

  dom.adminLotList.addEventListener("click", handleAdminLotAction);

  if (dom.adminSearch) {
    dom.adminSearch.addEventListener("input", (event) => {
      state.admin.search = event.target.value.trim().toLowerCase();
      renderAdminDashboard();
    });
  }

  dom.adminFilterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setAdminFilter(button.dataset.adminFilter);
    });
  });

  if (dom.adminEventForm) {
    dom.adminEventForm.addEventListener("submit", handleAdminEventSubmit);
    dom.adminEventForm.addEventListener("reset", () => {
      setAdminEventFeedback("");
      setAdminEventSubmitting(false);
    });
  }

  if (dom.adminSearch) {
    dom.adminSearch.value = state.admin.search;
  }

  setAdminEventFeedback("");
  setAdminFilter(state.admin.filter);
}

function renderReportForm(options = {}) {
  if (!dom.reportForm || !dom.reportLotSelect) return;
  const { preserveFeedback = false, suppressEmptyMessage = false } = options;
  const lots = state.lots;
  const hasLots = lots.length > 0;

  if (!hasLots) {
    state.report.selectedLotId = null;
    state.report.selectedStatus = null;
  } else if (
    !state.report.selectedLotId ||
    !lots.some((lot) => lot.id === state.report.selectedLotId)
  ) {
    state.report.selectedLotId = lots[0].id;
    state.report.selectedStatus = null;
  }

  dom.reportLotSelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.disabled = true;
  placeholder.textContent = hasLots ? "Select a lot" : "No lots available";
  if (!hasLots) {
    placeholder.selected = true;
    placeholder.defaultSelected = true;
  }
  dom.reportLotSelect.appendChild(placeholder);

  if (hasLots) {
    const selectedLotId = state.report.selectedLotId;
    lots.forEach((lot, index) => {
      const option = document.createElement("option");
      option.value = String(lot.id);
      option.textContent = `${lot.name} (${lot.code})`;
      if (lot.id === selectedLotId || (!selectedLotId && index === 0)) {
        option.selected = true;
        option.defaultSelected = true;
        state.report.selectedLotId = lot.id;
      }
      dom.reportLotSelect.appendChild(option);
    });

    dom.reportLotSelect.value = String(state.report.selectedLotId);
    const lot = getSelectedReportLot();
    const defaultStatus = lot?.status ?? STATUS_ORDER[0];
    if (!state.report.selectedStatus || !STATUS_META[state.report.selectedStatus]) {
      state.report.selectedStatus = defaultStatus;
    }
    updateReportStatus(state.report.selectedStatus);
  } else {
    dom.reportLotSelect.value = "";
    updateReportStatus(null);
  }

  const disable = !hasLots || state.report.isSubmitting;
  setReportFormDisabled(disable);

  if (!hasLots) {
    if (!suppressEmptyMessage && !preserveFeedback) {
      showReportFeedback("No parking lots available to report right now.", true);
    }
  } else if (!state.report.isSubmitting && !preserveFeedback) {
    showReportFeedback("");
  }
}

function handleReportLotChange(event) {
  const value = Number(event.target.value);
  if (!Number.isFinite(value)) {
    state.report.selectedLotId = null;
    state.report.selectedStatus = null;
    updateReportStatus(null);
    return;
  }

  state.report.selectedLotId = value;
  const lot = getSelectedReportLot();
  const nextStatus = lot?.status ?? STATUS_ORDER[0];
  state.report.selectedStatus = nextStatus;
  updateReportStatus(nextStatus);
}

function handleReportReset() {
  const lots = state.lots;
  if (lots.length) {
    state.report.selectedLotId = lots[0].id;
    const lot = getSelectedReportLot();
    const status = lot?.status ?? STATUS_ORDER[0];
    state.report.selectedStatus = status;
    dom.reportLotSelect.value = String(state.report.selectedLotId);
    updateReportStatus(status);
  } else {
    state.report.selectedLotId = null;
    state.report.selectedStatus = null;
    updateReportStatus(null);
  }
  if (dom.reportNote) {
    dom.reportNote.value = "";
  }
  showReportFeedback("");
  setReportFormDisabled(!state.lots.length);
}

async function handleReportSubmit(event) {
  event.preventDefault();
  if (state.report.isSubmitting) return;
  if (!state.currentUser?.username) {
    setCurrentUser({ ...GUEST_USER });
  }
  const lotIdValue = Number(dom.reportLotSelect?.value);
  if (!Number.isFinite(lotIdValue)) {
    showReportFeedback("Select a parking lot to report.", true);
    return;
  }
  const status = state.report.selectedStatus;
  if (!status || !STATUS_META[status]) {
    showReportFeedback("Pick a status before submitting.", true);
    return;
  }

  const payload = {
    lotId: lotIdValue,
    status,
    note: dom.reportNote?.value?.trim() ?? "",
    username: state.currentUser.username,
  };

  state.report.isSubmitting = true;
  setReportFormDisabled(true);
    showReportFeedback("Submitting report…");

    let feedbackMessage = "";
    let preserveFeedback = false;
    let feedbackIsError = false;
    try {
      const result = await postReport(payload);
      setCurrentUser(result.user);
      updateStats();
      updateUserProfile();

    mergeUpdatedLot(result.lot);
    state.report.selectedLotId = result.lot?.id ?? state.report.selectedLotId;
    state.report.selectedStatus = result.lot?.status ?? status;

    renderCounts();
    renderLots();
    renderAdminDashboard();
    await loadLeaderboard();

    const lot = getSelectedReportLot();
    const lotName = lot?.name ?? "the selected lot";
    const meta = STATUS_META[state.report.selectedStatus] ?? STATUS_META.OPEN;
    feedbackMessage = `Thanks! ${lotName} is now marked as ${meta.label}.`;
    preserveFeedback = true;
    if (dom.reportNote) {
      dom.reportNote.value = "";
    }
  } catch (error) {
    console.error(error);
    feedbackMessage = "We couldn't submit that report. Try again?";
    feedbackIsError = true;
    preserveFeedback = true;
    showReportFeedback(feedbackMessage, true);
  } finally {
    state.report.isSubmitting = false;
    renderReportForm({ preserveFeedback });
    if (feedbackMessage && !feedbackIsError) {
      showReportFeedback(feedbackMessage);
    } else if (!feedbackMessage && !state.lots.length) {
      showReportFeedback("No parking lots available to report right now.", true);
    }
  }
}

function updateReportStatus(status) {
  if (!dom.reportStatusContainer) return;
  if (status && STATUS_META[status]) {
    state.report.selectedStatus = status;
  } else {
    state.report.selectedStatus = null;
  }

  const options = dom.reportStatusContainer.querySelectorAll(".status-selector__option");
  options.forEach((option) => {
    const input = option.querySelector(".status-selector__input");
    const matches = Boolean(input && input.value === state.report.selectedStatus);
    if (input) {
      input.checked = matches;
    }
    option.classList.toggle("is-active", matches);
  });
}

function setReportFormDisabled(disabled) {
  if (dom.reportLotSelect) {
    dom.reportLotSelect.disabled = disabled;
  }
  getReportStatusInputs().forEach((input) => {
    input.disabled = disabled;
  });
  if (dom.reportNote) {
    dom.reportNote.disabled = disabled;
  }
  if (dom.reportSubmit) {
    dom.reportSubmit.disabled = disabled;
  }
  if (dom.reportReset) {
    dom.reportReset.disabled = disabled;
  }
}

function getReportStatusInputs() {
  if (!dom.reportStatusContainer) return [];
  return Array.from(
    dom.reportStatusContainer.querySelectorAll('input[name="report-status"]')
  );
}

function showReportFeedback(message = "", isError = false) {
  if (!dom.reportFeedback) return;
  if (!message) {
    dom.reportFeedback.textContent = "";
    dom.reportFeedback.classList.add("is-hidden");
    dom.reportFeedback.classList.remove("form__feedback--error");
    return;
  }

  dom.reportFeedback.textContent = message;
  dom.reportFeedback.classList.toggle("form__feedback--error", Boolean(isError));
  dom.reportFeedback.classList.remove("is-hidden");
}

function getSelectedReportLot() {
  if (!state.report.selectedLotId) return null;
  const targetId = Number(state.report.selectedLotId);
  return state.lots.find((lot) => lot.id === targetId) ?? null;
}

function openAuthModal(initialMode = "login") {
  const modal = createModal("Account Access");
  const body = modal.querySelector(".modal__body");
  body.classList.add("auth-modal");

  if (state.currentUser) {
    body.appendChild(createAccountSummary(modal));
  }

  const tabs = document.createElement("div");
  tabs.className = "auth-tabs";
  const modes = [
    { id: "login", label: "Log in" },
    { id: "register", label: "Create account" },
  ];
  const panel = document.createElement("div");
  panel.className = "auth-panel";

  modes.forEach((mode) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "auth-tabs__button";
    button.textContent = mode.label;
    button.dataset.mode = mode.id;
    button.addEventListener("click", () => {
      setActiveAuthMode(mode.id);
    });
    tabs.appendChild(button);
  });

  body.append(tabs, panel);

  function setActiveAuthMode(mode) {
    modes.forEach((entry) => {
      const button = tabs.querySelector(`[data-mode="${entry.id}"]`);
      if (button) {
        button.classList.toggle("is-active", entry.id === mode);
      }
    });
    panel.innerHTML = "";
    if (mode === "register") {
      panel.appendChild(createRegisterForm({ modal }));
    } else {
      panel.appendChild(createLoginForm({ modal }));
    }
  }

  setActiveAuthMode(initialMode);
}

function createAccountSummary(modal) {
  const wrapper = document.createElement("section");
  wrapper.className = "auth-summary";
  const title = document.createElement("h4");
  title.className = "auth-summary__title";
  title.textContent = "Current account";
  const info = document.createElement("p");
  info.className = "auth-summary__meta";
  info.textContent = `${state.currentUser.username} · ${state.currentUser.email}`;
  const logoutBtn = document.createElement("button");
  logoutBtn.type = "button";
  logoutBtn.className = "btn btn--ghost auth-summary__action";
  logoutBtn.textContent = "Log out";
  logoutBtn.addEventListener("click", () => handleLogout(modal));
  wrapper.append(title, info, logoutBtn);
  return wrapper;
}

function createLoginForm(context) {
  const form = document.createElement("form");
  form.className = "form auth-form";
  form.noValidate = true;

  const emailGroup = document.createElement("div");
  emailGroup.className = "form__group";
  const emailLabel = document.createElement("label");
  emailLabel.className = "form__label";
  emailLabel.htmlFor = "auth-email";
  emailLabel.textContent = "Email";
  const emailInput = document.createElement("input");
  emailInput.id = "auth-email";
  emailInput.name = "email";
  emailInput.type = "email";
  emailInput.className = "input";
  emailInput.placeholder = "you@kean.edu";
  emailInput.autocomplete = "email";
  emailGroup.append(emailLabel, emailInput);

  const passwordGroup = document.createElement("div");
  passwordGroup.className = "form__group";
  const passwordLabel = document.createElement("label");
  passwordLabel.className = "form__label";
  passwordLabel.htmlFor = "auth-password";
  passwordLabel.textContent = "Password";
  const passwordInput = document.createElement("input");
  passwordInput.id = "auth-password";
  passwordInput.name = "password";
  passwordInput.type = "password";
  passwordInput.className = "input";
  passwordInput.placeholder = "********";
  passwordInput.autocomplete = "current-password";
  passwordGroup.append(passwordLabel, passwordInput);

  const feedbackEl = document.createElement("p");
  feedbackEl.className = "form__feedback is-hidden";

  const actions = document.createElement("div");
  actions.className = "form__actions auth-form__actions";
  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "btn btn--primary";
  submitBtn.textContent = "Log in";
  actions.appendChild(submitBtn);

  form.append(emailGroup, passwordGroup, feedbackEl, actions);

  const feedbackContext = { feedbackEl };
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = emailInput.value?.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      setAuthFeedback(feedbackContext, "Enter your email and password.", true);
      return;
    }
    submitBtn.disabled = true;
    setAuthFeedback(feedbackContext, "Signing you in…");
    try {
      await loginAccount({ email, password });
      await Promise.all([loadUser(), loadLeaderboard()]);
      renderReportForm();
      closeModal(context.modal);
    } catch (error) {
      console.error(error);
      const message = error?.message || "Couldn't log in. Try again?";
      setAuthFeedback(feedbackContext, message, true);
    } finally {
      submitBtn.disabled = false;
    }
  });

  requestAnimationFrame(() => emailInput.focus());
  return form;
}

function createRegisterForm(context) {
  const form = document.createElement("form");
  form.className = "form auth-form";
  form.noValidate = true;

  const usernameGroup = document.createElement("div");
  usernameGroup.className = "form__group";
  const usernameLabel = document.createElement("label");
  usernameLabel.className = "form__label";
  usernameLabel.htmlFor = "auth-register-username";
  usernameLabel.textContent = "Username";
  const usernameInput = document.createElement("input");
  usernameInput.id = "auth-register-username";
  usernameInput.name = "username";
  usernameInput.className = "input";
  usernameInput.placeholder = "e.g., cougar_jane";
  usernameInput.autocomplete = "nickname";
  usernameGroup.append(usernameLabel, usernameInput);

  const emailGroup = document.createElement("div");
  emailGroup.className = "form__group";
  const emailLabel = document.createElement("label");
  emailLabel.className = "form__label";
  emailLabel.htmlFor = "auth-register-email";
  emailLabel.textContent = "Email";
  const emailInput = document.createElement("input");
  emailInput.id = "auth-register-email";
  emailInput.name = "email";
  emailInput.type = "email";
  emailInput.className = "input";
  emailInput.placeholder = "you@kean.edu";
  emailInput.autocomplete = "email";
  emailGroup.append(emailLabel, emailInput);

  const passwordGroup = document.createElement("div");
  passwordGroup.className = "form__group";
  const passwordLabel = document.createElement("label");
  passwordLabel.className = "form__label";
  passwordLabel.htmlFor = "auth-register-password";
  passwordLabel.textContent = "Password";
  const passwordInput = document.createElement("input");
  passwordInput.id = "auth-register-password";
  passwordInput.name = "password";
  passwordInput.type = "password";
  passwordInput.className = "input";
  passwordInput.placeholder = "At least 8 characters";
  passwordInput.autocomplete = "new-password";
  passwordGroup.append(passwordLabel, passwordInput);

  const feedbackEl = document.createElement("p");
  feedbackEl.className = "form__feedback is-hidden";

  const actions = document.createElement("div");
  actions.className = "form__actions auth-form__actions";
  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "btn btn--primary";
  submitBtn.textContent = "Create account";
  actions.appendChild(submitBtn);

  form.append(usernameGroup, emailGroup, passwordGroup, feedbackEl, actions);

  const feedbackContext = { feedbackEl };
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = usernameInput.value?.trim();
    const email = emailInput.value?.trim();
    const password = passwordInput.value;
    if (!username || !email || !password) {
      setAuthFeedback(feedbackContext, "Fill out all fields to continue.", true);
      return;
    }
    submitBtn.disabled = true;
    setAuthFeedback(feedbackContext, "Creating your account…");
    try {
      await registerAccount({ username, email, password });
      await Promise.all([loadUser(), loadLeaderboard()]);
      renderReportForm();
      closeModal(context.modal);
    } catch (error) {
      console.error(error);
      const message = error?.message || "Couldn't create that account.";
      setAuthFeedback(feedbackContext, message, true);
    } finally {
      submitBtn.disabled = false;
    }
  });

  requestAnimationFrame(() => usernameInput.focus());
  return form;
}

function setAuthFeedback(context, message = "", isError = false) {
  const el = context?.feedbackEl;
  if (!el) return;
  if (!message) {
    el.textContent = "";
    el.classList.add("is-hidden");
    el.classList.remove("form__feedback--error");
    return;
  }
  el.textContent = message;
  el.classList.toggle("form__feedback--error", Boolean(isError));
  el.classList.remove("is-hidden");
}

async function registerAccount({ username, email, password }) {
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email, password }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Registration failed");
  }
  applyAuthenticatedUser(payload.user);
}

async function loginAccount({ email, password }) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Login failed");
  }
  applyAuthenticatedUser(payload.user);
}

function applyAuthenticatedUser(user) {
  setCurrentUser(user);
  loadEcoInputsForUser();
  updateUserProfile();
  updateStats();
  updateEcoCommuteAccess();
  state.location.error = "";
  updateLocationControls();
  updateLocationStatus();
  if (state.leaderboard.length) {
    renderLeaderboard();
  }
  renderAdminDashboard();
  renderNotifications();
  startNotificationPolling();
  loadNotifications();
}

function handleLogout(modal) {
  setCurrentUser({ ...GUEST_USER });
  loadEcoInputsForUser();
  state.location.isRequesting = false;
  state.location.error = "";
  stopNotificationPolling();
  state.notifications = [];
  state.notificationsLoading = false;
  updateUserProfile();
  updateStats();
  updateEcoCommuteAccess();
  updateLocationControls();
  updateLocationStatus();
  if (state.leaderboard.length) {
    renderLeaderboard();
  }
  renderReportForm();
  renderAdminDashboard();
  renderNotifications();
  showReportFeedback("You are now using guest access.", false);
  closeModal(modal);
}

function updateUserProfile() {
  const username = state.currentUser?.username ?? "Guest";
  dom.username.textContent = username;
  dom.userEmail.textContent = "No account required";
  const initialsSource = state.currentUser?.username ?? "";
  dom.usernameInitials.textContent = initialsSource ? initialsFor(initialsSource) : "–";
  if (dom.authOpen) {
    dom.authOpen.textContent = state.currentUser ? "Account" : "Guest";
  }
  updateLocationControls();
  updateLocationStatus();
  updateAdminAccess();
  updateAuthAccess();
  updateEcoCommuteAccess();
}

function updateStats() {
  const points = state.currentUser?.points ?? 0;
  const ecoSnapshot = getEcoSnapshot(points);
  const reports = state.currentUser?.reports ?? 0;
  if (dom.statPoints) {
    dom.statPoints.textContent = points;
  }
  if (dom.statEco) {
    dom.statEco.textContent = ecoSnapshot.ecoPoints;
  }
  if (dom.statStreak) {
    dom.statStreak.textContent = `${reports} day${reports === 1 ? "" : "s"}`;
  }
  renderEcoSection();
}

function isAdminUser() {
  return Boolean(state.currentUser?.is_admin);
}

function updateAdminAccess() {
  const isAdmin = isAdminUser();
  if (dom.adminNavButton) {
    dom.adminNavButton.classList.toggle("is-hidden", !isAdmin);
    dom.adminNavButton.setAttribute("aria-hidden", isAdmin ? "false" : "true");
    if (isAdmin) {
      dom.adminNavButton.removeAttribute("tabindex");
    } else {
      dom.adminNavButton.setAttribute("tabindex", "-1");
    }
  }
  if (dom.adminPage) {
    dom.adminPage.setAttribute("aria-hidden", isAdmin ? "false" : "true");
  }
  if (!isAdmin && state.activePage === "admin") {
    setActivePage("lots");
  }
}

function updateAuthAccess() {
  const hasUser = true;
  dom.navButtons.forEach((button) => {
    const nav = button.dataset.nav;
    const restrict = nav && nav !== "lots";
    if (restrict) {
      button.disabled = !hasUser;
      button.title = "";
    }
  });
  if (dom.authBanner) {
    dom.authBanner.classList.add("is-hidden");
  }
}

function hasGeolocationSupport() {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

function updateLocationControls() {
  if (!dom.locateButton) return;
  const hasUser = Boolean(state.currentUser?.username);
  let label = state.currentUser?.location_updated_at ? "Update location" : "Share location";
  if (!hasUser) {
    label = "Share location";
  }
  if (!hasGeolocationSupport()) {
    label = "Location unavailable";
  }
  if (state.location.isRequesting) {
    label = "Sharing…";
  }
  dom.locateButton.textContent = label;
  const disable = state.location.isRequesting || !hasGeolocationSupport() || !hasUser;
  dom.locateButton.disabled = disable;
  if (!hasGeolocationSupport()) {
    dom.locateButton.title = "Location isn't supported on this device.";
  } else {
    dom.locateButton.removeAttribute("title");
  }
}

function updateLocationStatus() {
  if (!dom.locationStatus) return;
  dom.locationStatus.classList.remove("is-error");
  if (!hasGeolocationSupport()) {
    dom.locationStatus.textContent = "Location not supported on this device.";
    return;
  }
  if (state.location.isRequesting) {
    dom.locationStatus.textContent = "Sharing location…";
    return;
  }
  if (state.location.error) {
    dom.locationStatus.textContent = state.location.error;
    dom.locationStatus.classList.add("is-error");
    return;
  }
  dom.locationStatus.textContent = formatLocationSummary();
}

function formatLocationSummary() {
  const updatedAt = Number(state.currentUser?.location_updated_at);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    return "Location not shared yet.";
  }
  const recency = formatRelativeAge(updatedAt) || "just now";
  const accuracy = Number(state.currentUser?.location_accuracy);
  const accuracyText = Number.isFinite(accuracy) ? ` · ±${Math.round(accuracy)}m` : "";
  return `Shared ${recency}${accuracyText}`;
}

async function handleShareLocation() {
  if (!state.currentUser?.username) {
    setCurrentUser({ ...GUEST_USER });
  }
  if (!hasGeolocationSupport()) {
    state.location.error = "Location isn't supported on this device.";
    updateLocationStatus();
    return;
  }
  state.location.error = "";
  updateLocationStatus();
  setLocationRequesting(true);
  try {
    const position = await requestBrowserLocation();
    const timestamp = Date.now();
    setCurrentUser({
      ...(state.currentUser || { ...GUEST_USER }),
      last_latitude: Number(position.coords.latitude),
      last_longitude: Number(position.coords.longitude),
      location_accuracy: Number.isFinite(position.coords.accuracy) ? Number(position.coords.accuracy) : null,
      location_updated_at: timestamp,
    });
    updateUserProfile();
    updateStats();
    try {
      await saveUserLocation(position.coords);
    } catch (error) {
      console.warn("Failed to persist user location on server", error);
    }
    state.location.error = "";
    await loadLots();
    renderReportForm();
    renderAdminDashboard();
  } catch (error) {
    state.location.error = getLocationErrorMessage(error);
  } finally {
    setLocationRequesting(false);
    updateLocationStatus();
  }
}

function setLocationRequesting(value) {
  state.location.isRequesting = Boolean(value);
  updateLocationControls();
  updateLocationStatus();
}

function requestBrowserLocation() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
  });
}

async function saveUserLocation(coords) {
  if (!state.currentUser?.username) {
    throw new Error("User not found");
  }
  const payload = {
    latitude: coords.latitude,
    longitude: coords.longitude,
  };
  if (Number.isFinite(coords.accuracy)) {
    payload.accuracy = coords.accuracy;
  }
  const response = await fetch(`/api/users/${encodeURIComponent(state.currentUser.username)}/location`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error("Failed to save location");
  }
  const data = await response.json();
  if (data.user) {
    setCurrentUser(data.user);
    updateUserProfile();
    updateStats();
  }
}

function getLocationErrorMessage(error) {
  if (!error) return "Couldn't update location.";
  if (typeof error === "string") return error;
  if (typeof error.message === "string" && !error.code) {
    return error.message;
  }
  switch (error.code) {
    case error.PERMISSION_DENIED:
    case 1:
      return "Permission denied. Enable location access to continue.";
    case error.POSITION_UNAVAILABLE:
    case 2:
      return "Unable to determine your location right now.";
    case error.TIMEOUT:
    case 3:
      return "Location request timed out. Try again.";
    default:
      return "Couldn't update location.";
  }
}

function updateLiveIndicator() {
  if (!dom.liveIndicator || !dom.liveIndicatorText) return;
  dom.liveIndicator.classList.remove("is-live", "is-stale", "is-estimate");
  dom.liveIndicator.classList.add("is-estimate");

  if (!state.lots.length) {
    dom.liveIndicatorText.textContent = "Estimated data unavailable";
    dom.liveIndicator.removeAttribute("title");
    return;
  }

  const source = state.dataSource || {};
  const basis = source.components || {};
  const historicalContext = basis.historical;
  const reportCount = Number(basis.reports?.lots_adjusted) || 0;
  const latestTimestamp = state.lots.reduce((latest, lot) => {
    const value = Number(lot.last_updated);
    if (!Number.isFinite(value)) return latest;
    return value > latest ? value : latest;
  }, Number(source.generated_at) || 0);

  const recencyLabel = latestTimestamp ? formatRelativeAge(latestTimestamp) : "";
  const summaryParts = ["Estimated availability"];
  if (recencyLabel) {
    summaryParts.push(recencyLabel);
  }
  dom.liveIndicatorText.textContent = summaryParts.join(" · ");

  const basisParts = [];
  if (historicalContext) {
    basisParts.push("historical patterns");
  }
  if (reportCount > 0) {
    basisParts.push(`${reportCount} recent report${reportCount === 1 ? "" : "s"}`);
  } else {
    basisParts.push("latest community reports when available");
  }
  dom.liveIndicator.title = `Estimates blend ${basisParts.join(" + ")}.`;
}

function getLotsEndpoint(path) {
  const base = path || "/api/lots";
  const params = new URLSearchParams();
  const username = state.currentUser?.username;
  if (username) {
    params.set("username", username);
  }
  const latitude = Number(state.currentUser?.last_latitude);
  const longitude = Number(state.currentUser?.last_longitude);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    params.set("latitude", String(latitude));
    params.set("longitude", String(longitude));
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

async function loadLots() {
  if (isLoadingLots) return;
  isLoadingLots = true;
  try {
    const response = await fetch(getLotsEndpoint("/api/lots"));
    if (!response.ok) {
      console.error("Failed to load lots");
      return;
    }
    const payload = await response.json();
    state.lots = payload.lots;
    state.dataSource = payload.source || null;
    renderCounts();
    renderLots();
    renderReportForm();
    renderAdminDashboard();
  } catch (error) {
    console.error("Failed to load lots", error);
  } finally {
    isLoadingLots = false;
  }
}

async function loadLeaderboard() {
  const response = await fetch("/api/leaderboard");
  if (!response.ok) {
    console.error("Failed to load leaderboard");
    return;
  }
  const payload = await response.json();
  state.leaderboard = payload.leaderboard;
  renderLeaderboard();
}

async function loadUser() {
  const username = state.currentUser?.username;
  if (!username) return;
  const response = await fetch(`/api/users/${encodeURIComponent(username)}`);
  if (!response.ok) {
    console.error("Failed to load user stats");
    return;
  }
  const payload = await response.json();
  setCurrentUser(payload.user);
  updateStats();
  updateUserProfile();
  renderLeaderboard();
  renderAdminDashboard();
  renderNotifications();
}

async function loadNotifications(options = {}) {
  const silent = Boolean(options?.silent);
  const username = state.currentUser?.username;
  if (!username) {
    state.notifications = [];
    state.notificationsLoading = false;
    renderNotifications();
    return;
  }
  if (!silent) {
    state.notificationsLoading = true;
    renderNotifications();
  }
  try {
    const response = await fetch(
      `/api/notifications?username=${encodeURIComponent(username)}`
    );
    if (!response.ok) {
      throw new Error("Failed to load notifications");
    }
    const payload = await response.json();
    state.notifications = payload.notifications ?? [];
  } catch (error) {
    console.error(error);
    state.notifications = [];
  } finally {
    if (!silent) {
      state.notificationsLoading = false;
    }
    renderNotifications();
  }
}

function handleEcoInputChange(event) {
  const name = event.target?.dataset?.ecoInput;
  if (!name) return;
  const value = Number(event.target.value);
  const normalized = Number.isFinite(value) ? Math.max(0, value) : 0;
  state.ecoInputs = { ...state.ecoInputs, [name]: normalized };
  persistEcoInputs();
  renderEcoSection();
  updateStats();
}

function resetEcoInputs() {
  state.ecoInputs = getDefaultEcoInputs();
  persistEcoInputs();
  renderEcoInputsForm();
  renderEcoSection();
  updateStats();
}

function setEcoCommuteFeedback(message = "", variant = "muted") {
  const el = dom.ecoCommuteFeedback;
  state.ecoCommute.message = message || "";
  if (!el) return;
  if (!message) {
    el.textContent = "";
    el.classList.add("is-hidden");
    el.classList.remove("is-success", "is-error");
    return;
  }
  el.textContent = message;
  el.classList.remove("is-hidden");
  el.classList.toggle("is-success", variant === "success");
  el.classList.toggle("is-error", variant === "error");
}

function updateEcoCommuteAccess() {
  if (!dom.ecoCommuteSelect || !dom.ecoCommuteButton) return;
  const hasUser = Boolean(state.currentUser?.username);
  const isBusy = Boolean(state.ecoCommute?.isSubmitting);
  dom.ecoCommuteSelect.disabled = !hasUser || isBusy;
  dom.ecoCommuteButton.disabled = !hasUser || isBusy;
  if (!state.ecoCommute.message) {
    setEcoCommuteFeedback("", "muted");
  }
}

async function handleEcoCommuteSubmit(event) {
  event.preventDefault();
  const mode = dom.ecoCommuteSelect?.value;
  if (!mode) {
    setEcoCommuteFeedback("Pick how you arrived before logging.", "error");
    return;
  }
  state.ecoCommute.isSubmitting = true;
  updateEcoCommuteAccess();
  setEcoCommuteFeedback("Logging your commute…");
  try {
    const response = await fetch("/api/eco-commute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: state.currentUser.username,
        mode,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || "Could not log commute.");
    }
    if (payload?.user) {
      setCurrentUser(payload.user);
      updateUserProfile();
      updateStats();
    }
    if (payload?.success && typeof loadLeaderboard === "function") {
      loadLeaderboard();
    }
    const variant = payload?.success ? "success" : "error";
    setEcoCommuteFeedback(payload?.message || "Request completed.", variant);
  } catch (error) {
    console.error(error);
    setEcoCommuteFeedback("Could not log your commute. Please try again.", "error");
  } finally {
    state.ecoCommute.isSubmitting = false;
    updateEcoCommuteAccess();
  }
}

function renderLots() {
  const filtered = state.lots.filter((lot) => {
    const matchesFilter = state.filter === "ALL" || lot.status === state.filter;
    const matchesSearch =
      !state.search ||
      lot.name.toLowerCase().includes(state.search) ||
      lot.code.toLowerCase().includes(state.search);
    return matchesFilter && matchesSearch;
  });

  dom.lotGrid.innerHTML = "";

  if (filtered.length === 0) {
    dom.emptyLots.classList.remove("is-hidden");
    updateLiveIndicator();
    return;
  }

  dom.emptyLots.classList.add("is-hidden");
  const template = document.getElementById("lot-card-template");

  filtered.forEach((lot) => {
    const node = template.content.firstElementChild.cloneNode(true);
    populateLotCard(node, lot);
    dom.lotGrid.appendChild(node);
  });

  updateLiveIndicator();
}

function setAdminFilter(rawFilter) {
  const upper = String(rawFilter || "ALL").toUpperCase();
  const next = upper === "ALL" || STATUS_META[upper] ? upper : "ALL";
  state.admin.filter = next;
  dom.adminFilterButtons.forEach((button) => {
    const isActive = button.dataset.adminFilter === next;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  renderAdminDashboard();
}

function renderAdminDashboard() {
  if (!dom.adminLotList && !dom.adminReportFeed) return;
  renderAdminLots();
  populateAdminEventLots();
  renderAdminReports();
}

function getAdminFilteredLots() {
  const search = state.admin.search;
  const filter = state.admin.filter;
  return state.lots.filter((lot) => {
    const matchesFilter = filter === "ALL" || lot.status === filter;
    if (!matchesFilter) return false;
    if (!search) return true;
    const lotName = String(lot.name || "").toLowerCase();
    const lotCode = String(lot.code || "").toLowerCase();
    return lotName.includes(search) || lotCode.includes(search);
  });
}

function renderAdminLots() {
  if (!dom.adminLotList) return;
  const filteredLots = getAdminFilteredLots();
  dom.adminLotList.innerHTML = "";

  if (!filteredLots.length) {
    dom.adminLotEmpty?.classList.remove("is-hidden");
    return;
  }

  dom.adminLotEmpty?.classList.add("is-hidden");

  filteredLots.forEach((lot) => {
    const item = document.createElement("li");
    item.className = "admin-lot";

    const header = document.createElement("div");
    header.className = "admin-lot__top";

    const name = document.createElement("span");
    name.className = "admin-lot__name";
    name.textContent = lot.name;
    header.appendChild(name);

    header.appendChild(createStatusPill(lot.status, { compact: true }));
    item.appendChild(header);

    const occupancy = document.createElement("p");
    occupancy.className = "admin-lot__meta";
    const lotCode = lot.code || "—";
    const occupancyCount = Number.isFinite(Number(lot.occupancy)) ? Number(lot.occupancy) : 0;
    const capacityCount = Number.isFinite(Number(lot.capacity)) ? Number(lot.capacity) : 0;
    occupancy.textContent = `${lotCode} · est. ${occupancyCount}/${capacityCount} occupied`;
    item.appendChild(occupancy);

    const updated = document.createElement("p");
    updated.className = "admin-lot__meta";
    updated.textContent = formatEstimateLabel(lot);
    item.appendChild(updated);

    const walk = document.createElement("p");
    walk.className = "admin-lot__meta";
    walk.textContent = formatWalkMeta(lot);
    item.appendChild(walk);

    const actions = document.createElement("div");
    actions.className = "admin-lot__actions";

    const statusSelect = document.createElement("select");
    statusSelect.className = "admin-lot__select";
    statusSelect.dataset.adminLotStatus = lot.id;
    STATUS_ORDER.forEach((status) => {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = status;
      if (status === lot.status) {
        option.selected = true;
      }
      statusSelect.appendChild(option);
    });
    actions.appendChild(statusSelect);

    const noteInput = document.createElement("input");
    noteInput.type = "text";
    noteInput.className = "admin-lot__note";
    noteInput.placeholder = "Optional note";
    noteInput.dataset.adminLotNote = lot.id;
    actions.appendChild(noteInput);

    const updateButton = document.createElement("button");
    updateButton.type = "button";
    updateButton.className = "btn btn--ghost admin-lot__update";
    updateButton.textContent = "Update";
    updateButton.dataset.adminLotUpdate = lot.id;
    actions.appendChild(updateButton);

    item.appendChild(actions);

    dom.adminLotList.appendChild(item);
  });
}

function populateAdminEventLots() {
  if (!dom.adminEventLots) return;
  const previousSelections = new Set(
    Array.from(dom.adminEventLots.selectedOptions || []).map((option) => Number(option.value))
  );
  dom.adminEventLots.innerHTML = "";
  state.lots.forEach((lot) => {
    const option = document.createElement("option");
    option.value = String(lot.id);
    option.textContent = `${lot.name} (${lot.code})`;
    if (previousSelections.has(lot.id)) {
      option.selected = true;
    }
    dom.adminEventLots.appendChild(option);
  });
}

function handleAdminLotAction(event) {
  const button = event.target.closest("[data-admin-lot-update]");
  if (!button) return;
  event.preventDefault();
  const lotId = Number(button.dataset.adminLotUpdate);
  if (!Number.isFinite(lotId)) return;
  const select = dom.adminLotList?.querySelector(`[data-admin-lot-status="${lotId}"]`);
  const noteInput = dom.adminLotList?.querySelector(`[data-admin-lot-note="${lotId}"]`);
  const statusValue = select?.value;
  if (!statusValue || !STATUS_META[statusValue]) {
    alert("Choose a valid status before updating.");
    return;
  }
  const note = noteInput?.value?.trim() ?? "";
  submitAdminLotStatus(lotId, statusValue, note, button, noteInput);
}

async function submitAdminLotStatus(lotId, status, note, button, noteInput) {
  if (!state.currentUser?.username) {
    alert("Log in as an admin to update lot statuses.");
    return;
  }
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Updating…";
  try {
    const payload = {
      username: state.currentUser.username,
      status,
      note,
    };
    const response = await fetch(`/api/admin/lots/${lotId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || "Failed to update lot status.");
    }
    mergeUpdatedLot(data.lot);
    renderAdminDashboard();
    renderLots();
    renderReportForm();
    renderCounts();
    button.textContent = "Updated!";
    if (noteInput) {
      noteInput.value = "";
    }
    loadNotifications({ silent: true });
  } catch (error) {
    console.error(error);
    button.textContent = "Try again";
    alert(error?.message || "Failed to update lot status.");
  } finally {
    setTimeout(() => {
      button.disabled = false;
      button.textContent = originalLabel;
    }, 1200);
  }
}

async function sendAdminEventNotification(details) {
  if (!details?.username) {
    throw new Error("Log in as an admin to send notifications.");
  }
  const response = await fetch("/api/admin/events/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(details),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Failed to send event notification.");
  }
  return payload;
}

function renderAdminReports() {
  if (!dom.adminReportFeed) return;
  dom.adminReportFeed.innerHTML = "";

  const reports = state.lots
    .map((lot) => (lot.lastReport ? { lot, report: lot.lastReport } : null))
    .filter(Boolean)
    .sort((a, b) => (Number(b.report.created_at) || 0) - (Number(a.report.created_at) || 0))
    .slice(0, 5);

  if (!reports.length) {
    dom.adminReportEmpty?.classList.remove("is-hidden");
    return;
  }

  dom.adminReportEmpty?.classList.add("is-hidden");

  reports.forEach(({ lot, report }) => {
    const item = document.createElement("li");
    item.className = "admin-report";

    const header = document.createElement("div");
    header.className = "admin-report__header";

    const lotName = document.createElement("span");
    lotName.className = "admin-report__lot";
    lotName.textContent = lot.name;
    header.appendChild(lotName);

    header.appendChild(createStatusPill(report.reported_status, { compact: true }));
    item.appendChild(header);

    const meta = document.createElement("p");
    meta.className = "admin-report__meta";
    const recency = formatRelativeAge(report.created_at);
    const timestamp = recency || formatDateTime(report.created_at);
    const reporter = report.user || "Anonymous";
    meta.textContent = `Reported by ${reporter} · ${timestamp}`;
    item.appendChild(meta);

    if (report.note) {
      const note = document.createElement("p");
      note.className = "admin-report__note";
      note.textContent = report.note;
      item.appendChild(note);
    }

    dom.adminReportFeed.appendChild(item);
  });
}

function createStatusPill(status, options = {}) {
  const { compact = false } = options;
  const meta = STATUS_META[status] || STATUS_META.OPEN;
  const pill = document.createElement("span");
  pill.className = "status-pill";
  if (compact) {
    pill.classList.add("status-pill--compact");
  }
  pill.classList.add(meta.pillClass);
  pill.textContent = meta.label;
  return pill;
}

function setAdminEventSubmitting(submitting) {
  state.admin.isSubmittingEvent = Boolean(submitting);
  if (dom.adminEventSubmit) {
    dom.adminEventSubmit.disabled = submitting;
  }
}

async function handleAdminEventSubmit(event) {
  event.preventDefault();
  if (state.admin.isSubmittingEvent) return;
  const form = event.target;
  const nameInput = form.elements.eventName;
  const dateInput = form.elements.eventDate;
  const lotSelect = dom.adminEventLots;
  const impactSelect = dom.adminEventImpact;
  const messageInput = dom.adminEventMessage;
  const name = nameInput?.value?.trim();
  const dateValue = dateInput?.value;
  const impactStatus = impactSelect?.value || "FULL";
  const lotIds = Array.from(lotSelect?.selectedOptions || []).map((option) => Number(option.value));
  const message = messageInput?.value?.trim() ?? "";

  if (!state.currentUser?.is_admin) {
    setAdminEventFeedback("Admin privileges are required to send notifications.", {
      isError: true,
      persist: true,
    });
    return;
  }

  if (!name) {
    setAdminEventFeedback("Enter an event name to continue.", { isError: true, persist: true });
    nameInput?.focus();
    return;
  }

  if (!dateValue) {
    setAdminEventFeedback("Choose a date for the event.", { isError: true, persist: true });
    dateInput?.focus();
    return;
  }
  const parsedDate = new Date(dateValue);
  if (Number.isNaN(parsedDate.getTime())) {
    setAdminEventFeedback("Choose a valid date for the event.", { isError: true, persist: true });
    dateInput?.focus();
    return;
  }

  if (!lotIds.length) {
    setAdminEventFeedback("Select at least one affected lot.", { isError: true, persist: true });
    lotSelect?.focus();
    return;
  }

  setAdminEventSubmitting(true);
  setAdminEventFeedback("Sending notification…");
  try {
    await sendAdminEventNotification({
      username: state.currentUser?.username,
      eventName: name,
      eventDate: dateValue,
      status: impactStatus,
      lotIds,
      note: message,
    });
    form.reset();
    if (lotSelect) {
      Array.from(lotSelect.options).forEach((option) => {
        option.selected = false;
      });
    }
    setAdminEventFeedback(
      `Sent event update for ${lotIds.length} lot${lotIds.length === 1 ? "" : "s"}.`,
      { isError: false }
    );
    loadNotifications({ silent: false });
  } catch (error) {
    console.error(error);
    setAdminEventFeedback(error?.message || "Couldn't send event notification.", {
      isError: true,
      persist: true,
    });
  } finally {
    setAdminEventSubmitting(false);
  }
}

function setAdminEventFeedback(message, options = {}) {
  if (!dom.adminEventFeedback) return;
  const { isError = false, persist = false } = options;
  if (state.admin.feedbackTimeout) {
    clearTimeout(state.admin.feedbackTimeout);
    state.admin.feedbackTimeout = null;
  }

  if (!message) {
    dom.adminEventFeedback.textContent = "";
    dom.adminEventFeedback.classList.add("is-hidden");
    dom.adminEventFeedback.classList.remove("admin-card__hint--error");
    return;
  }

  dom.adminEventFeedback.textContent = message;
  dom.adminEventFeedback.classList.remove("is-hidden");
  dom.adminEventFeedback.classList.toggle("admin-card__hint--error", Boolean(isError));

  if (!persist) {
    state.admin.feedbackTimeout = setTimeout(() => {
      setAdminEventFeedback("");
    }, 4000);
  }
}

function getWalkMinutesForLot(lot) {
  const userMinutes = Number(lot?.walk_minutes_from_user);
  if (Number.isFinite(userMinutes)) {
    return userMinutes;
  }
  const fallback = Number(lot?.walk_time);
  return Number.isFinite(fallback) ? fallback : null;
}

function formatWalkMeta(lot) {
  const minutes = getWalkMinutesForLot(lot);
  if (!Number.isFinite(minutes)) {
    return "Walk time —";
  }
  if (Number.isFinite(Number(lot?.walk_minutes_from_user))) {
    return `~${minutes} min walk from you`;
  }
  return `${minutes} min walk (avg)`;
}

function describeEstimateSources(lot) {
  const sources = [];
  const reportWeight = Number(lot.estimate?.report_weight);
  if (reportWeight > 0) {
    sources.push("recent reports");
  }
  sources.push("historical trends");
  return sources.join(" + ");
}

function formatEstimateLabel(lot) {
  const sourceText = describeEstimateSources(lot);
  const recency = formatRelativeAge(lot.last_updated) || formatDateTime(lot.last_updated);
  const prefix = sourceText ? `Estimate (${sourceText})` : "Estimate";
  return recency ? `${prefix} · ${recency}` : prefix;
}

function populateLotCard(node, lot) {
  const meta = STATUS_META[lot.status] || STATUS_META.OPEN;
  const occupancy = Number(lot.occupancy ?? 0);
  const capacity = Number(lot.capacity ?? 0);
  const occupancyPct = capacity ? Math.round((occupancy / capacity) * 100) : 0;

  node.dataset.lotId = lot.id;
  node.querySelector(".lot-card__title").textContent = lot.name;
  node.querySelector(".lot-card__code").textContent = `Code: ${lot.code}`;
  const pill = node.querySelector(".status-pill");
  pill.textContent = meta.label;
  pill.classList.add(meta.pillClass);
  const estimateBadge = node.querySelector("[data-estimate-badge]");
  if (estimateBadge) {
    estimateBadge.textContent = "Estimate";
    const tooltip = describeEstimateSources(lot);
    estimateBadge.title = tooltip ? `Based on ${tooltip}` : "Estimated availability";
  }

  node.querySelector(".lot-card__metric-count").textContent = `${occupancy}/${capacity}`;
  node.querySelector(".lot-card__metric-percent").textContent = `${occupancyPct}%`;
  const progress = node.querySelector(".lot-card__progress-fill");
  progress.style.width = `${Math.min(100, Math.max(0, occupancyPct))}%`;
  progress.classList.add(meta.pillClass);

  node.querySelector(".lot-card__meta-walk").textContent = formatWalkMeta(lot);
  node.querySelector(".lot-card__meta-full").textContent = `Full by ${lot.full_by ?? "—"}`;
  node.querySelector(".lot-card__updated").textContent = formatEstimateLabel(lot);

  const latestReport = node.querySelector(".lot-card__report");
  if (latestReport) {
    latestReport.innerHTML = "";
    if (lot.lastReport) {
      const prefix = lot.lastReport.is_admin ? "Admin update" : "Latest update";
      const parts = [];
      parts.push(prefix);
      if (lot.lastReport.user) {
        parts.push(`by ${lot.lastReport.user}`);
      }
      const timestamp = formatDateTime(lot.lastReport.created_at);
      if (timestamp) {
        parts.push(`· ${timestamp}`);
      }
      const label = document.createElement("span");
      label.className = "lot-card__report-label";
      label.textContent = parts.join(" ");
      latestReport.appendChild(label);
      const note = (lot.lastReport.note || "").trim();
      if (note) {
        const noteEl = document.createElement("span");
        noteEl.className = "lot-card__report-note";
        noteEl.textContent = note;
        latestReport.appendChild(noteEl);
      }
      latestReport.classList.remove("is-hidden");
      latestReport.classList.toggle("lot-card__report--admin", Boolean(lot.lastReport.is_admin));
    } else {
      latestReport.classList.add("is-hidden");
      latestReport.classList.remove("lot-card__report--admin");
    }
  }

  node.querySelector('[data-action="details"]').addEventListener("click", () => {
    openDetailsModal(lot.id);
  });
  node.querySelector('[data-action="report"]').addEventListener("click", () => {
    openReportModal(lot.id);
  });
}

function renderCounts() {
  const totals = { ALL: state.lots.length, OPEN: 0, LIMITED: 0, FULL: 0 };
  state.lots.forEach((lot) => {
    totals[lot.status] = (totals[lot.status] || 0) + 1;
  });

  dom.countAll.textContent = totals.ALL ?? 0;
  dom.countOpen.textContent = totals.OPEN ?? 0;
  dom.countLimited.textContent = totals.LIMITED ?? 0;
  dom.countFull.textContent = totals.FULL ?? 0;
}

function mergeUpdatedLot(updatedLot) {
  if (!updatedLot || typeof updatedLot.id === "undefined") return;
  const index = state.lots.findIndex((lot) => lot.id === updatedLot.id);
  if (index >= 0) {
    state.lots.splice(index, 1, updatedLot);
  } else {
    state.lots.push(updatedLot);
  }
}

function renderLeaderboard() {
  if (!dom.leaderboardBody || !dom.leaderboardEmpty) return;
  dom.leaderboardBody.innerHTML = "";
  if (!state.leaderboard.length) {
    dom.leaderboardEmpty.classList.remove("is-hidden");
    return;
  }

  dom.leaderboardEmpty.classList.add("is-hidden");
  state.leaderboard.forEach((user, index) => {
    const row = document.createElement("tr");
    row.className = "leaderboard__row";
    if (state.currentUser && user.username === state.currentUser.username) {
      row.classList.add("is-active");
    }

    const rankCell = document.createElement("td");
    rankCell.className = "leaderboard__cell leaderboard__cell--rank";
    rankCell.appendChild(createRankBadge(index + 1));

    const userCell = document.createElement("td");
    userCell.className = "leaderboard__cell leaderboard__cell--user";
    userCell.textContent = user.username;

    const pointsCell = document.createElement("td");
    pointsCell.className = "leaderboard__cell leaderboard__cell--right";
    pointsCell.textContent = user.points;

    row.append(rankCell, userCell, pointsCell);
    dom.leaderboardBody.appendChild(row);
  });
}

function renderNotifications() {
  if (!dom.notificationsList || !dom.notificationsEmpty) return;
  dom.notificationsList.innerHTML = "";
  const isLoggedIn = Boolean(state.currentUser?.username);
  const loading = state.notificationsLoading;

  if (dom.notificationsRefresh) {
    dom.notificationsRefresh.disabled = !isLoggedIn || loading;
  }

  if (!isLoggedIn) {
    dom.notificationsLoading?.classList.add("is-hidden");
    dom.notificationsEmpty.textContent = "No notifications yet.";
    dom.notificationsEmpty.classList.remove("is-hidden");
    return;
  }

  if (loading) {
    dom.notificationsLoading?.classList.remove("is-hidden");
  } else {
    dom.notificationsLoading?.classList.add("is-hidden");
  }

  if (!state.notifications.length) {
    dom.notificationsEmpty.textContent = "You're all caught up.";
    dom.notificationsEmpty.classList.remove("is-hidden");
    return;
  }

  dom.notificationsEmpty.classList.add("is-hidden");

  state.notifications.forEach((notification) => {
    const item = document.createElement("li");
    item.className = "notification-card";

    const header = document.createElement("div");
    header.className = "notification-card__header";
    const title = document.createElement("p");
    title.className = "notification-card__title";
    title.textContent = notification.lot?.name ?? "Parking lot update";
    header.appendChild(title);
    header.appendChild(createStatusPill(notification.status, { compact: true }));
    item.appendChild(header);

    const message = document.createElement("p");
    message.className = "notification-card__meta";
    message.textContent = formatNotificationMessage(notification);
    item.appendChild(message);

    if (notification.note) {
      const note = document.createElement("p");
      note.className = "notification-card__note";
      note.textContent = notification.note;
      item.appendChild(note);
    }

    const timestamp = document.createElement("p");
    timestamp.className = "notification-card__time";
    timestamp.textContent =
      formatRelativeAge(notification.created_at) || formatDateTime(notification.created_at);
    item.appendChild(timestamp);

    dom.notificationsList.appendChild(item);
  });
}

function getEcoSnapshot(overridePoints) {
  const user = state.currentUser;
  const inputs = state.ecoInputs || {};
  const oneWayMiles = Math.max(0, Number(inputs.oneWayMiles) || 0);
  const roundTripMiles = oneWayMiles * 2;
  const shuttle = Math.max(0, Number(inputs.shuttle) || 0);
  const walk = Math.max(0, Number(inputs.walk) || 0);
  const bike = Math.max(0, Number(inputs.bike) || 0);
  const carpool = Math.max(0, Number(inputs.carpool) || 0);
  const carpoolRiders = Math.max(1, Number(inputs.carpoolRiders) || 1);
  const idleMinutes = Math.max(0, Number(inputs.idleMinutes) || 0);

  const totalLowImpactTrips = shuttle + walk + bike + carpool;
  const carpoolShare = Math.max(0, carpoolRiders - 1) / carpoolRiders;
  const avoidedMilesSolo = (shuttle + walk + bike) * roundTripMiles;
  const avoidedMilesCarpool = carpool * roundTripMiles * carpoolShare;
  const avoidedMiles = Math.round((avoidedMilesSolo + avoidedMilesCarpool) * 10) / 10;
  const carbonAvoided = Math.round(avoidedMiles * CO2_PER_MILE_KG * 10) / 10;
  const idleCarbon = Math.round(idleMinutes * 0.012 * 10) / 10;
  const trees = Math.max(1, Math.round((carbonAvoided + idleCarbon) / 21));

  const calculatedEcoPoints = Math.max(
    0,
    Math.round(
      shuttle * 5 +
        walk * 6 +
        bike * 7 +
        carpool * (4 + carpoolShare * 4) +
        idleMinutes * 0.25
    )
  );
  const ecoPoints = Number.isFinite(Number(overridePoints))
    ? Number(overridePoints)
    : calculatedEcoPoints;

  const currentBadge =
    [...ECO_BADGE_STEPS].reverse().find((badge) => ecoPoints >= badge.threshold) ||
    ECO_BADGE_STEPS[0];
  const nextBadge = ECO_BADGE_STEPS.find((badge) => badge.threshold > ecoPoints) || null;
  const progressTarget = nextBadge ? nextBadge.threshold - currentBadge.threshold : ecoPoints || 1;
  const progressValue = nextBadge ? ecoPoints - currentBadge.threshold : progressTarget;
  const progress = clampValue(Math.round((progressValue / progressTarget) * 100), 0, 100);
  const modeMix = buildModeMix({ shuttle, walk, bike, carpool, carpoolRiders, roundTripMiles });
  const actions = buildEcoActions({ shuttle, walk, bike, carpool, idleMinutes }, Boolean(user));
  const intro = `Based on your self-reported week. Update the inputs to refresh impact.`;

  return {
    ecoPoints,
    lowImpactTrips: totalLowImpactTrips,
    avoidedMiles,
    carbonAvoided: carbonAvoided + idleCarbon,
    trees,
    progress,
    currentBadge,
    nextBadge,
    modeMix,
    actions,
    hasUser: Boolean(user),
    intro,
  };
}

function buildModeMix(inputs) {
  const totalTrips = inputs.shuttle + inputs.walk + inputs.bike + inputs.carpool;
  const baselineSolo = Math.max(6, Math.round(14 - totalTrips));
  const denominator = Math.max(1, totalTrips + baselineSolo);

  const share = (value) => clampValue(Math.round((value / denominator) * 100), 0, 100);
  const carpoolPercent = share(inputs.carpool);
  const shuttlePercent = share(inputs.shuttle);
  const activePercent = share(inputs.walk + inputs.bike);
  const soloPercent = 100 - carpoolPercent - shuttlePercent - activePercent;

  const delta = (count) => clampValue(Math.round((count - 2) * 8), -12, 24);

  return [
    { label: "Carpool / rideshare", icon: "🤝", percent: carpoolPercent, delta: delta(inputs.carpool) },
    { label: "Shuttle or NJ Transit", icon: "🚌", percent: shuttlePercent, delta: delta(inputs.shuttle) },
    { label: "Bike or walk", icon: "🚴", percent: activePercent, delta: delta(inputs.walk + inputs.bike) },
    { label: "Solo drive", icon: "🚗", percent: clampValue(soloPercent, 0, 100), delta: -delta(inputs.walk + inputs.bike) },
  ];
}

function buildEcoActions(inputs, hasUser) {
  const streakProgress = clampValue(Math.round(((inputs.walk + inputs.bike) / 4) * 100), 4, 100);
  const carpoolProgress = clampValue(Math.round((inputs.carpool / 3) * 100), 4, 100);
  const idleProgress = clampValue(Math.round((inputs.idleMinutes / 60) * 100), 6, 100);

  return [
    {
      title: "Lock in two car-free days",
      detail: "Combine shuttle with a walk or bike day to avoid solo drives.",
      progress: streakProgress,
      status: hasUser ? "Active" : "Sample goal",
    },
    {
      title: "Ride-share rotation",
      detail: "Swap driving duties so every seat is filled at least once a week.",
      progress: carpoolProgress,
      status: inputs.carpool >= 2 ? "On track" : "New",
    },
    {
      title: "Zero-idle zone",
      detail: "Cut engine while waiting curbside—aim for under 10 idle minutes total.",
      progress: idleProgress,
      status: inputs.idleMinutes <= 10 ? "Quick win" : "Keep trimming",
    },
  ];
}

function renderEcoSection() {
  if (!dom.ecoScore) return;
  const userPoints = state.currentUser?.points;
  const snapshot = getEcoSnapshot(userPoints);
  if (dom.ecoScore) {
    dom.ecoScore.textContent = snapshot.ecoPoints;
  }
  if (dom.ecoHint) {
    dom.ecoHint.textContent = snapshot.hasUser
      ? `Eco points follow your account. Next badge: ${snapshot.nextBadge?.name ?? snapshot.currentBadge.name}`
      : "Use guest mode or create an account to personalize these numbers.";
  }
  if (dom.ecoNext) {
    dom.ecoNext.textContent = snapshot.nextBadge
      ? `Next: ${snapshot.nextBadge.name} at ${snapshot.nextBadge.threshold} pts`
      : `${snapshot.currentBadge.name} unlocked`;
  }
  if (dom.ecoProgress) {
    dom.ecoProgress.style.width = `${snapshot.progress}%`;
    dom.ecoProgress.setAttribute("aria-valuenow", snapshot.progress);
  }
  if (dom.ecoCarbon) {
    dom.ecoCarbon.textContent = `${snapshot.carbonAvoided} kg`;
  }
  if (dom.ecoDistance) {
    dom.ecoDistance.textContent = `${snapshot.avoidedMiles} mi`;
  }
  if (dom.ecoTrips) {
    dom.ecoTrips.textContent = `${snapshot.lowImpactTrips} / wk`;
  }
  if (dom.ecoWeek) {
    dom.ecoWeek.textContent = `${snapshot.lowImpactTrips} low-impact trips`;
  }
  if (dom.ecoMetricCarbon) {
    dom.ecoMetricCarbon.textContent = `${snapshot.carbonAvoided} kg`;
  }
  if (dom.ecoMetricDistance) {
    dom.ecoMetricDistance.textContent = `${snapshot.avoidedMiles} mi`;
  }
  if (dom.ecoMetricTrees) {
    dom.ecoMetricTrees.textContent = `${snapshot.trees}`;
  }
  if (dom.ecoGoal) {
    dom.ecoGoal.textContent = `${ECO_GOAL_PERCENT}%`;
  }
  if (dom.ecoIntro) {
    dom.ecoIntro.textContent = snapshot.intro;
  }
  renderEcoModes(snapshot.modeMix);
  renderEcoActions(snapshot.actions);
}

function renderEcoModes(modes) {
  if (!dom.ecoModeList) return;
  dom.ecoModeList.innerHTML = "";
  modes.forEach((mode) => {
    const item = document.createElement("li");
    item.className = "eco-mode";

    const icon = document.createElement("span");
    icon.className = "eco-mode__icon";
    icon.textContent = mode.icon;
    item.appendChild(icon);

    const content = document.createElement("div");
    content.className = "eco-mode__content";

    const top = document.createElement("div");
    top.className = "eco-mode__top";
    const label = document.createElement("p");
    label.className = "eco-mode__label";
    label.textContent = mode.label;
    const percent = document.createElement("span");
    percent.className = "eco-mode__percent";
    percent.textContent = `${clampValue(mode.percent, 0, 100)}%`;
    top.append(label, percent);

    const bar = document.createElement("div");
    bar.className = "eco-mode__bar";
    const fill = document.createElement("div");
    fill.className = "eco-mode__fill";
    fill.style.width = `${clampValue(mode.percent, 0, 100)}%`;
    bar.appendChild(fill);

    const delta = document.createElement("span");
    delta.className = "eco-mode__delta";
    delta.textContent = formatDelta(mode.delta);
    delta.classList.toggle("is-negative", mode.delta < 0);
    delta.classList.toggle("is-positive", mode.delta >= 0);

    content.append(top, bar, delta);
    item.appendChild(content);
    dom.ecoModeList.appendChild(item);
  });
}

function renderEcoActions(actions) {
  if (!dom.ecoActionList) return;
  dom.ecoActionList.innerHTML = "";
  actions.forEach((action) => {
    const item = document.createElement("li");
    item.className = "eco-action";

    const header = document.createElement("div");
    header.className = "eco-action__header";

    const title = document.createElement("p");
    title.className = "eco-action__title";
    title.textContent = action.title;

    const status = document.createElement("span");
    status.className = "eco-action__status";
    status.textContent = action.status;

    header.append(title, status);

    const detail = document.createElement("p");
    detail.className = "eco-action__detail";
    detail.textContent = action.detail;

    const progress = document.createElement("div");
    progress.className = "eco-action__progress";
    const fill = document.createElement("div");
    fill.className = "eco-action__progress-fill";
    fill.style.width = `${clampValue(action.progress, 0, 100)}%`;
    progress.appendChild(fill);

    item.append(header, detail, progress);
    dom.ecoActionList.appendChild(item);
  });
}

function setFilter(filter) {
  state.filter = filter;
  dom.filterButtons.forEach((button) => {
    const isActive = button.dataset.filter === filter;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  renderLots();
}

function setActivePage(page) {
  if (page === "admin" && !isAdminUser()) {
    page = "lots";
  }
  state.activePage = page;
  dom.navButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.nav === page);
  });

  dom.pageSections.forEach((section) => {
    const isActive = section.dataset.page === page;
    section.classList.toggle("is-hidden", !isActive);
  });

  const isLots = page === "lots";
  dom.toolbar.classList.toggle("is-hidden", !isLots);
  dom.refreshButton.classList.toggle("is-hidden", !isLots);

  if (isLots) {
    dom.pageTitle.textContent = "Campus Parking";
    dom.pageSubtitle.textContent =
      "Trend-based availability with optional walking estimates from your location";
  } else if (page === "admin") {
    dom.pageTitle.textContent = "Admin Dashboard";
    dom.pageSubtitle.textContent = "Oversee lots, reports, and campus events";
  } else if (page === "leaderboard") {
    dom.pageTitle.textContent = "Community Leaderboard";
    dom.pageSubtitle.textContent = "See who's leading the charge in keeping ParkKean updated";
  } else if (page === "report") {
    dom.pageTitle.textContent = "Report a Parking Status";
    dom.pageSubtitle.textContent = "Share live updates to help classmates find the best spots";
  } else if (page === "notifications") {
    dom.pageTitle.textContent = "Notifications";
    dom.pageSubtitle.textContent = "Recent community reports and lot updates";
  } else if (page === "eco") {
    dom.pageTitle.textContent = "Eco Commute";
    dom.pageSubtitle.textContent = "Measure carbon savings and unlock greener campus habits";
  } else {
    dom.pageTitle.textContent = "ParkKean";
    dom.pageSubtitle.textContent = "Your campus parking assistant";
  }
}

async function refreshLots() {
  const response = await fetch(getLotsEndpoint("/api/lots/refresh"), { method: "POST" });
  if (!response.ok) {
    console.error("Failed to refresh lots");
    return;
  }
  const payload = await response.json();
  state.lots = payload.lots;
  state.dataSource = payload.source || null;
  renderCounts();
  renderLots();
  renderReportForm();
  renderAdminDashboard();
}

async function openDetailsModal(lotId) {
  const lot = state.lots.find((item) => item.id === lotId);
  if (!lot) return;

  const response = await fetch(`/api/lots/${lotId}/reports`);
  const payload = response.ok ? await response.json() : { reports: [] };
  const reports = payload.reports ?? [];
  const adminUpdates = payload.admin_updates ?? [];
  if (reports.length) {
    lot.lastReport = reports[0];
  }

  const modal = createModal(`${lot.name} Details`);
  const body = modal.querySelector(".modal__body");

  const section = document.createElement("div");
  section.className = "modal-section";

  const highlight = document.createElement("div");
  highlight.className = "modal-highlight";

  highlight.appendChild(createHighlightBlock("Code", lot.code));
  highlight.appendChild(createHighlightBlock("Capacity", lot.capacity));
  highlight.appendChild(createHighlightBlock("Walk", formatWalkMeta(lot)));

  const statusPill = document.createElement("span");
  statusPill.className = "status-pill status-pill--compact";
  const meta = STATUS_META[lot.status] || STATUS_META.OPEN;
  statusPill.classList.add(meta.pillClass);
  statusPill.textContent = meta.label;
  highlight.appendChild(statusPill);

  section.appendChild(highlight);

  const updated = document.createElement("p");
  updated.className = "modal-updated";
  updated.textContent = formatEstimateLabel(lot);
  section.appendChild(updated);

  const listWrapper = document.createElement("div");
  listWrapper.className = "modal-list";

  const listTitle = document.createElement("h4");
  listTitle.className = "modal-list__title";
  listTitle.textContent = "Recent Reports";
  listWrapper.appendChild(listTitle);

  if (!reports.length) {
    const empty = document.createElement("p");
    empty.className = "empty-inline";
    empty.textContent = "No reports yet.";
    listWrapper.appendChild(empty);
  } else {
    const list = document.createElement("ul");
    list.className = "modal-list__items";

    reports.forEach((report) => {
      const item = document.createElement("li");
      item.className = "report-card";

      const header = document.createElement("div");
      header.className = "report-card__header";
      const user = document.createElement("span");
      user.className = "report-card__user";
      user.textContent = report.user;
      header.appendChild(user);

      const pill = document.createElement("span");
      pill.className = "status-pill status-pill--compact";
      const metaReport = STATUS_META[report.reported_status] || STATUS_META.OPEN;
      pill.classList.add(metaReport.pillClass);
      pill.textContent = metaReport.label;
      header.appendChild(pill);
      item.appendChild(header);

      if (report.note) {
        const note = document.createElement("p");
        note.className = "report-card__note";
        note.textContent = report.note;
        item.appendChild(note);
      }

      const timestamp = document.createElement("p");
      timestamp.className = "report-card__timestamp";
      timestamp.textContent = formatDateTime(report.created_at);
      item.appendChild(timestamp);

      list.appendChild(item);
    });

    listWrapper.appendChild(list);
  }

  section.appendChild(listWrapper);

  const adminWrapper = document.createElement("div");
  adminWrapper.className = "modal-list";
  const adminTitle = document.createElement("h4");
  adminTitle.className = "modal-list__title";
  adminTitle.textContent = "Admin Updates";
  adminWrapper.appendChild(adminTitle);

  if (!adminUpdates.length) {
    const empty = document.createElement("p");
    empty.className = "empty-inline";
    empty.textContent = "No admin notices yet.";
    adminWrapper.appendChild(empty);
  } else {
    const list = document.createElement("ul");
    list.className = "modal-list__items";

    adminUpdates.forEach((update) => {
      const item = document.createElement("li");
      item.className = "report-card report-card--admin";

      const header = document.createElement("div");
      header.className = "report-card__header";
      const user = document.createElement("span");
      user.className = "report-card__user";
      user.textContent = update.reporter || "Admin";
      header.appendChild(user);

      const pill = document.createElement("span");
      pill.className = "status-pill status-pill--compact";
      const metaUpdate = STATUS_META[update.status] || STATUS_META.OPEN;
      pill.classList.add(metaUpdate.pillClass);
      pill.textContent = metaUpdate.label;
      header.appendChild(pill);
      item.appendChild(header);

      if (update.note) {
        const note = document.createElement("p");
        note.className = "report-card__note";
        note.textContent = update.note;
        item.appendChild(note);
      }

      const timestamp = document.createElement("p");
      timestamp.className = "report-card__timestamp";
      timestamp.textContent = formatDateTime(update.created_at);
      item.appendChild(timestamp);

      list.appendChild(item);
    });

    adminWrapper.appendChild(list);
  }

  section.appendChild(adminWrapper);
  body.appendChild(section);
}

function createHighlightBlock(label, value) {
  const wrapper = document.createElement("div");
  const labelEl = document.createElement("p");
  labelEl.className = "modal-highlight__label";
  labelEl.textContent = label;
  const valueEl = document.createElement("p");
  valueEl.className = "modal-highlight__value";
  valueEl.textContent = value;
  wrapper.append(labelEl, valueEl);
  return wrapper;
}

async function openReportModal(lotId) {
  const lot = state.lots.find((item) => item.id === lotId);
  if (!lot) return;

  const modal = createModal(`Report Status — ${lot.name}`);
  const body = modal.querySelector(".modal__body");

  const form = document.createElement("form");
  form.className = "form";
  form.noValidate = true;

  const statusGroup = document.createElement("div");
  statusGroup.className = "form__group";
  const statusLabel = document.createElement("label");
  statusLabel.className = "form__label";
  statusLabel.textContent = "Status";
  statusGroup.appendChild(statusLabel);

  const statusSelector = document.createElement("div");
  statusSelector.className = "status-selector";
  statusGroup.appendChild(statusSelector);

  STATUS_ORDER.forEach((statusValue) => {
    const option = document.createElement("label");
    option.className = "status-selector__option";
    if (statusValue === lot.status) {
      option.classList.add("is-active");
    }

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "status";
    input.value = statusValue;
    input.checked = statusValue === lot.status;
    input.className = "status-selector__input";
    input.addEventListener("change", () => {
      statusSelector.querySelectorAll(".status-selector__option").forEach((el) => {
        el.classList.toggle("is-active", el.contains(input) && input.checked);
      });
    });

    option.appendChild(input);
    option.append(STATUS_META[statusValue].label);
    statusSelector.appendChild(option);
  });

  const noteGroup = document.createElement("div");
  noteGroup.className = "form__group";
  const noteLabel = document.createElement("label");
  noteLabel.htmlFor = "report-note";
  noteLabel.className = "form__label";
  noteLabel.textContent = "Optional note";
  noteGroup.appendChild(noteLabel);
  const textarea = document.createElement("textarea");
  textarea.id = "report-note";
  textarea.className = "input textarea";
  textarea.placeholder = "e.g., Upper deck closed for maintenance.";
  noteGroup.appendChild(textarea);

  const actions = document.createElement("div");
  actions.className = "form__actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn btn--ghost";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => closeModal(modal));
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "btn btn--primary";
  submit.textContent = "Submit (+5 pts)";
  actions.append(cancel, submit);

  form.append(statusGroup, noteGroup, actions);
  body.appendChild(form);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const statusInput = form.querySelector('input[name="status"]:checked');
    if (!statusInput) return;
    const payload = {
      lotId,
      status: statusInput.value,
      note: textarea.value,
      username: state.currentUser?.username,
    };
    submit.disabled = true;
    try {
      const result = await postReport(payload);
      setCurrentUser(result.user);
      updateStats();
      await Promise.all([loadLots(), loadLeaderboard()]);
      closeModal(modal);
    } catch (error) {
      console.error(error);
      submit.disabled = false;
    }
  });
}

function createModal(title) {
  const template = document.getElementById("modal-template");
  const fragment = template.content.firstElementChild.cloneNode(true);
  const modal = fragment.querySelector(".modal");
  modal.querySelector(".modal__title").textContent = title;
  fragment.addEventListener("click", (event) => {
    if (event.target.matches("[data-close]")) {
      closeModal(fragment);
    }
  });
  document.body.appendChild(fragment);
  return fragment;
}

function closeModal(modal) {
  modal?.remove();
}

async function postReport(payload) {
  const response = await fetch("/api/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error("Failed to submit report");
  }
  return response.json();
}

function createRankBadge(rank) {
  const span = document.createElement("span");
  span.className = "rank-badge";
  if (rank === 1) {
    span.classList.add("rank-badge--gold");
    span.textContent = "🥇 1";
  } else if (rank === 2) {
    span.classList.add("rank-badge--silver");
    span.textContent = "🥈 2";
  } else if (rank === 3) {
    span.classList.add("rank-badge--bronze");
    span.textContent = "🥉 3";
  } else {
    span.classList.add("rank-badge--default");
    span.textContent = rank;
  }
  return span;
}

function formatDelta(value) {
  if (!Number.isFinite(value)) return "0%";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value}% vs last week`;
}

function formatRelativeAge(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return "";
  const delta = Date.now() - value;
  if (delta < 0) return "just now";
  const minutes = Math.floor(delta / 60000);
  if (minutes <= 0) return "just now";
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function formatDateTime(timestamp) {
  const date = new Date(Number(timestamp));
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatNotificationMessage(notification) {
  if (!notification) return "";
  const reporter = notification.reporter || "A classmate";
  const lotName = notification.lot?.name || "a parking lot";
  const lotCode = notification.lot?.code ? ` (${notification.lot.code})` : "";
  const meta = STATUS_META[notification.status] || STATUS_META.OPEN;
  return `${reporter} marked ${lotName}${lotCode} as ${meta.label}.`;
}

function initialsFor(name) {
  if (!name) return "P";
  const parts = name.split(/[\s_\-]+/).filter(Boolean);
  const first = parts[0]?.[0]?.toUpperCase() ?? "";
  const second = parts[1]?.[0]?.toUpperCase() ?? "";
  return (first + second || first || "P").slice(0, 2);
}
