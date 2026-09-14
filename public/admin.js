const statusLabels = {
  new: "รับเรื่องใหม่",
  received: "รับเรื่องแล้ว",
  assigned: "มอบหมายแล้ว",
  in_progress: "กำลังดำเนินการ",
  waiting_for_info: "รอข้อมูลเพิ่มเติม",
  completed: "เสร็จสิ้น",
  rejected: "ไม่รับดำเนินการ",
  cancelled: "ยกเลิก",
};
const statusColors = {
  new: "#e7a61b",
  received: "#3f79db",
  assigned: "#568ce8",
  in_progress: "#8d59d7",
  waiting_for_info: "#b170d7",
  completed: "#19a676",
  rejected: "#db5555",
  cancelled: "#8a9692",
};
const selectableStatusValues = [
  "new",
  "received",
  "assigned",
  "in_progress",
  "completed",
];
const priorityLabels = {
  low: "ต่ำ",
  normal: "ปกติ",
  high: "สูง",
  urgent: "เร่งด่วน",
};
const $ = (s) => document.querySelector(s);
let token = sessionStorage.getItem("adminToken");
let currentPage = 1;
let departments = [];
let staff = [];
let dashboardCache = null;
let currentUser = null;
let executiveDepartmentId = "";
let staffProfileDepartmentId = "";
let governanceMode = "categories";
let governanceEditing = null;
let complaintPendingDelete = null;
let smartGeoMap = null;
let smartGeoMarkers = null;
let smartGeoMarkerById = new Map();
let smartGeoResizeTimer = null;
let selectedMapMonth = "all";
let mobileMapPage = 1;
const mobileMapPageSize = 4;
const reportInsightPages = { topCategory: 1, category: 1, department: 1 };
const mapCitizenPhotoUrls = new Map();
function show(id, msg, type = "error") {
  const e = $(id);
  e.textContent = msg;
  e.className = `alert ${type}`;
  e.classList.remove("hidden");
}
function clear(id) {
  const e = $(id);
  e.className = "alert hidden";
  e.textContent = "";
}
async function api(path, opt = {}) {
  const h = new Headers(opt.headers || {});
  if (!(opt.body instanceof FormData))
    h.set("content-type", "application/json");
  if (token) h.set("authorization", `Bearer ${token}`);
  const r = await fetch(path, { ...opt, headers: h });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path != "/api/admin/login") logout();
  if (!r.ok) throw new Error(j.message || `เกิดข้อผิดพลาด ${r.status}`);
  return j;
}
// วันครบกำหนดแสดงแค่วัน เดือน ปี ไม่ต้องมีเวลา
function fmtDateOnly(v) {
  if (!v) return "-";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" }).format(
    new Date(v),
  );
}
function fmt(v) {
  if (!v) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(v));
}
function badge(s) {
  return `<span class="v3-badge status-${s}">${statusLabels[s] || s}</span>`;
}
function priorityBadge(priority = "normal") {
  const value = priorityLabels[priority] ? priority : "normal";
  return `<span class="v3-priority priority-${value}">${priorityLabels[value]}</span>`;
}
function openStreetMapUrl(lat, lng) {
  const latitude = Number(lat).toFixed(6);
  const longitude = Number(lng).toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(latitude)}&mlon=${encodeURIComponent(longitude)}#map=18/${encodeURIComponent(latitude)}/${encodeURIComponent(longitude)}`;
}
function openAdminImageViewer(src, caption = "รูปภาพประกอบ") {
  const dialog = $("#adminImageViewer");
  const image = $("#adminImageViewerImage");
  image.src = src;
  image.alt = caption;
  $("#adminImageViewerCaption").textContent = caption;
  if (!dialog.open) dialog.showModal();
}
function closeDetailDrawer() {
  $("#detailDrawer").classList.add("hidden");
  $("#detailDrawerBackdrop").classList.add("hidden");
}
function clearPrintMode() {
  document.body.classList.remove(
    "printing-complaint-list",
    "printing-complaint-detail",
  );
}
function printComplaintList() {
  clearPrintMode();
  const status = $("#statusFilter");
  const month = $("#complaintMonthFilter");
  const category = $("#complaintCategoryFilter");
  const parts = [
    status.options[status.selectedIndex]?.text,
    month.options[month.selectedIndex]?.text,
    category.options[category.selectedIndex]?.text,
    `พิมพ์เมื่อ ${new Date().toLocaleString("th-TH")}`,
  ].filter(Boolean);
  $("#complaintPrintMeta").textContent = parts.join(" • ");
  document.body.classList.add("printing-complaint-list");
  window.print();
}
function printComplaintDetail() {
  clearPrintMode();
  document.body.classList.add("printing-complaint-detail");
  window.print();
}
function isDialogBackdropClick(event, dialog) {
  if (event.target !== dialog) return false;
  const rect = dialog.getBoundingClientRect();
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom ||
    event.target === dialog
  );
}
function loginView() {
  $("#loginPanel").classList.remove("hidden");
  $("#appShell").classList.add("hidden");
}
function isExecutive() {
  return ["executive", "exclusive"].includes(currentUser?.role);
}
function isSystemAdmin() {
  return ["admin", "dev"].includes(currentUser?.role);
}
function addExecutiveDepartmentScope(params) {
  if (isExecutive() && executiveDepartmentId)
    params.set("departmentId", executiveDepartmentId);
  return params;
}
function scopedDashboardPath() {
  const params = addExecutiveDepartmentScope(new URLSearchParams());
  return `/api/admin/dashboard${params.size ? `?${params}` : ""}`;
}
function roleLabel(role) {
  return (
    {
      admin: "ผู้ดูแลระบบ",
      dev: "ผู้พัฒนาระบบ",
      supervisor: "หัวหน้าหน่วยงาน",
      officer: "เจ้าหน้าที่",
      executive: "ผู้บริหาร",
      exclusive: "ผู้บริหาร",
    }[role] || role
  );
}
function appView(user) {
  currentUser = user;
  const isOfficer = user.role === "officer";
  const showUserInsights = isSystemAdmin();
  $("#loginPanel").classList.add("hidden");
  $("#appShell").classList.remove("hidden");
  $("#staffName").textContent = user.displayName || user.username;
  $("#staffRole").textContent = roleLabel(user.role);
  $("#todayLabel").textContent = new Intl.DateTimeFormat("th-TH", {
    dateStyle: "full",
  }).format(new Date());
  $("#topCategoriesCard").classList.toggle("hidden", isOfficer);
  $("#departmentWorkloadCard").classList.toggle("hidden", isOfficer);
  $("#userStatusCard").classList.toggle("hidden", !showUserInsights);
  $("#topUserDepartmentsCard").classList.toggle("hidden", !showUserInsights);
}
function logout() {
  token = null;
  executiveDepartmentId = "";
  sessionStorage.removeItem("adminToken");
  loginView();
}
function openLogoutConfirmation() {
  const dialog = $("#logoutConfirmDialog");
  if (!dialog.open) dialog.showModal();
}
function closeLogoutConfirmation() {
  const dialog = $("#logoutConfirmDialog");
  if (dialog.open) dialog.close("cancel");
}
function confirmLogout() {
  closeLogoutConfirmation();
  logout();
}
async function loadMe() {
  if (!token) return loginView();
  try {
    const r = await api("/api/admin/me");
    appView(r.data);
    await boot();
  } catch {
    logout();
  }
}
function switchView(name) {
  clear("#pageAlert");
  document.body.classList.toggle("map-view-active", name === "map");
  document
    .querySelectorAll(".admin-view")
    .forEach((v) => v.classList.add("hidden"));
  document
    .querySelectorAll(".v3-nav-item")
    .forEach((v) => v.classList.toggle("active", v.dataset.view === name));
  $(`#${name}View`).classList.remove("hidden");
  const meta = {
    dashboard: [
      "Command Center",
      "ภาพรวมสถานการณ์และประสิทธิภาพการให้บริการประชาชน",
    ],
    complaints: [
      "ศูนย์จัดการเรื่องร้องเรียน",
      "ค้นหา ตรวจสอบ มอบหมาย และติดตามทุกเคสในที่เดียว",
    ],
    map: ["Smart Map", "วิเคราะห์จุดเกิดเหตุและเปิดพิกัดจากฐานข้อมูลจริง"],
    reports: [
      "Analytics & Reports",
      "ข้อมูลเชิงลึกสำหรับผู้บริหารและการตัดสินใจ",
    ],
    settings: [
      "System Governance",
      "การกำกับดูแลผู้ใช้ หน่วยงาน Workflow และความปลอดภัย",
    ],
  };
  $("#pageTitle").textContent = meta[name][0];
  $("#pageSubtitle").textContent = meta[name][1];
  if (name === "complaints") loadComplaints();
  if (name === "map") renderMapCases();
  if (name === "reports") renderReports();
  if (name === "settings") loadGovernance(governanceMode);
}
function setupExecutiveDepartmentScope() {
  const wrapper = $("#executiveDepartmentScope");
  const select = $("#executiveDepartmentFilter");
  wrapper?.classList.toggle("hidden", !isExecutive());
  if (!select) return;
  select.innerHTML = `<option value="">ทุกกอง</option>${departments.map((d) => `<option value="${d.id}">${escapeHtml(d.name_th)}</option>`).join("")}`;
  select.value = executiveDepartmentId;
}
function setupStaffProfileDepartmentFilter() {
  const select = $("#staffProfileDepartmentFilter");
  if (!select) return;
  select.innerHTML =
    '<option value="">ทุกหน่วยงาน</option>' +
    departments
      .filter((department) => department.is_active !== false)
      .map(
        (department) =>
          `<option value="${department.id}">${escapeHtml(department.name_th)}</option>`,
      )
      .join("");
  select.value = staffProfileDepartmentId;
}
async function refreshScopedData() {
  clear("#pageAlert");
  const result = await api(scopedDashboardPath());
  dashboardCache = result.data;
  selectedMapMonth = "all";
  mobileMapPage = 1;
  renderDashboard();
  const active =
    document.querySelector(".v3-nav-item.active")?.dataset.view || "dashboard";
  if (active === "complaints") await loadComplaints(1);
  if (active === "map") renderMapCases();
  if (active === "reports") renderReports();
}
async function boot() {
  clear("#pageAlert");
  try {
    const [d, dep] = await Promise.all([
      api(scopedDashboardPath()),
      api("/api/admin/departments"),
    ]);
    dashboardCache = d.data;
    departments = dep.data;
    staff = [];
    applyRoleVisibility();
    setupExecutiveDepartmentScope();
    setupStaffProfileDepartmentFilter();
    renderDashboard();
    switchView("dashboard");
  } catch (e) {
    show("#pageAlert", e.message);
    throw e;
  }
}
function applyRoleVisibility() {
  const isElevated =
    isSystemAdmin() || currentUser?.role === "supervisor" || isExecutive();
  const isAdmin = isSystemAdmin();
  const isDev = currentUser?.role === "dev";
  if (
    (!isAdmin && governanceMode === "users") ||
    (!isDev && governanceMode === "staffProfiles")
  )
    governanceMode = "categories";

  // Officer ไม่มีหน้าตั้งค่าระบบ
  document
    .querySelector('[data-view="settings"]')
    ?.classList.toggle("hidden", !isElevated);

  const exportBtn = $("#exportCsvButton");
  if (exportBtn) exportBtn.classList.toggle("hidden", !isElevated);

  // เฉพาะ Admin เท่านั้นที่เห็นแท็บผู้ใช้งานและ ACCESS CONTROL
  document
    .querySelector('.governance-tab[data-governance="users"]')
    ?.classList.toggle("hidden", !isAdmin);
  document
    .querySelector('.governance-tab[data-governance="staffProfiles"]')
    ?.classList.toggle("hidden", !isDev);

  // เฉพาะ Admin เพิ่ม/แก้ไขหมวดหมู่ หน่วยงาน และผู้ใช้งาน
  $("#addCategoryButton")?.classList.toggle("hidden", !isAdmin);
  $("#addDepartmentButton")?.classList.toggle("hidden", !isAdmin);
  $("#addUserButton")?.classList.toggle("hidden", !isAdmin);
  $("#addStaffProfileButton")?.classList.toggle("hidden", !isDev);
  document
    .querySelectorAll("[data-admin-only]")
    .forEach((el) => el.classList.toggle("hidden", !isAdmin));
}
function renderDashboard() {
  renderKpis();
  renderTrend("#trendChart", dashboardCache.monthlyTrend);
  renderDonut();
  renderUserUsage();
  renderUrgent();
  if (currentUser?.role !== "officer") {
    renderPagedInsight(
      "#categoryBars",
      "#topCategoryPagination",
      dashboardCache.categoryBreakdown || [],
      "topCategory",
      { pageSize: 5, showPercentage: false },
    );
    renderBars("#departmentBars", dashboardCache.departmentBreakdown);
  }
  $("#recentTable").innerHTML = tableHtml(dashboardCache.recent, true);
}
function renderKpis() {
  const s = dashboardCache.summary;
  const items = [
    ["▤", "เรื่องทั้งหมด", s.total, "ข้อมูลสะสม", "#0b695b", "#e4f3ef"],
    [
      "◷",
      "รับเรื่องเดือนนี้",
      s.this_month,
      "เดือนปัจจุบัน",
      "#3c7ce8",
      "#e8efff",
    ],
    [
      "⚙",
      "กำลังดำเนินการ",
      s.in_progress,
      "อยู่ระหว่างทำงาน",
      "#8e59d8",
      "#f0e8fb",
    ],
    ["✓", "เสร็จสิ้น", s.completed, "ปิดงานแล้ว", "#18a575", "#e1f5ed"],
    ["!", "เกินกำหนด", s.overdue, "ต้องเร่งติดตาม", "#d84c4c", "#fde9e8"],
    [
      "◆",
      "ความสำคัญสูง",
      s.high_priority,
      "High / Urgent",
      "#ef9b2d",
      "#fff0dc",
    ],
  ];
  const usage = dashboardCache.backendUsage;
  if (isSystemAdmin() && usage) {
    items.push(
      [
        "♟",
        "ผู้ใช้งาน Backend",
        usage.active_users,
        `เปิดใช้งานจาก ${usage.total_users} บัญชี`,
        "#7b3fa0",
        "#f3eafb",
      ],
      [
        "⌂",
        "หน่วยงานเข้าใช้มากที่สุด",
        usage.department_name || "-",
        usage.department_name
          ? `${usage.active_user_count} คนใน ${usage.period_days} วัน`
          : "ยังไม่มีผู้เข้าใช้ในช่วง 30 วัน",
        "#9b5fc0",
        "#f5edfa",
        true,
      ],
    );
  }
  const grid = $("#kpiGrid");
  grid.classList.toggle("system-admin-kpis", isSystemAdmin() && Boolean(usage));
  grid.innerHTML = items
    .map(
      ([i, l, v, t, c, soft, textValue]) =>
        `<article class="v3-kpi" style="--kpi:${c};--kpi-soft:${soft}"><div class="v3-kpi-icon">${i}</div><span>${escapeHtml(l)}</span><strong class="${textValue ? "kpi-text-value" : ""}">${escapeHtml(v ?? 0)}</strong><small>${escapeHtml(t)}</small></article>`,
    )
    .join("");
}
// สถานะ SLA คำนวณจากวันครบกำหนดเทียบกับเวลาปัจจุบัน ไม่ได้เก็บในฐานข้อมูล
// จึงอัปเดตตัวเองตลอดโดยไม่ต้องมีงานตั้งเวลามาคอยเปลี่ยนค่า
const SLA_NEAR_DUE_DAYS = 2;
const closedStatuses = ["completed", "rejected", "cancelled"];

function slaState(row) {
  // เรื่องที่จบแล้วไม่ต้องวัด SLA ต่อ
  if (closedStatuses.includes(row.status)) return null;
  if (!row.due_at) return null;

  const due = new Date(row.due_at).getTime();
  if (Number.isNaN(due)) return null;

  const msLeft = due - Date.now();
  if (msLeft < 0) return "overdue";
  if (msLeft <= SLA_NEAR_DUE_DAYS * 24 * 60 * 60 * 1000) return "near_due";
  return "on_track";
}

const slaLabels = {
  on_track: "ปกติ",
  near_due: "ใกล้เกินกำหนด",
  overdue: "เกินกำหนด",
};

function slaBadge(row) {
  const state = slaState(row);
  if (!state) return '<span class="muted">-</span>';
  return `<span class="sla-badge sla-${state}">${slaLabels[state]}</span>`;
}

function complaintTableRow(r, compact = false) {
  return `<tr><td class="case-ref">${escapeHtml(r.reference_no)}</td><td><div class="case-title">${escapeHtml(r.title)}</div></td>${compact ? "" : `<td>${escapeHtml(r.contact_name || "-")}</td>`}<td>${escapeHtml(r.category_name || "-")}</td><td>${escapeHtml(r.department_name || "ยังไม่มอบหมาย")}</td><td>${fmt(r.created_at)}</td><td>${priorityBadge(r.priority)}</td><td>${slaBadge(r)}</td><td>${badge(r.status)}</td><td><button class="view-case" data-id="${r.id}">ดูรายละเอียด</button></td></tr>`;
}
function tableHtml(rows, compact = false, groupByMonth = false) {
  const columnCount = compact ? 9 : 10;
  const body = groupByMonth
    ? groupMapCasesByMonth(rows)
        .map(
          ([month, cases]) =>
            `<tr class="complaint-month-row"><td colspan="${columnCount}"><span>${escapeHtml(mapCaseMonthLabel(month))}</span><small>${cases.length} รายการในหน้านี้</small></td></tr>${cases.map((row) => complaintTableRow(row, compact)).join("")}`,
        )
        .join("")
    : rows.map((row) => complaintTableRow(row, compact)).join("");
  return `<div class="table-wrap"><table class="v3-table"><thead><tr><th>เลขรับเรื่อง</th><th>เรื่องร้องเรียน</th>${compact ? "" : "<th>ผู้ร้อง</th>"}<th>หมวดหมู่</th><th>หน่วยงาน</th><th>วันที่รับเรื่อง</th><th>ความสำคัญ</th><th>SLA</th><th>สถานะ</th><th></th></tr></thead><tbody>${body || `<tr><td colspan="${columnCount}" class="empty">ไม่พบเรื่องร้องเรียน</td></tr>`}</tbody></table></div>`;
}
function escapeHtml(v) {
  return String(v ?? "").replace(
    /[&<>'"]/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#039;",
        '"': "&quot;",
      })[c],
  );
}
function renderBars(
  sel,
  data = [],
  suffix = "",
  showPercentage = false,
  options = {},
) {
  const totalData = options.totalData || data;
  const totalValues = totalData.map((x) => Math.max(0, Number(x.value) || 0));
  const values = data.map((x) => Math.max(0, Number(x.value) || 0));
  const max = Math.max(1, ...totalValues);
  const sum = totalValues.reduce((total, value) => total + value, 0);
  const scale = showPercentage ? Math.max(1, sum) : max;
  const rankOffset = Number(options.rankOffset) || 0;
  $(sel).innerHTML =
    data
      .map((x, i) => {
        const value = values[i];
        const percentage = sum ? (value / sum) * 100 : 0;
        const percentageLabel = percentage.toLocaleString("th-TH", {
          minimumFractionDigits: percentage % 1 === 0 ? 0 : 1,
          maximumFractionDigits: 1,
        });
        const valueLabel = `${x.value}${suffix ? ` ${suffix}` : ""}${showPercentage ? ` (${percentageLabel}%)` : ""}`;
        return `<div class="metric-item ${showPercentage ? "insight-metric-item" : ""}"><div class="metric-label"><span class="metric-name">${showPercentage ? `<i class="metric-rank">${rankOffset + i + 1}</i>` : ""}${escapeHtml(x.label)}</span><b class="metric-value">${escapeHtml(valueLabel)}</b></div><progress class="metric-progress metric-tone-${(rankOffset + i) % 6}" value="${value}" max="${scale}" aria-label="${escapeHtml(x.label)} ${escapeHtml(valueLabel)}"></progress></div>`;
      })
      .join("") || '<p class="muted">ยังไม่มีข้อมูล</p>';
}
function renderPagedInsight(sel, pagerSel, data = [], pageKey, options = {}) {
  const configuredPageSize = Number(options.pageSize) || 0;
  const totalPages = configuredPageSize
    ? Math.max(1, Math.ceil(data.length / configuredPageSize))
    : data.length > 1
      ? 2
      : 1;
  const pageSize =
    configuredPageSize || Math.max(1, Math.ceil(data.length / totalPages));
  const page = Math.min(
    totalPages,
    Math.max(1, reportInsightPages[pageKey] || 1),
  );
  const showPercentage = options.showPercentage !== false;
  reportInsightPages[pageKey] = page;
  const start = (page - 1) * pageSize;
  renderBars(sel, data.slice(start, start + pageSize), "", showPercentage, {
    totalData: data,
    rankOffset: start,
  });
  const pager = $(pagerSel);
  pager.innerHTML = Array.from(
    { length: totalPages },
    (_, index) =>
      `<button type="button" class="insight-page-button ${page === index + 1 ? "active" : ""}" data-page="${index + 1}" aria-label="หน้าที่ ${index + 1}" ${page === index + 1 ? 'aria-current="page"' : ""}>${index + 1}</button>`,
  ).join("");
  pager.querySelectorAll(".insight-page-button").forEach(
    (button) =>
      (button.onclick = () => {
        reportInsightPages[pageKey] = Number(button.dataset.page);
        renderPagedInsight(sel, pagerSel, data, pageKey, options);
      }),
  );
}
function renderTrend(sel, data) {
  const box = $(sel);
  if (!data?.length) {
    box.innerHTML = '<p class="muted">ยังไม่มีข้อมูล</p>';
    return;
  }
  const w = 720,
    h = 260,
    p = 38,
    max = Math.max(
      1,
      ...data.flatMap((x) => [Number(x.received), Number(x.completed)]),
    );
  const x = (i) => p + (i * (w - p * 2)) / (data.length - 1 || 1),
    y = (v) => h - p - (Number(v) * (h - p * 2)) / max;
  const path = (key) =>
    data.map((d, i) => `${i ? "L" : "M"} ${x(i)} ${y(d[key])}`).join(" ");
  const area = `${path("received")} L ${x(data.length - 1)} ${h - p} L ${x(0)} ${h - p} Z`;
  box.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="กราฟแนวโน้ม"><defs><linearGradient id="trendArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3c7ce8" stop-opacity=".22"/><stop offset="1" stop-color="#3c7ce8" stop-opacity="0"/></linearGradient></defs>${[0, 0.25, 0.5, 0.75, 1].map((n) => `<line x1="${p}" x2="${w - p}" y1="${p + n * (h - p * 2)}" y2="${p + n * (h - p * 2)}" stroke="#e8efed"/>`).join("")}<path d="${area}" fill="url(#trendArea)"/><path d="${path("received")}" fill="none" stroke="#3c7ce8" stroke-width="3" stroke-linecap="round"/><path d="${path("completed")}" fill="none" stroke="#19a77e" stroke-width="3" stroke-linecap="round"/>${data.map((d, i) => `<circle cx="${x(i)}" cy="${y(d.received)}" r="4" fill="#3c7ce8"/><circle cx="${x(i)}" cy="${y(d.completed)}" r="4" fill="#19a77e"/><text x="${x(i)}" y="${h - 10}" text-anchor="middle" font-size="11" fill="#71817d">${d.month.slice(5)}</text>`).join("")}</svg>`;
}
function renderDonut() {
  const data = dashboardCache.statusBreakdown || [];
  const total = data.reduce((a, b) => a + Number(b.value), 0) || 1;
  let cursor = 0;
  const stops = data
    .map((d) => {
      const start = cursor;
      cursor += (Number(d.value) / total) * 360;
      return `${statusColors[d.label] || "#8a9692"} ${start}deg ${cursor}deg`;
    })
    .join(",");
  $("#statusDonut").style.background = `conic-gradient(${stops})`;
  $("#statusDonut").innerHTML =
    `<div class="donut-center"><div><strong>${total}</strong><span>รายการ</span></div></div>`;
  $("#statusLegend").innerHTML = data
    .map(
      (d) =>
        `<div class="legend-row"><span><i class="legend-color" style="background:${statusColors[d.label] || "#999"}"></i>${statusLabels[d.label] || d.label}</span><b>${d.value}</b></div>`,
    )
    .join("");
}
function renderUserUsage() {
  if (!isSystemAdmin()) return;
  const usage = dashboardCache.backendUsage;
  if (!usage) return;
  const labels = {
    recent_login: "เข้าใช้ใน 30 วัน",
    no_recent_login: "ยังไม่เข้าใช้ใน 30 วัน",
    inactive: "ระงับบัญชี",
  };
  const colors = {
    recent_login: "#18a575",
    no_recent_login: "#ef9b2d",
    inactive: "#8a9692",
  };
  const data = usage.user_status_breakdown || [];
  const total = data.reduce((sum, item) => sum + Number(item.value), 0);
  let cursor = 0;
  const stops = data
    .filter((item) => Number(item.value) > 0)
    .map((item) => {
      const start = cursor;
      cursor += (Number(item.value) / Math.max(1, total)) * 360;
      return `${colors[item.label] || "#8a9692"} ${start}deg ${cursor}deg`;
    })
    .join(",");
  const donut = $("#userStatusDonut");
  donut.style.background = stops ? `conic-gradient(${stops})` : "#eef3f1";
  donut.innerHTML = `<div class="donut-center"><div><strong>${total}</strong><span>บัญชี</span></div></div>`;
  $("#userStatusLegend").innerHTML = data
    .map(
      (item) =>
        `<div class="legend-row"><span><i class="legend-color" style="background:${colors[item.label] || "#999"}"></i>${escapeHtml(labels[item.label] || item.label)}</span><b>${escapeHtml(item.value)}</b></div>`,
    )
    .join("");
  renderBars(
    "#userDepartmentBars",
    usage.department_login_breakdown || [],
    "คน",
  );
}
function renderUrgent() {
  const rows = dashboardCache.urgentCases || [];
  $("#urgentCases").innerHTML =
    rows
      .map(
        (r) =>
          `<div class="urgent-item ${r.priority === "urgent" ? "urgent" : ""}"><i class="urgent-priority"></i><div><b>${escapeHtml(r.title)}</b><small>${r.reference_no} • ${escapeHtml(r.department_name || "ยังไม่มอบหมาย")}</small></div><div>${badge(r.status)}</div></div>`,
      )
      .join("") || '<p class="muted">ไม่มีเรื่องเร่งด่วนในขณะนี้</p>';
}
async function loadComplaints(page = 1) {
  currentPage = page;
  const pageSize = Number($("#complaintPageSize")?.value) || 20;
  const params = new URLSearchParams({
    page: String(page),
    limit: String(pageSize),
  });
  if ($("#statusFilter").value) params.set("status", $("#statusFilter").value);
  if ($("#complaintMonthFilter").value)
    params.set("month", $("#complaintMonthFilter").value);
  if ($("#complaintCategoryFilter").value)
    params.set("categoryId", $("#complaintCategoryFilter").value);
  if ($("#searchInput").value.trim())
    params.set("search", $("#searchInput").value.trim());
  addExecutiveDepartmentScope(params);
  $("#complaintTable").innerHTML =
    '<p class="muted" style="padding:1rem">กำลังโหลดข้อมูล…</p>';
  try {
    const r = await api(`/api/admin/complaints?${params}`);
    const monthFilter = $("#complaintMonthFilter");
    const selectedMonth = monthFilter.value;
    monthFilter.innerHTML = `<option value="">ทุกเดือน</option>${(r.filters?.months || []).map((month) => `<option value="${escapeHtml(month)}">${escapeHtml(mapCaseMonthLabel(month))}</option>`).join("")}`;
    monthFilter.value = selectedMonth;
    const categoryFilter = $("#complaintCategoryFilter");
    const selectedCategory = categoryFilter.value;
    categoryFilter.innerHTML = `<option value="">ทุกหมวดหมู่</option>${(r.filters?.categories || []).map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join("")}`;
    categoryFilter.value = selectedCategory;
    $("#complaintTable").innerHTML = tableHtml(r.data, false, true);
    document
      .querySelectorAll(".view-case")
      .forEach((b) => (b.onclick = () => openCase(b.dataset.id)));
    renderPagination(r.pagination);
  } catch (e) {
    show("#pageAlert", e.message);
  }
}
function renderPagination(p) {
  let html = "";
  for (let i = 1; i <= p.totalPages; i++) {
    if (
      p.totalPages > 8 &&
      Math.abs(i - p.page) > 2 &&
      i !== 1 &&
      i !== p.totalPages
    )
      continue;
    html += `<button class="page-btn ${i === p.page ? "active" : ""}" data-page="${i}">${i}</button>`;
  }
  $("#pagination").innerHTML = html;
  document
    .querySelectorAll(".page-btn")
    .forEach((b) => (b.onclick = () => loadComplaints(Number(b.dataset.page))));
}
async function loadImage(id) {
  const r = await fetch(`/api/admin/attachments/${id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    const result = await r.json().catch(() => ({}));
    throw new Error(result.message || `ไม่สามารถโหลดรูปภาพ (${r.status})`);
  }
  return URL.createObjectURL(await r.blob());
}
async function attachmentMarkup(attachments = []) {
  let images = "";
  for (const attachment of attachments) {
    try {
      const imageUrl = await loadImage(attachment.id);
      images += `<button type="button" class="image-thumbnail-button admin-image-thumbnail" data-image-url="${imageUrl}" data-image-caption="${escapeHtml(attachment.originalName || "รูปประกอบ")}" aria-label="ดูรูปภาพ"><img src="${imageUrl}" alt="${escapeHtml(attachment.originalName || "รูปประกอบ")}"><span>ดูรูป</span></button>`;
    } catch (error) {
      images += `<p class="image-load-error">โหลดรูป “${escapeHtml(attachment.originalName || "รูปประกอบ")}” ไม่สำเร็จ: ${escapeHtml(error.message)}</p>`;
    }
  }
  return images;
}
async function openCase(id) {
  const r = await api(`/api/admin/complaints/${id}`);
  const c = r.data;
  $("#drawerReference").textContent = c.reference_no;
  const citizenAttachments = (c.attachments || []).filter(
    (attachment) => attachment.source !== "staff",
  );
  const staffAttachments = (c.attachments || []).filter(
    (attachment) => attachment.source === "staff",
  );
  const progressAttachments = staffAttachments.filter(
    (attachment) =>
      attachment.workPhase === "in_progress" ||
      (!attachment.workPhase && c.status !== "completed"),
  );
  const completedAttachments = staffAttachments.filter(
    (attachment) =>
      attachment.workPhase === "completed" ||
      (!attachment.workPhase && c.status === "completed"),
  );
  const [citizenImages, progressImages, completedImages] = await Promise.all([
    attachmentMarkup(citizenAttachments),
    attachmentMarkup(progressAttachments),
    attachmentMarkup(completedAttachments),
  ]);
  const canManageAssignment = [
    "admin",
    "dev",
    "supervisor",
    "officer",
  ].includes(currentUser?.role);
  const canChangeDepartment = ["admin", "dev", "supervisor"].includes(
    currentUser?.role,
  );
  const canEditStatus = Boolean(c.canEditStatus);
  const depOptions = [
    ...(isSystemAdmin() ? ['<option value="">ยังไม่มอบหมาย</option>'] : []),
    ...departments.map(
      (d) =>
        `<option value="${d.id}" ${d.id === c.department_id ? "selected" : ""}>${escapeHtml(d.name_th)}</option>`,
    ),
  ].join("");
  const assignSection = canManageAssignment
    ? `<section class="drawer-section"><h3>มอบหมาย</h3><div class="drawer-form"><label>หน่วยงาน<select id="assignDepartment" ${canChangeDepartment ? "" : "disabled"}>${depOptions}</select>${canChangeDepartment ? "" : '<small class="muted">เฉพาะ Admin และ Supervisor เท่านั้นที่เปลี่ยนหน่วยงานได้</small>'}</label><label>เจ้าหน้าที่ผู้รับผิดชอบ<select id="assignStaffProfile"><option value="">กำลังโหลดรายชื่อ…</option></select><small class="muted">รายชื่อจะแสดงตามหน่วยงานที่เลือก</small></label><div class="two"><label>ความสำคัญ<select id="assignPriority"><option value="low">ต่ำ</option><option value="normal">ปกติ</option><option value="high">สูง</option><option value="urgent">เร่งด่วน</option></select></label><label>กำหนดเสร็จ<input id="assignDue" type="datetime-local"></label></div><label>หมายเหตุ<input id="assignNote" placeholder="รายละเอียดการมอบหมาย"></label><button id="assignButton" class="v3-primary">บันทึกการมอบหมายและแจ้ง LINE</button></div></section>`
    : "";
  const workImageSection =
    `<section class="drawer-section work-phase-card"><h3 class="phase-heading"><i class="work-phase-dot progress"></i>รูปภาพขณะกำลังดำเนินการ</h3>${progressImages ? `<div class="drawer-images">${progressImages}</div>` : '<p class="muted">ยังไม่มีรูปขณะกำลังดำเนินการ</p>'}</section>` +
    `<section class="drawer-section work-phase-card completed"><h3 class="phase-heading"><i class="work-phase-dot completed"></i>รูปภาพเมื่อเสร็จสิ้น</h3>${completedImages ? `<div class="drawer-images">${completedImages}</div>` : '<p class="muted">ยังไม่มีรูปเมื่อเสร็จสิ้น</p>'}</section>` +
    (canEditStatus
      ? `<section class="drawer-section work-progress-section"><h3>อัปเดตผลการดำเนินงาน</h3><div class="drawer-form"><div id="workImageAlert" class="alert hidden"></div><label>สถานะ<select id="workStatus"><option value="in_progress" ${c.status !== "completed" ? "selected" : ""} ${c.status === "completed" ? "disabled" : ""}>กำลังดำเนินการ</option><option value="completed" ${c.status === "completed" ? "selected" : ""}>เสร็จสิ้น</option></select></label><label>แนบรูปจากการปฏิบัติงาน (ถ้ามี)<input id="workImages" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple><small class="muted">รองรับ JPEG, PNG, WebP, HEIC และ HEIF ขนาดไม่เกิน 10 MB ต่อภาพ</small></label><label>หมายเหตุ<input id="workImageNote" maxlength="500" placeholder="เช่น ดำเนินการซ่อมแซมเรียบร้อย"></label><button id="saveWorkProgressButton" class="v3-primary" type="button">บันทึกสถานะและแจ้ง LINE</button></div></section>`
      : `<section class="drawer-section"><h3>อัปเดตผลการดำเนินงาน</h3><p class="muted">คุณสามารถแก้ไขสถานะได้เฉพาะเรื่องที่ได้รับมอบหมายเท่านั้น</p></section>`);
  const deleteSection = isSystemAdmin()
    ? `<section class="drawer-section complaint-danger-zone"><h3>ลบเรื่องร้องเรียน</h3><p>การลบจะนำเรื่อง ประวัติ และรูปภาพทั้งหมดออกอย่างถาวร</p><button id="deleteComplaintButton" type="button" class="delete-complaint-button">ลบเรื่องร้องเรียน</button></section>`
    : "";
  $("#drawerContent").innerHTML =
    `<div class="drawer-hero">${badge(c.status)}<h3>${escapeHtml(c.title)}</h3><p>${escapeHtml(c.category_name)} • ${priorityLabels[c.priority] || c.priority || "ปกติ"}</p></div><div class="drawer-grid"><div class="drawer-field"><span>ผู้ร้องเรียน</span><b>${escapeHtml(c.contact_name)}</b></div><div class="drawer-field"><span>โทรศัพท์</span><b>${escapeHtml(c.contact_phone)}</b></div><div class="drawer-field"><span>หน่วยงาน</span><b>${escapeHtml(c.department_name || "ยังไม่มอบหมาย")}</b></div><div class="drawer-field"><span>เจ้าหน้าที่ผู้รับผิดชอบ</span><b>${escapeHtml(c.assigned_profile_name || "ยังไม่มอบหมาย")}</b>${c.assigned_profile_position ? `<small>ตำแหน่ง: ${escapeHtml(c.assigned_profile_position)}</small>` : ""}${c.assigned_profile_phone ? `<small>เบอร์โทรศัพท์: ${escapeHtml(c.assigned_profile_phone)}</small>` : ""}</div><div class="drawer-field"><span>กำหนดแล้วเสร็จ</span><b>${fmtDateOnly(c.due_at)}</b>${slaState(c) ? `<small>${slaBadge(c)}</small>` : ""}</div></div><section class="drawer-section"><h3>รายละเอียดเรื่องร้องเรียน</h3><p>${escapeHtml(c.description)}</p><p><b>สถานที่:</b> ${escapeHtml(c.location_text)}</p>${c.latitude != null && c.longitude != null ? `<a class="map-link-button" target="_blank" rel="noopener" href="${openStreetMapUrl(c.latitude, c.longitude)}">⌖ เปิดใน OpenStreetMap</a>` : ""}</section>${citizenImages ? `<section class="drawer-section"><h3>รูปภาพจากผู้แจ้ง</h3><div class="drawer-images">${citizenImages}</div></section>` : ""}${workImageSection}${assignSection}<section class="drawer-section"><h3>ประวัติการดำเนินงาน</h3><div class="timeline">${(c.history || []).map((h) => `<div class="timeline-item"><b>${statusLabels[h.new_status] || h.new_status}</b><p>${escapeHtml(h.note || "-")}</p><small>${fmt(h.created_at)} ${h.staff_name ? `• ${escapeHtml(h.staff_name)}` : ""}</small></div>`).join("")}</div></section>${deleteSection}`;
  if (canManageAssignment) {
    $("#assignPriority").value = c.priority || "normal";
    if (c.due_at)
      $("#assignDue").value = new Date(c.due_at).toISOString().slice(0, 16);
    await loadAssignmentStaff(c.department_id, c.assigned_staff_profile_id);
    $("#assignDepartment").onchange = () =>
      loadAssignmentStaff($("#assignDepartment").value, null);
    $("#assignButton").onclick = () => assignCase(c.id);
  }
  if (canEditStatus) {
    $("#saveWorkProgressButton").onclick = () => saveWorkProgress(c.id);
  }
  if (isSystemAdmin())
    $("#deleteComplaintButton").onclick = () =>
      openDeleteComplaintConfirmation(c);
  $("#detailDrawer").classList.remove("hidden");
  $("#detailDrawerBackdrop").classList.remove("hidden");
  document
    .querySelectorAll(".admin-image-thumbnail")
    .forEach(
      (button) =>
        (button.onclick = () =>
          openAdminImageViewer(
            button.dataset.imageUrl,
            button.dataset.imageCaption,
          )),
    );
}
async function loadAssignmentStaff(departmentId, selectedId = null) {
  const select = $("#assignStaffProfile");
  if (!select) return;
  if (!departmentId) {
    select.innerHTML = '<option value="">ยังไม่มอบหมายเจ้าหน้าที่</option>';
    select.disabled = true;
    return;
  }
  select.disabled = true;
  select.innerHTML = '<option value="">กำลังโหลดรายชื่อ…</option>';
  try {
    const result = await api(
      `/api/admin/assignment-staff?departmentId=${encodeURIComponent(departmentId)}`,
    );
    select.innerHTML =
      '<option value="">ยังไม่มอบหมายเจ้าหน้าที่</option>' +
      result.data
        .map(
          (profile) =>
            `<option value="${profile.id}" ${profile.id === selectedId ? "selected" : ""}>${escapeHtml(profile.full_name)}${profile.position_title ? ` • ${escapeHtml(profile.position_title)}` : ""}${profile.phone ? ` • ${escapeHtml(profile.phone)}` : ""}</option>`,
        )
        .join("");
    select.disabled = false;
  } catch (error) {
    select.innerHTML = '<option value="">โหลดรายชื่อไม่สำเร็จ</option>';
    show("#pageAlert", error.message);
  }
}
function openDeleteComplaintConfirmation(complaint) {
  complaintPendingDelete = {
    id: complaint.id,
    referenceNo: complaint.reference_no,
  };
  clear("#deleteComplaintAlert");
  $("#deleteComplaintReference").textContent = complaint.reference_no;
  $("#deleteComplaintReason").value = "";
  const button = $("#deleteComplaintConfirmButton");
  button.disabled = false;
  button.textContent = "ลบเรื่องถาวร";
  const dialog = $("#deleteComplaintDialog");
  if (!dialog.open) dialog.showModal();
  window.setTimeout(() => $("#deleteComplaintReason").focus(), 100);
}
function closeDeleteComplaintConfirmation() {
  const dialog = $("#deleteComplaintDialog");
  if (dialog.open) dialog.close("cancel");
  complaintPendingDelete = null;
  $("#deleteComplaintReason").value = "";
  clear("#deleteComplaintAlert");
}
async function deleteComplaint() {
  if (!complaintPendingDelete) return;
  const reason = $("#deleteComplaintReason").value.trim();
  if (reason.length < 4 || reason.length > 100) {
    show(
      "#deleteComplaintAlert",
      "กรุณาระบุหมายเหตุการลบตั้งแต่ 4 ถึง 100 ตัวอักษร",
    );
    $("#deleteComplaintReason").focus();
    return;
  }
  const pending = { ...complaintPendingDelete };
  const button = $("#deleteComplaintConfirmButton");
  button.disabled = true;
  button.textContent = "กำลังลบ…";
  clear("#deleteComplaintAlert");
  try {
    await api(`/api/admin/complaints/${pending.id}`, {
      method: "DELETE",
      body: JSON.stringify({ reason }),
    });
    closeDeleteComplaintConfirmation();
    closeDetailDrawer();
    show("#pageAlert", `ลบเรื่อง ${pending.referenceNo} เรียบร้อย`, "success");
    await refreshScopedData();
  } catch (error) {
    show("#deleteComplaintAlert", error.message);
    button.disabled = false;
    button.textContent = "ลบเรื่องถาวร";
  }
}
async function saveWorkProgress(id) {
  const files = [...($("#workImages")?.files || [])];
  const allowedTypes = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
  ]);
  const maxBytes = 10 * 1024 * 1024;
  const emptyFile = files.find((file) => file.size === 0);
  if (emptyFile) {
    show(
      "#workImageAlert",
      `อัปโหลดไม่ได้: ไฟล์ “${emptyFile.name}” ไม่มีข้อมูลหรือไฟล์เสีย`,
    );
    return;
  }
  const unsupportedFile = files.find(
    (file) => !allowedTypes.has(file.type.toLowerCase()),
  );
  if (unsupportedFile) {
    show(
      "#workImageAlert",
      `อัปโหลดไม่ได้: ไฟล์ “${unsupportedFile.name}” เป็นชนิดที่ไม่รองรับ กรุณาใช้ JPEG, PNG, WebP, HEIC หรือ HEIF`,
    );
    return;
  }
  const oversizedFile = files.find((file) => file.size > maxBytes);
  if (oversizedFile) {
    const sizeMb = (oversizedFile.size / 1024 / 1024).toFixed(1);
    show(
      "#workImageAlert",
      `อัปโหลดไม่ได้: ไฟล์ “${oversizedFile.name}” มีขนาด ${sizeMb} MB ซึ่งเกินกำหนด 10 MB`,
    );
    return;
  }
  const button = $("#saveWorkProgressButton");
  clear("#workImageAlert");
  button.disabled = true;
  button.textContent = "กำลังบันทึกและแจ้ง LINE…";
  try {
    const payload = new FormData();
    files.forEach((file) => payload.append("images", file, file.name));
    payload.append("status", $("#workStatus").value);
    const note = $("#workImageNote").value.trim();
    if (note) payload.append("note", note);
    const result = await api(`/api/admin/complaints/${id}/work-attachments`, {
      method: "POST",
      body: payload,
    });
    show(
      "#pageAlert",
      result.message || "บันทึกสถานะและแจ้ง LINE เรียบร้อย",
      result.data?.lineNotified === false ? "error" : "success",
    );
    await openCase(id);
    // สถานะเปลี่ยนแล้ว ต้องรีเฟรชตาราง/แดชบอร์ดเบื้องหลังด้วย
    // ไม่งั้นแถวในรายการจะยังค้างสถานะเดิม (เช่น "มอบหมายแล้ว")
    await refreshBackgroundAfterStatusChange();
  } catch (error) {
    const reason =
      error instanceof TypeError
        ? "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่"
        : error.message || "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ";
    show(
      "#workImageAlert",
      reason.startsWith("อัปโหลดไม่สำเร็จ")
        ? reason
        : `บันทึกไม่สำเร็จ: ${reason}`,
    );
    button.disabled = false;
    button.textContent = "บันทึกสถานะและแจ้ง LINE";
  }
}
// รีโหลดข้อมูลที่แสดงอยู่เบื้องหลังลิ้นชัก (KPI, แดชบอร์ด, ตารางรายการ)
// โดยคงหน้าที่ผู้ใช้เปิดอยู่ไว้เหมือนเดิม
async function refreshBackgroundAfterStatusChange() {
  try {
    const result = await api(scopedDashboardPath());
    dashboardCache = result.data;
    renderDashboard();
    const active =
      document.querySelector(".v3-nav-item.active")?.dataset.view || "dashboard";
    if (active === "complaints") await loadComplaints(currentPage);
    if (active === "map") renderMapCases();
    if (active === "reports") renderReports();
  } catch (error) {
    // รีเฟรชไม่สำเร็จไม่ควรทำให้การบันทึกที่สำเร็จไปแล้วดูเหมือนล้มเหลว
    console.warn("refresh after status change failed:", error);
  }
}
async function assignCase(id) {
  try {
    const payload = {
      priority: $("#assignPriority").value,
      dueAt: $("#assignDue").value
        ? new Date($("#assignDue").value).toISOString()
        : null,
      note: $("#assignNote").value || null,
    };

    if (["admin", "dev", "supervisor"].includes(currentUser?.role)) {
      payload.departmentId = $("#assignDepartment").value || null;
    }
    payload.staffProfileId = $("#assignStaffProfile")?.value || null;

    const result = await api(`/api/admin/complaints/${id}/assignment`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });

    show(
      "#pageAlert",
      result.message || "บันทึกการมอบหมายเรียบร้อย",
      result.data?.lineNotified === false ? "error" : "success",
    );
    closeDetailDrawer();
    await boot();
  } catch (e) {
    show("#pageAlert", e.message);
  }
}
function ensureSmartGeoMap() {
  if (smartGeoMap) return smartGeoMap;
  const mapElement = $("#adminComplaintMap");
  if (!mapElement) throw new Error("ไม่พบพื้นที่แสดงแผนที่");
  if (typeof window.L === "undefined")
    throw new Error("ไม่สามารถโหลดระบบแผนที่ได้");
  smartGeoMap = window.L.map(mapElement, {
    zoomControl: true,
    attributionControl: true,
  });
  window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(smartGeoMap);
  smartGeoMarkers = window.L.layerGroup().addTo(smartGeoMap);
  smartGeoMap.setView([9.1382, 99.3217], 11);
  const refreshMapSize = () => {
    window.clearTimeout(smartGeoResizeTimer);
    smartGeoResizeTimer = window.setTimeout(() => {
      smartGeoMap?.invalidateSize({ pan: false, debounceMoveend: true });
    }, 180);
  };
  window.addEventListener("resize", refreshMapSize, { passive: true });
  window.addEventListener("orientationchange", refreshMapSize, {
    passive: true,
  });
  window.visualViewport?.addEventListener("resize", refreshMapSize, {
    passive: true,
  });
  return smartGeoMap;
}
function createMapPopup(c) {
  const popup = document.createElement("div");
  popup.className = "smart-map-popup";
  const title = document.createElement("strong");
  title.textContent = c.title || "-";
  const reference = document.createElement("span");
  reference.textContent = c.reference_no || "-";
  const location = document.createElement("p");
  location.textContent = c.location_text || "-";
  const link = document.createElement("a");
  link.href = openStreetMapUrl(c.latitude, c.longitude);
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "เปิดใน OpenStreetMap →";
  popup.append(title, reference, location);
  const firstAttachment = c.citizen_attachments?.[0];
  if (firstAttachment) {
    const photoButton = document.createElement("button");
    photoButton.type = "button";
    photoButton.className = "map-popup-citizen-photo";
    photoButton.dataset.mapPhotoId = firstAttachment.id;
    photoButton.dataset.mapPhotoCaption =
      firstAttachment.originalName || `รูปจากผู้แจ้ง ${c.reference_no}`;
    photoButton.innerHTML = `<span>กำลังโหลดรูปจากผู้แจ้ง…</span>`;
    popup.append(photoButton);
  }
  popup.append(link);
  return popup;
}
async function loadMapPopupPhoto(popup) {
  const button = popup.querySelector(".map-popup-citizen-photo");
  if (!button || button.dataset.loaded === "true") return;
  try {
    const id = button.dataset.mapPhotoId;
    let imageUrl = mapCitizenPhotoUrls.get(id);
    if (!imageUrl) {
      imageUrl = await loadImage(id);
      mapCitizenPhotoUrls.set(id, imageUrl);
    }
    button.innerHTML = `<img src="${imageUrl}" alt="${escapeHtml(button.dataset.mapPhotoCaption || "รูปจากผู้แจ้ง")}"><span>แตะเพื่อขยายรูป</span>`;
    button.dataset.loaded = "true";
    button.onclick = (event) => {
      event.stopPropagation();
      openAdminImageViewer(
        imageUrl,
        button.dataset.mapPhotoCaption || "รูปจากผู้แจ้ง",
      );
    };
  } catch (error) {
    button.innerHTML = `<span class="image-load-error">โหลดรูปไม่สำเร็จ: ${escapeHtml(error.message)}</span>`;
    button.disabled = true;
  }
}
function mapCaseMonthKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function mapCaseMonthLabel(key) {
  if (key === "unknown") return "ไม่ระบุเดือน";
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("th-TH", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}
function groupMapCasesByMonth(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = mapCaseMonthKey(row.created_at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return [...groups.entries()];
}
function renderMapCases() {
  const allRows = (dashboardCache?.mapCases || []).filter(
    (c) =>
      Number.isFinite(Number(c.latitude)) &&
      Number.isFinite(Number(c.longitude)),
  );
  const months = [
    ...new Set(allRows.map((c) => mapCaseMonthKey(c.created_at))),
  ];
  if (selectedMapMonth !== "all" && !months.includes(selectedMapMonth))
    selectedMapMonth = "all";
  const monthOptions = [
    `<option value="all">ทุกเดือน (${allRows.length} รายการ)</option>`,
    ...months.map(
      (month) =>
        `<option value="${escapeHtml(month)}">${escapeHtml(mapCaseMonthLabel(month))}</option>`,
    ),
  ].join("");
  ["#mapMonthFilter", "#mobileMapMonthFilter"].forEach((selector) => {
    const filter = $(selector);
    if (!filter) return;
    filter.innerHTML = monthOptions;
    filter.value = selectedMapMonth;
    filter.onchange = () => {
      selectedMapMonth = filter.value;
      mobileMapPage = 1;
      renderMapCases();
    };
  });
  const rows =
    selectedMapMonth === "all"
      ? allRows
      : allRows.filter(
          (c) => mapCaseMonthKey(c.created_at) === selectedMapMonth,
        );
  const groups = groupMapCasesByMonth(rows);
  const mobilePageCount = Math.max(
    1,
    Math.ceil(rows.length / mobileMapPageSize),
  );
  mobileMapPage = Math.min(Math.max(1, mobileMapPage), mobilePageCount);
  const mobileRows = rows.slice(
    (mobileMapPage - 1) * mobileMapPageSize,
    mobileMapPage * mobileMapPageSize,
  );
  const mobileGroups = groupMapCasesByMonth(mobileRows);
  const listMarkup =
    groups
      .map(
        ([month, cases]) =>
          `<section class="map-month-group"><h3 class="map-month-title"><span>${escapeHtml(mapCaseMonthLabel(month))}</span><small>${cases.length} รายการ</small></h3>${cases.map((c) => `<article class="location-case">${badge(c.status)}<h3>${escapeHtml(c.title)}</h3><p>${escapeHtml(c.reference_no)}</p><p>${escapeHtml(c.location_text || "-")}</p><div class="map-case-actions"><button type="button" class="focus-map-case" data-case-id="${escapeHtml(c.reference_no)}">ดูบนแผนที่</button><a target="_blank" rel="noopener" href="${openStreetMapUrl(c.latitude, c.longitude)}">เปิด OpenStreetMap →</a></div></article>`).join("")}</section>`,
      )
      .join("") || '<p class="muted">ไม่มีรายการในเดือนที่เลือก</p>';
  $("#mapComplaintList").innerHTML = listMarkup;
  const mobileList = $("#mobileMapCaseList");
  if (mobileList) {
    mobileList.innerHTML =
      mobileGroups
        .map(
          ([month, cases]) =>
            `<section class="mobile-map-month-group"><h3 class="map-month-title"><span>${escapeHtml(mapCaseMonthLabel(month))}</span><small>${cases.length} รายการ</small></h3>${cases.map((c) => `<button type="button" class="mobile-map-case-row" data-case-id="${escapeHtml(c.reference_no)}" aria-label="แสดงเรื่อง ${escapeHtml(c.title || "-")} บนแผนที่"><span class="mobile-map-case-heading">${badge(c.status)}<strong>${escapeHtml(c.title || "-")}</strong></span><span class="mobile-map-case-reference">${escapeHtml(c.reference_no)}</span><span class="mobile-map-case-date">${escapeHtml(fmt(c.created_at))}</span><span class="mobile-map-case-location">${escapeHtml(c.location_text || "-")}</span></button>`).join("")}</section>`,
        )
        .join("") || '<p class="muted">ไม่มีรายการในเดือนที่เลือก</p>';
  }
  const mobilePagination = $("#mobileMapPagination");
  if (mobilePagination) {
    mobilePagination.innerHTML =
      mobilePageCount > 1
        ? Array.from({ length: mobilePageCount }, (_, index) => {
            const page = index + 1;
            return `<button type="button" class="mobile-map-page-button ${page === mobileMapPage ? "is-active" : ""}" data-mobile-map-page="${page}" aria-label="หน้าที่ ${page}" ${page === mobileMapPage ? 'aria-current="page"' : ""}>${page}</button>`;
          }).join("")
        : "";
    mobilePagination
      .querySelectorAll(".mobile-map-page-button")
      .forEach((button) => {
        button.onclick = () => {
          mobileMapPage = Number(button.dataset.mobileMapPage);
          renderMapCases();
          $("#mobileMapLocations")?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        };
      });
  }
  const mobileCount = $("#mobileMapComplaintCount");
  if (mobileCount) mobileCount.textContent = `(${rows.length} รายการ)`;
  const mapElement = $("#adminComplaintMap");
  try {
    const map = ensureSmartGeoMap();
    smartGeoMarkers.clearLayers();
    smartGeoMarkerById = new Map();
    const bounds = [];
    rows.forEach((c) => {
      const point = [Number(c.latitude), Number(c.longitude)];
      const marker = window.L.circleMarker(point, {
        radius: window.matchMedia("(pointer:coarse)").matches ? 13 : 9,
        color: "#ffffff",
        weight: 3,
        fillColor: statusColors[c.status] || "#d84c4c",
        fillOpacity: 1,
      }).addTo(smartGeoMarkers);
      const popupContent = createMapPopup(c);
      marker.bindPopup(popupContent, {
        maxWidth: 260,
        minWidth: 190,
        autoPan: true,
        keepInView: true,
        autoPanPaddingTopLeft: [24, 24],
        autoPanPaddingBottomRight: [24, 24],
      });
      marker.on("popupopen", () => loadMapPopupPhoto(popupContent));
      smartGeoMarkerById.set(String(c.reference_no), marker);
      bounds.push(point);
    });
    const fitMapToMarkers = () => {
      if (bounds.length === 1) map.setView(bounds[0], 16, { animate: false });
      else if (bounds.length > 1)
        map.fitBounds(bounds, {
          paddingTopLeft: [56, 72],
          paddingBottomRight: [56, 56],
          maxZoom: 16,
          animate: false,
        });
      else map.setView([9.1382, 99.3217], 11, { animate: false });
    };
    fitMapToMarkers();
    document.querySelectorAll(".focus-map-case").forEach((button) => {
      button.onclick = () => {
        const marker = smartGeoMarkerById.get(button.dataset.caseId);
        if (!marker) return;
        map.setView(marker.getLatLng(), 17, { animate: false });
        marker.openPopup();
      };
    });
    document.querySelectorAll(".mobile-map-case-row").forEach((row) => {
      row.onclick = () => {
        const marker = smartGeoMarkerById.get(row.dataset.caseId);
        if (!marker) return;
        document
          .querySelectorAll(".mobile-map-case-row.is-active")
          .forEach((item) => item.classList.remove("is-active"));
        row.classList.add("is-active");
        map.setView(marker.getLatLng(), 17, { animate: false });
        marker.openPopup();
        mapElement.scrollIntoView({ behavior: "smooth", block: "center" });
      };
    });
    window.setTimeout(() => {
      map.invalidateSize({ pan: false, debounceMoveend: true });
      fitMapToMarkers();
    }, 180);
  } catch (error) {
    if (mapElement) {
      mapElement.classList.add("map-load-error");
      mapElement.textContent = `ไม่สามารถแสดงแผนที่ได้: ${error.message}`;
    }
  }
}
function renderReports() {
  const s = dashboardCache.summary;
  const data = [
    ["เรื่องทั้งหมด", s.total],
    ["เดือนนี้", s.this_month],
    ["กำลังดำเนินการ", s.in_progress],
    ["เสร็จสิ้น", s.completed],
    ["เฉลี่ยวันดำเนินการ", s.avg_days],
  ];
  $("#reportSummary").innerHTML = data
    .map(([l, v]) => `<div><strong>${v || 0}</strong><span>${l}</span></div>`)
    .join("");
  renderPagedInsight(
    "#reportCategory",
    "#reportCategoryPagination",
    dashboardCache.categoryBreakdown || [],
    "category",
  );
  renderPagedInsight(
    "#reportDepartment",
    "#reportDepartmentPagination",
    dashboardCache.departmentBreakdown || [],
    "department",
  );
  renderTrend("#reportTrend", dashboardCache.monthlyTrend);
}

function governanceTable(headers, rows) {
  return `<div class="table-wrap"><table class="v3-table"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}
function parseAuditDetail(detail) {
  if (typeof detail !== "string")
    return detail && typeof detail === "object" ? detail : {};
  try {
    const parsed = JSON.parse(detail);
    return parsed && typeof parsed === "object" ? parsed : { value: detail };
  } catch {
    return { value: detail };
  }
}
function auditNoteHtml(detail) {
  const value = parseAuditDetail(detail);
  const deletionReason = String(value.deletionReason || "").trim();
  return deletionReason
    ? `<div class="audit-delete-note">${escapeHtml(deletionReason)}</div>`
    : '<span class="muted">-</span>';
}
function auditDetailHtml(detail) {
  const value = parseAuditDetail(detail);
  const remaining = { ...value };
  delete remaining.deletionReason;
  if (!Object.keys(remaining).length) return '<span class="muted">-</span>';

  const compact = JSON.stringify(remaining);
  // สั้นพอที่จะอ่านจบในบรรทัดเดียว ไม่ต้องมีปุ่ม
  if (compact.length <= 60) {
    return `<div class="audit-detail">${escapeHtml(compact)}</div>`;
  }

  // ยาวเกิน แสดงย่อพร้อมปุ่มกางดูฉบับเต็มแบบจัดรูปแบบ
  const pretty = JSON.stringify(remaining, null, 2);
  return `<details class="audit-detail-box"><summary><span class="audit-detail-preview">${escapeHtml(compact)}</span><span class="audit-detail-toggle"></span></summary><pre class="audit-detail-full">${escapeHtml(pretty)}</pre></details>`;
}
function setGovernanceTab(mode) {
  governanceMode = mode;
  document
    .querySelectorAll(".governance-tab")
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.governance === mode),
    );
  document
    .querySelectorAll(".governance-panel")
    .forEach((p) => p.classList.add("hidden"));
  $(`#governance${mode[0].toUpperCase() + mode.slice(1)}`).classList.remove(
    "hidden",
  );
}
async function loadGovernance(mode = "categories") {
  setGovernanceTab(mode);
  try {
    if (mode === "categories") {
      const r = await api("/api/admin/governance/categories");
      const isAdmin = isSystemAdmin();
      const headers = isAdmin
        ? [
            "รหัส",
            "ชื่อหมวดหมู่",
            "หน่วยงานรับผิดชอบ",
            "SLA",
            "สถานะ",
            "จัดการ",
          ]
        : ["รหัส", "ชื่อหมวดหมู่", "หน่วยงานรับผิดชอบ", "SLA", "สถานะ"];

      $("#categoryGovernanceTable").innerHTML = governanceTable(
        headers,
        r.data.map(
          (x) => `<tr>
        <td class="case-ref">${escapeHtml(x.code)}</td>
        <td>${escapeHtml(x.name_th)}</td>
        <td>${escapeHtml(x.department_name || "ยังไม่กำหนด")}</td>
        <td>${x.sla_hours} ชม.</td>
        <td>${x.is_active ? '<span class="v3-badge status-completed">เปิดใช้งาน</span>' : '<span class="v3-badge status-cancelled">ปิดใช้งาน</span>'}</td>
        ${isAdmin ? `<td><div class="governance-actions"><button class="governance-edit edit-category" data-id="${x.id}" data-json='${escapeHtml(JSON.stringify(x))}'>แก้ไข</button><button class="governance-delete delete-category" data-id="${x.id}" data-name="${escapeHtml(x.name_th)}" data-count="${x.complaint_count || 0}">ลบ</button></div></td>` : ""}
      </tr>`,
        ),
      );

      if (isAdmin) {
        document
          .querySelectorAll(".edit-category")
          .forEach(
            (b) =>
              (b.onclick = () =>
                openGovernanceDialog("category", JSON.parse(b.dataset.json))),
          );
        document
          .querySelectorAll(".delete-category")
          .forEach(
            (b) =>
              (b.onclick = () =>
                openDeleteCategoryConfirmation({
                  id: b.dataset.id,
                  name: b.dataset.name,
                  count: Number(b.dataset.count || 0),
                })),
          );
      }
    }
    if (mode === "departments") {
      const r = await api("/api/admin/governance/departments");
      const isAdmin = isSystemAdmin();
      const headers = isAdmin
        ? ["รหัส", "ชื่อหน่วยงาน", "สถานะ", "จัดการ"]
        : ["รหัส", "ชื่อหน่วยงาน", "สถานะ"];
      $("#departmentGovernanceTable").innerHTML = governanceTable(
        headers,
        r.data.map(
          (x) =>
            `<tr><td class="case-ref">${escapeHtml(x.code)}</td><td>${escapeHtml(x.name_th)}</td><td>${x.is_active ? '<span class="v3-badge status-completed">เปิดใช้งาน</span>' : '<span class="v3-badge status-cancelled">ปิดใช้งาน</span>'}</td>${isAdmin ? `<td><button class="governance-edit edit-department" data-id="${x.id}" data-json='${escapeHtml(JSON.stringify(x))}'>แก้ไข</button></td>` : ""}</tr>`,
        ),
      );
      if (isAdmin)
        document
          .querySelectorAll(".edit-department")
          .forEach(
            (b) =>
              (b.onclick = () =>
                openGovernanceDialog("department", JSON.parse(b.dataset.json))),
          );
    }
    if (mode === "users") {
      if (!isSystemAdmin()) {
        throw new Error(
          "เฉพาะผู้ดูแลระบบและผู้พัฒนาระบบเท่านั้นที่ดูข้อมูลผู้ใช้งานได้",
        );
      }
      const r = await api("/api/admin/governance/users");
      const headers = [
        "ชื่อผู้ใช้",
        "ชื่อแสดงผล",
        "สิทธิ์",
        "หน่วยงาน",
        "เข้าสู่ระบบล่าสุด",
        "สถานะ",
        "จัดการ",
      ];
      $("#userGovernanceTable").innerHTML = governanceTable(
        headers,
        r.data.map((x) => {
          const protectedDev = x.role === "dev";
          const editDisabled = protectedDev && currentUser.role !== "dev";
          return `<tr><td class="case-ref">${escapeHtml(x.username)}</td><td>${escapeHtml(x.display_name)}</td><td>${escapeHtml(roleLabel(x.role))}</td><td>${escapeHtml(x.department_name || (["admin", "dev", "executive", "exclusive"].includes(x.role) ? "ทุกหน่วยงาน" : "ยังไม่ได้กำหนด"))}</td><td>${fmt(x.last_login_at)}</td><td>${x.is_active ? '<span class="v3-badge status-completed">ใช้งาน</span>' : '<span class="v3-badge status-cancelled">ระงับ</span>'}</td><td><div class="governance-actions"><button class="governance-edit edit-user" data-json='${escapeHtml(JSON.stringify(x))}' ${editDisabled ? 'disabled title="Admin ไม่สามารถแก้ไขบัญชี DEV ได้"' : ""}>แก้ไข</button><button class="governance-delete delete-user" data-json='${escapeHtml(JSON.stringify(x))}' ${x.id === currentUser.id || protectedDev ? 'disabled title="ไม่สามารถลบบัญชี DEV หรือบัญชีที่กำลังใช้งาน"' : ""}>ลบ</button></div></td></tr>`;
        }),
      );
      document
        .querySelectorAll(".edit-user:not(:disabled)")
        .forEach(
          (b) =>
            (b.onclick = () =>
              openGovernanceDialog("user", JSON.parse(b.dataset.json))),
        );
      document
        .querySelectorAll(".delete-user:not(:disabled)")
        .forEach(
          (b) =>
            (b.onclick = () =>
              openDeleteUserConfirmation(JSON.parse(b.dataset.json))),
        );
    }
    if (mode === "staffProfiles") {
      if (currentUser?.role !== "dev") {
        throw new Error("เฉพาะ DEV เท่านั้นที่ดูข้อมูลเจ้าหน้าที่ได้");
      }
      const params = new URLSearchParams();
      if (staffProfileDepartmentId)
        params.set("departmentId", staffProfileDepartmentId);
      const r = await api(
        `/api/admin/governance/staff-profiles${params.size ? `?${params}` : ""}`,
      );
      const headers = [
        "ชื่อ–สกุล",
        "ตำแหน่ง",
        "หน่วยงาน",
        "LINE ID",
        "เบอร์โทรศัพท์",
        "แก้ไขล่าสุด",
        "จัดการ",
      ];
      $("#staffProfileGovernanceTable").innerHTML = governanceTable(
        headers,
        r.data.map(
          (x) =>
            `<tr><td><b>${escapeHtml(x.full_name)}</b></td><td>${escapeHtml(x.position_title)}</td><td>${escapeHtml(x.department_name || "ยังไม่กำหนด")}</td><td class="case-ref">${escapeHtml(x.line_id || "-")}</td><td>${escapeHtml(x.phone || "-")}</td><td>${fmt(x.updated_at)}</td><td><div class="governance-actions"><button class="governance-edit edit-staff-profile" data-json='${escapeHtml(JSON.stringify(x))}'>แก้ไข</button><button class="governance-delete delete-staff-profile" data-json='${escapeHtml(JSON.stringify(x))}'>ลบ</button></div></td></tr>`,
        ),
      );
      document
        .querySelectorAll(".edit-staff-profile")
        .forEach(
          (b) =>
            (b.onclick = () =>
              openGovernanceDialog("staffProfile", JSON.parse(b.dataset.json))),
        );
      document
        .querySelectorAll(".delete-staff-profile")
        .forEach(
          (b) =>
            (b.onclick = () =>
              openDeleteStaffProfileConfirmation(JSON.parse(b.dataset.json))),
        );
    }
    if (mode === "audit") {
      const r = await api("/api/admin/governance/audit-logs");
      $("#auditGovernanceTable").innerHTML = governanceTable(
        [
          "วันเวลา",
          "ผู้ดำเนินการ",
          "กิจกรรม",
          "ประเภท",
          "หมายเหตุ",
          "รายละเอียด",
        ],
        r.data.map(
          (x) =>
            `<tr><td>${fmt(x.created_at)}</td><td>${escapeHtml(x.actor_name || "ระบบ")}</td><td class="case-ref">${escapeHtml(x.action)}</td><td>${escapeHtml(x.entity_type)}</td><td>${auditNoteHtml(x.detail)}</td><td>${auditDetailHtml(x.detail)}</td></tr>`,
        ),
      );
    }
  } catch (e) {
    show("#pageAlert", e.message);
  }
}
function dialogField(label, name, type = "text", value = "", extra = "") {
  return `<label>${label}<input name="${name}" type="${type}" value="${escapeHtml(value ?? "")}" ${extra}></label>`;
}
function userDepartmentField(data = null) {
  const selected = data?.department_id || "";
  const options = [
    '<option value="">-- เลือกหน่วยงาน --</option>',
    ...departments
      .filter((d) => d.is_active !== false)
      .map(
        (d) =>
          `<option value="${d.id}" ${d.id === selected ? "selected" : ""}>${escapeHtml(d.name_th)}</option>`,
      ),
  ].join("");
  return `<label id="userDepartmentField">หน่วยงาน<select name="departmentId">${options}</select><small class="muted">จำเป็นสำหรับ Officer และ Supervisor</small></label>`;
}
function categoryDepartmentField(data = null) {
  const selected = data?.department_id || "";
  const options = [
    '<option value="">-- เลือกหน่วยงานรับผิดชอบ --</option>',
    ...departments
      .filter((d) => d.is_active !== false)
      .map(
        (d) =>
          `<option value="${d.id}" ${d.id === selected ? "selected" : ""}>${escapeHtml(d.name_th)}</option>`,
      ),
  ].join("");
  return `<label>หน่วยงานรับผิดชอบ<select name="departmentId" required>${options}</select><small class="muted">เรื่องใหม่ในหมวดหมู่นี้จะถูกส่งให้หน่วยงานที่เลือกโดยอัตโนมัติ</small></label>`;
}
function staffProfileDepartmentField(data = null) {
  const selected = data?.department_id || "";
  const selectedDepartment = departments.find((d) => d.id === selected);
  const options = [
    '<option value="">-- เลือกหน่วยงาน --</option>',
    ...departments
      .filter((d) => d.is_active !== false)
      .map(
        (d) =>
          `<option value="${d.id}" ${d.id === selected ? "selected" : ""}>${escapeHtml(d.name_th)}</option>`,
      ),
  ].join("");
  return `<label>หน่วยงานต้นสังกัด<select id="staffProfileDepartment" name="departmentId" required>${options}</select><small id="staffProfileDepartmentPreview" class="muted">${selectedDepartment ? `หน่วยงานที่เลือก: ${escapeHtml(selectedDepartment.name_th)}` : "กรุณาเลือกหน่วยงานของเจ้าหน้าที่"}</small></label>`;
}
function openGovernanceDialog(type, data = null) {
  if (type === "staffProfile" && currentUser?.role !== "dev") {
    show("#pageAlert", "เฉพาะ DEV เท่านั้นที่จัดการข้อมูลเจ้าหน้าที่ได้");
    return;
  }
  if (
    (type === "department" || type === "category" || type === "user") &&
    !isSystemAdmin()
  ) {
    show("#pageAlert", "Supervisor มีสิทธิ์ดูข้อมูลเท่านั้น");
    return;
  }
  governanceEditing = { type, data };
  const fields = $("#governanceDialogFields");
  const title = $("#governanceDialogTitle");
  if (type === "category") {
    title.textContent = data ? "แก้ไขหมวดหมู่" : "เพิ่มหมวดหมู่";
    fields.innerHTML =
      dialogField(
        "รหัสหมวดหมู่",
        "code",
        "text",
        data?.code || "",
        'required minlength="2" maxlength="50" pattern="[A-Za-z0-9_]+" autocomplete="off"',
      ) +
      dialogField(
        "ชื่อหมวดหมู่",
        "nameTh",
        "text",
        data?.name_th || "",
        "required",
      ) +
      categoryDepartmentField(data) +
      dialogField(
        "SLA (ชั่วโมง)",
        "slaHours",
        "number",
        data?.sla_hours || 72,
        'required min="1"',
      ) +
      (data
        ? `<label>สถานะ<select name="isActive"><option value="true" ${data.is_active ? "selected" : ""}>เปิดใช้งาน</option><option value="false" ${!data.is_active ? "selected" : ""}>ปิดใช้งาน</option></select></label>`
        : "");
  }
  if (type === "department") {
    title.textContent = data ? "แก้ไขหน่วยงาน" : "เพิ่มหน่วยงาน";
    fields.innerHTML =
      dialogField(
        "รหัสหน่วยงาน",
        "code",
        "text",
        data?.code || "",
        'required minlength="2" maxlength="50" pattern="[A-Za-z0-9_]+" autocomplete="off"',
      ) +
      dialogField(
        "ชื่อหน่วยงาน",
        "nameTh",
        "text",
        data?.name_th || "",
        "required",
      ) +
      (data
        ? `<label>สถานะ<select name="isActive"><option value="true" ${data.is_active ? "selected" : ""}>เปิดใช้งาน</option><option value="false" ${!data.is_active ? "selected" : ""}>ปิดใช้งาน</option></select></label>`
        : "");
  }
  if (type === "user") {
    title.textContent = data ? "แก้ไขผู้ใช้งาน" : "เพิ่มผู้ใช้งาน";
    const devOption =
      currentUser?.role === "dev" && data?.role === "dev"
        ? '<option value="dev" selected>DEV</option>'
        : "";
    fields.innerHTML =
      (data
        ? ""
        : dialogField("ชื่อผู้ใช้", "username", "text", "", "required")) +
      dialogField(
        "ชื่อแสดงผล",
        "displayName",
        "text",
        data?.display_name || "",
        "required",
      ) +
      `<label>สิทธิ์<select name="role" id="governanceUserRole"><option value="officer" ${data?.role === "officer" ? "selected" : ""}>Officer</option><option value="supervisor" ${data?.role === "supervisor" ? "selected" : ""}>Supervisor</option><option value="executive" ${["executive", "exclusive"].includes(data?.role) ? "selected" : ""}>Executive</option><option value="admin" ${data?.role === "admin" ? "selected" : ""}>Admin</option>${devOption}</select></label>` +
      userDepartmentField(data) +
      dialogField(
        data
          ? "รหัสผ่านใหม่ (เว้นว่างหากไม่เปลี่ยน)"
          : "รหัสผ่านอย่างน้อย 12 ตัว",
        "password",
        "password",
        "",
        "" + (data ? "" : 'required minlength="12"'),
      ) +
      (data
        ? `<label>สถานะ<select name="isActive"><option value="true" ${data.is_active ? "selected" : ""}>ใช้งาน</option><option value="false" ${!data.is_active ? "selected" : ""}>ระงับ</option></select></label>`
        : "");
    const syncDepartmentField = () => {
      const role = $("#governanceUserRole")?.value;
      const field = $("#userDepartmentField");
      if (field)
        field.classList.toggle(
          "hidden",
          ["admin", "dev", "executive"].includes(role),
        );
    };
    $("#governanceUserRole").onchange = syncDepartmentField;
    syncDepartmentField();
  }
  if (type === "staffProfile") {
    title.textContent = data
      ? "แก้ไขข้อมูลเจ้าหน้าที่"
      : "เพิ่มข้อมูลเจ้าหน้าที่";
    fields.innerHTML =
      dialogField(
        "ชื่อ–สกุล",
        "fullName",
        "text",
        data?.full_name || "",
        'required maxlength="200" autocomplete="name"',
      ) +
      dialogField(
        "ตำแหน่ง",
        "positionTitle",
        "text",
        data?.position_title || "",
        'required maxlength="200"',
      ) +
      staffProfileDepartmentField(data) +
      dialogField(
        "LINE ID (ไม่บังคับ)",
        "lineId",
        "text",
        data?.line_id || "",
        'maxlength="100" autocomplete="off"',
      ) +
      dialogField(
        "เบอร์โทรศัพท์ (ไม่บังคับ)",
        "phone",
        "tel",
        data?.phone || "",
        'maxlength="30" inputmode="tel"',
      );
    const departmentSelect = $("#staffProfileDepartment");
    const departmentPreview = $("#staffProfileDepartmentPreview");
    departmentSelect.onchange = () => {
      const selectedOption =
        departmentSelect.options[departmentSelect.selectedIndex];
      departmentPreview.textContent = departmentSelect.value
        ? `หน่วยงานที่เลือก: ${selectedOption.textContent}`
        : "กรุณาเลือกหน่วยงานของเจ้าหน้าที่";
    };
  }
  $("#governanceDialog").showModal();
}
async function saveGovernance() {
  if (
    governanceEditing?.type === "staffProfile" &&
    currentUser?.role !== "dev"
  ) {
    throw new Error("เฉพาะ DEV เท่านั้นที่จัดการข้อมูลเจ้าหน้าที่ได้");
  }
  if (
    ["department", "category", "user"].includes(governanceEditing?.type) &&
    !isSystemAdmin()
  ) {
    throw new Error("Supervisor ไม่มีสิทธิ์เพิ่มหรือแก้ไขข้อมูลส่วนนี้");
  }
  const fd = new FormData($("#governanceForm"));
  const v = Object.fromEntries(fd.entries());
  const { type, data } = governanceEditing;
  let path,
    method = "POST",
    payload;
  if (type === "category") {
    if (!v.departmentId) throw new Error("กรุณาเลือกหน่วยงานรับผิดชอบ");
    path = data
      ? `/api/admin/governance/categories/${data.id}`
      : "/api/admin/governance/categories";
    if (data) method = "PATCH";
    payload = {
      code: v.code.trim().toUpperCase(),
      nameTh: v.nameTh,
      departmentId: v.departmentId,
      slaHours: Number(v.slaHours),
      ...(data ? { isActive: v.isActive === "true" } : {}),
    };
  }
  if (type === "department") {
    path = data
      ? `/api/admin/governance/departments/${data.id}`
      : "/api/admin/governance/departments";
    if (data) method = "PATCH";
    payload = {
      code: v.code.trim().toUpperCase(),
      nameTh: v.nameTh,
      ...(data ? { isActive: v.isActive === "true" } : {}),
    };
  }
  if (type === "user") {
    if (["officer", "supervisor"].includes(v.role) && !v.departmentId)
      throw new Error("กรุณาเลือกหน่วยงานสำหรับ Officer หรือ Supervisor");
    path = data
      ? `/api/admin/governance/users/${data.id}`
      : "/api/admin/governance/users";
    if (data) method = "PATCH";
    payload = {
      displayName: v.displayName,
      role: v.role,
      departmentId: ["admin", "dev", "executive"].includes(v.role)
        ? null
        : v.departmentId,
      ...(data
        ? { isActive: v.isActive === "true", password: v.password || null }
        : { username: v.username, password: v.password }),
    };
  }
  if (type === "staffProfile") {
    if (!v.departmentId) throw new Error("กรุณาเลือกหน่วยงาน");
    path = data
      ? `/api/admin/governance/staff-profiles/${data.id}`
      : "/api/admin/governance/staff-profiles";
    if (data) method = "PATCH";
    payload = {
      fullName: v.fullName,
      positionTitle: v.positionTitle,
      departmentId: v.departmentId,
      lineId: v.lineId,
      phone: v.phone,
    };
  }
  await api(path, { method, body: JSON.stringify(payload) });
  $("#governanceDialog").close();
  show("#pageAlert", "บันทึกข้อมูลเรียบร้อย", "success");
  await loadGovernance(governanceMode);
}
let categoryPendingDelete = null;
function openDeleteCategoryConfirmation(category) {
  categoryPendingDelete = category;
  clear("#deleteCategoryAlert");
  $("#deleteCategoryName").textContent = category.name;
  const warning = $("#deleteCategoryUsageWarning");
  warning.textContent =
    category.count > 0
      ? `หมวดหมู่นี้มีเรื่องร้องเรียนใช้งานอยู่ ${category.count} เรื่อง จึงไม่สามารถลบได้ กรุณาปิดใช้งานแทน`
      : "หมวดหมู่นี้ยังไม่มีเรื่องร้องเรียนใช้งานและสามารถลบได้";
  warning.classList.toggle("danger-text", category.count > 0);
  const button = $("#deleteCategoryConfirmButton");
  button.disabled = category.count > 0;
  button.textContent = "ลบหมวดหมู่";
  const dialog = $("#deleteCategoryDialog");
  if (!dialog.open) dialog.showModal();
}
function closeDeleteCategoryConfirmation() {
  const dialog = $("#deleteCategoryDialog");
  if (dialog.open) dialog.close("cancel");
  categoryPendingDelete = null;
  clear("#deleteCategoryAlert");
}
async function deleteCategory() {
  if (!categoryPendingDelete) return;
  const pending = { ...categoryPendingDelete };
  const button = $("#deleteCategoryConfirmButton");
  button.disabled = true;
  button.textContent = "กำลังลบ…";
  clear("#deleteCategoryAlert");
  try {
    await api(`/api/admin/governance/categories/${pending.id}`, {
      method: "DELETE",
    });
    closeDeleteCategoryConfirmation();
    show("#pageAlert", `ลบหมวดหมู่ ${pending.name} เรียบร้อย`, "success");
    await loadGovernance("categories");
  } catch (error) {
    show("#deleteCategoryAlert", error.message);
    button.disabled = false;
    button.textContent = "ลบหมวดหมู่";
  }
}
const categoryDeleteDialogElement = $("#deleteCategoryDialog");
$("#deleteCategoryCancelButton").onclick = closeDeleteCategoryConfirmation;
$("#deleteCategoryConfirmButton").onclick = deleteCategory;
categoryDeleteDialogElement.addEventListener("cancel", (e) => {
  e.preventDefault();
  closeDeleteCategoryConfirmation();
});
categoryDeleteDialogElement.addEventListener("click", (e) => {
  if (isDialogBackdropClick(e, categoryDeleteDialogElement))
    closeDeleteCategoryConfirmation();
});
let userPendingDelete = null;
function openDeleteUserConfirmation(user) {
  userPendingDelete = {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
  };
  clear("#deleteUserAlert");
  $("#deleteUserName").textContent = user.display_name;
  $("#deleteUserUsername").textContent = user.username;
  const button = $("#deleteUserConfirmButton");
  button.disabled = false;
  button.textContent = "ลบผู้ใช้งาน";
  const dialog = $("#deleteUserDialog");
  if (!dialog.open) dialog.showModal();
}
function closeDeleteUserConfirmation() {
  const dialog = $("#deleteUserDialog");
  if (dialog.open) dialog.close("cancel");
  userPendingDelete = null;
  clear("#deleteUserAlert");
}
async function deleteUser() {
  if (!userPendingDelete) return;
  const pending = { ...userPendingDelete };
  const button = $("#deleteUserConfirmButton");
  button.disabled = true;
  button.textContent = "กำลังลบ…";
  clear("#deleteUserAlert");
  try {
    await api(`/api/admin/governance/users/${pending.id}`, {
      method: "DELETE",
    });
    closeDeleteUserConfirmation();
    show("#pageAlert", `ลบผู้ใช้งาน ${pending.username} เรียบร้อย`, "success");
    await loadGovernance("users");
  } catch (error) {
    show("#deleteUserAlert", error.message);
    button.disabled = false;
    button.textContent = "ลบผู้ใช้งาน";
  }
}
const userDeleteDialogElement = $("#deleteUserDialog");
$("#deleteUserCancelButton").onclick = closeDeleteUserConfirmation;
$("#deleteUserConfirmButton").onclick = deleteUser;
userDeleteDialogElement.addEventListener("cancel", (e) => {
  e.preventDefault();
  closeDeleteUserConfirmation();
});
userDeleteDialogElement.addEventListener("click", (e) => {
  if (isDialogBackdropClick(e, userDeleteDialogElement))
    closeDeleteUserConfirmation();
});
let staffProfilePendingDelete = null;
function openDeleteStaffProfileConfirmation(profile) {
  staffProfilePendingDelete = { id: profile.id, fullName: profile.full_name };
  clear("#deleteStaffProfileAlert");
  $("#deleteStaffProfileName").textContent = profile.full_name;
  const button = $("#deleteStaffProfileConfirmButton");
  button.disabled = false;
  button.textContent = "ลบข้อมูลเจ้าหน้าที่";
  const dialog = $("#deleteStaffProfileDialog");
  if (!dialog.open) dialog.showModal();
}
function closeDeleteStaffProfileConfirmation() {
  const dialog = $("#deleteStaffProfileDialog");
  if (dialog.open) dialog.close("cancel");
  staffProfilePendingDelete = null;
  clear("#deleteStaffProfileAlert");
}
async function deleteStaffProfile() {
  if (!staffProfilePendingDelete) return;
  const pending = { ...staffProfilePendingDelete };
  const button = $("#deleteStaffProfileConfirmButton");
  button.disabled = true;
  button.textContent = "กำลังลบ…";
  clear("#deleteStaffProfileAlert");
  try {
    await api(`/api/admin/governance/staff-profiles/${pending.id}`, {
      method: "DELETE",
    });
    closeDeleteStaffProfileConfirmation();
    show(
      "#pageAlert",
      `ลบข้อมูลเจ้าหน้าที่ ${pending.fullName} เรียบร้อย`,
      "success",
    );
    await loadGovernance("staffProfiles");
  } catch (error) {
    show("#deleteStaffProfileAlert", error.message);
    button.disabled = false;
    button.textContent = "ลบข้อมูลเจ้าหน้าที่";
  }
}
const staffProfileDeleteDialogElement = $("#deleteStaffProfileDialog");
$("#deleteStaffProfileCancelButton").onclick =
  closeDeleteStaffProfileConfirmation;
$("#deleteStaffProfileConfirmButton").onclick = deleteStaffProfile;
staffProfileDeleteDialogElement.addEventListener("cancel", (e) => {
  e.preventDefault();
  closeDeleteStaffProfileConfirmation();
});
staffProfileDeleteDialogElement.addEventListener("click", (e) => {
  if (isDialogBackdropClick(e, staffProfileDeleteDialogElement))
    closeDeleteStaffProfileConfirmation();
});
async function exportCsv() {
  const params = addExecutiveDepartmentScope(new URLSearchParams());
  const path = `/api/admin/reports/export.csv${params.size ? `?${params}` : ""}`;
  const r = await fetch(path, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error("ไม่สามารถส่งออกรายงานได้");
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `complaints-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function closeGovernanceDialog() {
  const dialog = $("#governanceDialog");
  if (dialog?.open) dialog.close("cancel");
  governanceEditing = null;
  $("#governanceForm")?.reset();
  $("#governanceDialogFields").innerHTML = "";
}

$("#addStaffProfileButton").onclick = () => {
  if (currentUser?.role === "dev") openGovernanceDialog("staffProfile");
};
const lockedGovernanceDialog = $("#governanceDialog");
lockedGovernanceDialog.addEventListener(
  "cancel",
  (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true,
);
lockedGovernanceDialog.addEventListener(
  "click",
  (event) => {
    if (!isDialogBackdropClick(event, lockedGovernanceDialog)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true,
);
$("#printComplaintListButton").onclick = printComplaintList;
$("#printComplaintDetailButton").onclick = printComplaintDetail;
$("#complaintCategoryFilter").onchange = () => loadComplaints(1);
window.addEventListener("afterprint", clearPrintMode);
$("#loginForm").onsubmit = async (e) => {
  e.preventDefault();
  clear("#adminAlert");
  try {
    const r = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("#username").value,
        password: $("#password").value,
      }),
    });
    token = r.data.token;
    sessionStorage.setItem("adminToken", token);
    appView(r.data.user);
    await boot();
  } catch (err) {
    show("#adminAlert", err.message);
  }
};
const adminImageViewer = $("#adminImageViewer");
$("#adminImageViewerClose").onclick = () => adminImageViewer.close();
adminImageViewer.addEventListener("click", (event) => {
  if (isDialogBackdropClick(event, adminImageViewer)) adminImageViewer.close();
});
adminImageViewer.addEventListener("close", () =>
  $("#adminImageViewerImage").removeAttribute("src"),
);
const logoutConfirmDialog = $("#logoutConfirmDialog");
const deleteComplaintDialog = $("#deleteComplaintDialog");
$("#logoutButton").onclick = openLogoutConfirmation;
$("#mobileLogoutButton").onclick = openLogoutConfirmation;
$("#logoutCancelButton").onclick = closeLogoutConfirmation;
$("#logoutConfirmButton").onclick = confirmLogout;
logoutConfirmDialog.addEventListener("cancel", (e) => {
  e.preventDefault();
  closeLogoutConfirmation();
});
logoutConfirmDialog.addEventListener("click", (e) => {
  if (isDialogBackdropClick(e, logoutConfirmDialog)) closeLogoutConfirmation();
});
$("#deleteComplaintCancelButton").onclick = closeDeleteComplaintConfirmation;
$("#deleteComplaintConfirmButton").onclick = deleteComplaint;
deleteComplaintDialog.addEventListener("cancel", (e) => {
  e.preventDefault();
  closeDeleteComplaintConfirmation();
});
deleteComplaintDialog.addEventListener("click", (e) => {
  if (isDialogBackdropClick(e, deleteComplaintDialog))
    closeDeleteComplaintConfirmation();
});
$("#closeDrawer").onclick = closeDetailDrawer;
$("#detailDrawerBackdrop").onclick = closeDetailDrawer;
$("#governanceCancelButton").onclick = closeGovernanceDialog;
$("#governanceCloseButton").onclick = closeGovernanceDialog;
$("#governanceDialog").addEventListener("cancel", (e) => {
  e.preventDefault();
  closeGovernanceDialog();
});
$("#governanceDialog").addEventListener("click", (e) => {
  if (isDialogBackdropClick(e, $("#governanceDialog"))) closeGovernanceDialog();
});
$("#searchButton").onclick = () => loadComplaints(1);
$("#statusFilter").onchange = () => loadComplaints(1);
$("#complaintMonthFilter").onchange = () => loadComplaints(1);
$("#complaintPageSize").onchange = () => loadComplaints(1);
$("#searchInput").onkeydown = (e) => {
  if (e.key === "Enter") loadComplaints(1);
};
$("#refreshAll").onclick = async () => {
  try {
    await refreshScopedData();
  } catch (err) {
    show("#pageAlert", err.message);
  }
};
$("#executiveDepartmentFilter").onchange = async (e) => {
  executiveDepartmentId = e.target.value;
  try {
    await refreshScopedData();
  } catch (err) {
    show("#pageAlert", err.message);
  }
};
$("#staffProfileDepartmentFilter").onchange = async (event) => {
  staffProfileDepartmentId = event.target.value;
  await loadGovernance("staffProfiles");
};
document
  .querySelectorAll(".v3-nav-item")
  .forEach((b) => (b.onclick = () => switchView(b.dataset.view)));
document
  .querySelectorAll("[data-go]")
  .forEach((b) => (b.onclick = () => switchView(b.dataset.go)));
document
  .querySelectorAll(".governance-tab")
  .forEach((b) => (b.onclick = () => loadGovernance(b.dataset.governance)));
$("#addCategoryButton").onclick = () => {
  if (isSystemAdmin()) openGovernanceDialog("category");
};
$("#addDepartmentButton").onclick = () => {
  if (isSystemAdmin()) openGovernanceDialog("department");
};
$("#addUserButton").onclick = () => {
  if (isSystemAdmin()) openGovernanceDialog("user");
};
$("#refreshAuditButton").onclick = () => loadGovernance("audit");
$("#governanceForm").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await saveGovernance();
  } catch (err) {
    show("#pageAlert", err.message);
  }
};
$("#exportCsvButton").onclick = async () => {
  try {
    await exportCsv();
  } catch (err) {
    show("#pageAlert", err.message);
  }
};
loadMe();
