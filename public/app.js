/**
 * Noctua 🦉: Lógica del Cliente Frontend (SPA)
 *
 * Administra las vistas (Calendario, Lista, Entregas, Notas, Registro, Acerca de),
 * la franja de progreso rápido superior (Progress Strip) filtrada por semestres en curso,
 * ciclo de vida de actividades (Planeada -> Entregada esperando nota -> Calificada / Examen inmediato),
 * generación de reportes en Excel (.csv UTF-8) y PDF oficial imprimible,
 * protección de cambios no guardados con alerta beforeunload,
 * modales de entrega y calificación en vivo, sincronización con SQLite
 * e importación / exportación inteligente con Drag & Drop.
 */

// Estado global de la aplicación
const state = {
  settings: { university_name: 'Noctua' },
  periods: [],
  categories: [],
  subjects: [],
  events: [],
  unifiedCalendar: [],
  currentView: 'cal',
  currentSubjectFilter: 'all',
  showArchivedInViews: false,
  hasUnsavedChanges: false,
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth(),
  selectedActivityId: null,
  selectedSubjectId: null,
  selectedEventId: null
};

let _importPayload = null;

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const DOW_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/**
 * Sanitiza texto para evitar inyecciones XSS en el DOM.
 * @param {*} value - Valor a sanitizar.
 * @returns {string}
 */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Convierte un valor a numero de forma segura o retorna un valor por defecto.
 * @param {*} val - Valor a parsear.
 * @param {number} defaultVal - Valor de respaldo si es NaN.
 * @returns {number}
 */
function asNumber(val, defaultVal = 0) {
  const n = Number(val);
  return isNaN(n) ? defaultVal : n;
}

/**
 * Muestra una notificación Toast animada y accesible.
 * @param {string} message - Mensaje a mostrar.
 * @param {string} type - 'success' | 'error' | 'warning' | 'info'
 */
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

/**
 * Actualiza el indicador visual de guardado y cambios pendientes.
 * @param {boolean} hasPending - True si hay modificaciones sin guardar.
 */
function setUnsavedChanges(hasPending) {
  state.hasUnsavedChanges = hasPending;
  const btn = document.getElementById('save-status-btn');
  const icon = document.getElementById('save-status-icon');
  const txt = document.getElementById('save-status-txt');

  if (!btn || !icon || !txt) return;

  if (hasPending) {
    btn.className = 'save-status-btn pending';
    icon.textContent = '💾';
    txt.textContent = 'Guardar cambios';
    btn.title = 'Tienes modificaciones pendientes sin guardar. Haz clic para guardar.';
  } else {
    btn.className = 'save-status-btn synced';
    icon.textContent = '✔';
    txt.textContent = 'Guardado';
    btn.title = 'Todo sincronizado y guardado en SQLite.';
  }
}

/**
 * Solicita confirmación accesible antes de ejecutar una acción destructiva.
 * @param {string} message - Mensaje de confirmación.
 * @param {string} title - Título del diálogo.
 * @returns {Promise<boolean>}
 */
function confirmAction(message, title = 'Confirmar acción') {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-modal-title');
    const messageEl = document.getElementById('confirm-modal-message');
    const okBtn = document.getElementById('confirm-modal-ok');
    const cancelBtn = document.getElementById('confirm-modal-cancel');

    if (!modal) {
      resolve(window.confirm(message));
      return;
    }

    titleEl.textContent = title;
    messageEl.textContent = message;

    const cleanup = () => {
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('close', onCancel);
    };

    const onOk = () => {
      cleanup();
      modal.close();
      resolve(true);
    };

    const onCancel = () => {
      cleanup();
      modal.close();
      resolve(false);
    };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    modal.addEventListener('close', onCancel);

    modal.showModal();
  });
}

/**
 * Determina el nivel de urgencia temporal de una fecha.
 * @param {string} dateStr - Fecha ISO (YYYY-MM-DD).
 * @returns {'x' | 'r' | 'y' | 'g'}
 */
function getUrgencyLevel(dateStr) {
  if (!dateStr) return 'g';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const diffDays = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'x'; // Ya vencida
  if (diffDays <= 3) return 'r'; // Crítica (≤ 3 días)
  if (diffDays <= 7) return 'y'; // Próxima (≤ 7 días)
  return 'g'; // Con tiempo (> 7 días)
}

/**
 * Retorna las clases y colores para un valor de calificación según escala 0-5.0.
 * @param {number} grade5 - Nota en escala 0.0 a 5.0.
 * @returns {object}
 */
function getGradeColors(grade5) {
  if (grade5 >= 4.0) return { cls: 'gc-grn', hex: '#22C55E', badgeCls: 'nb-grn', passCls: 'ok', text: 'Excelente / Aprobado' };
  if (grade5 >= 3.0) return { cls: 'gc-blu', hex: '#3B82F6', badgeCls: 'nb-blu', passCls: 'ok', text: 'Aprobando' };
  if (grade5 >= 2.0) return { cls: 'gc-yel', hex: '#EAB308', badgeCls: 'nb-yel', passCls: 'warn', text: 'En riesgo' };
  return { cls: 'gc-red', hex: '#EF4444', badgeCls: 'nb-red', passCls: 'bad', text: 'Reprobando' };
}

/**
 * Petición REST centralizada a la API con manejo de errores JSON.
 * @param {string} endpoint - Ruta relativa de la API.
 * @param {object} options - Parámetros de fetch.
 * @returns {Promise<any>}
 */
async function apiRequest(endpoint, options = {}) {
  const response = await fetch(endpoint, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const errorMessage = typeof data === 'object' && data.error ? data.error : 'Ocurrió un error en la solicitud.';
    throw new Error(errorMessage);
  }

  return data;
}

// ─────────────────────────────────────────────────────────────
// GESTIÓN DEL TEMA VISUAL (MODO OSCURO / CLARO)
// ─────────────────────────────────────────────────────────────

function setupTheme() {
  const toggleBtn = document.getElementById('theme-toggle');
  const iconEl = document.getElementById('theme-icon');
  const savedTheme = localStorage.getItem('noctua_theme') || 'dark';

  const applyTheme = (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('noctua_theme', theme);
    if (iconEl) iconEl.textContent = theme === 'dark' ? '🦉' : '☀️';
  };

  applyTheme(savedTheme);

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      showToast(`Modo ${next === 'dark' ? 'Noctua Oscuro' : 'Claro'} activado.`, 'info');
    });
  }
}

// ─────────────────────────────────────────────────────────────
// CARGA INICIAL DE DATOS
// ─────────────────────────────────────────────────────────────

async function loadAllData() {
  try {
    const [settings, periods, categories, subjects, events, unified] = await Promise.all([
      apiRequest('/api/settings').catch(() => ({ university_name: 'Academic' })),
      apiRequest('/api/periods').catch(() => []),
      apiRequest('/api/categories').catch(() => []),
      apiRequest('/api/subjects').catch(() => []),
      apiRequest('/api/events').catch(() => []),
      apiRequest('/api/calendar/unified').catch(() => [])
    ]);

    state.settings = settings;
    state.periods = periods;
    state.categories = categories;
    state.subjects = subjects;
    state.events = events;
    state.unifiedCalendar = unified;

    const brandUni = document.getElementById('brand-uni-name');
    if (brandUni && settings.university_name) {
      brandUni.textContent = settings.university_name;
    }

    setUnsavedChanges(false);
    refreshUI();
  } catch (err) {
    console.error('Error al cargar datos:', err);
    showToast('No se pudieron sincronizar todos los datos.', 'error');
  }
}

function refreshUI() {
  renderProgressStrip();
  buildFilterBar();
  renderCurrentView();
}

function setView(viewName) {
  state.currentView = viewName;
  const navBtns = {
    cal: document.getElementById('bCal'),
    list: document.getElementById('bList'),
    ent: document.getElementById('bEnt'),
    not: document.getElementById('bNot'),
    reg: document.getElementById('bReg'),
    acerca: document.getElementById('bAcerca')
  };

  const panels = {
    cal: document.getElementById('calV'),
    list: document.getElementById('listV'),
    ent: document.getElementById('entV'),
    not: document.getElementById('notV'),
    reg: document.getElementById('regV'),
    acerca: document.getElementById('acercaV')
  };

  Object.keys(navBtns).forEach((key) => {
    if (navBtns[key]) navBtns[key].classList.toggle('on', key === viewName);
  });

  Object.keys(panels).forEach((key) => {
    if (panels[key]) panels[key].classList.toggle('hidden', key !== viewName);
  });

  buildFilterBar();
  renderCurrentView();
}

function renderCurrentView() {
  if (state.currentView === 'cal') renderCalendarView();
  else if (state.currentView === 'list') renderListView();
  else if (state.currentView === 'ent') renderEntregasView();
  else if (state.currentView === 'not') renderNotasView();
  else if (state.currentView === 'reg') renderRegistrationView();
}

// ─────────────────────────────────────────────────────────────
// 1. FRANJA DE PROGRESO RÁPIDO (PROGRESS STRIP)
// Muestra únicamente las asignaturas que se están cursando (periodo activo)
// ─────────────────────────────────────────────────────────────

function renderProgressStrip() {
  const strip = document.getElementById('ps');
  if (!strip) return;
  strip.innerHTML = '';

  const activeSubjects = state.subjects.filter((s) => s.period_is_active !== 0 && !s.is_archived);

  if (!activeSubjects.length) {
    strip.innerHTML = '<div style="font-size:0.75rem;color:var(--mu);padding:4px 0;">✨ Sin asignaturas en curso actualmente. Activa un periodo o regístralas en "Registro".</div>';
    return;
  }

  activeSubjects.forEach((sub) => {
    const totalActs = sub.activities ? sub.activities.length : 0;
    const doneActs = sub.activities ? sub.activities.filter((a) => a.completed_date || a.submitted_at || a.status === 'aprobado' || a.status === 'presentado' || (a.grade_obtained !== null && a.grade_obtained !== '')).length : 0;
    const pctProgress = Math.round(sub.progress_percent || 0);
    const grade5 = (sub.grade_5_scale || 0);
    const colors = getGradeColors(grade5);
    const hasGrades = sub.activities && sub.activities.some((a) => a.grade_obtained !== null && a.grade_obtained !== '');

    const item = document.createElement('div');
    item.className = 'progress-item';
    item.style.cursor = 'pointer';
    item.onclick = () => {
      state.currentSubjectFilter = String(sub.id);
      setView('not');
    };

    item.innerHTML = `
      <div class="progress-header">
        <span style="color:${escapeHtml(sub.color || 'var(--c1)')};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px;" title="${escapeHtml(sub.name)}">
          ${escapeHtml(sub.name)}
        </span>
        ${hasGrades ? `<span class="grade-chip ${colors.cls}">${grade5.toFixed(2)}/5.0</span>` : '<span class="grade-chip gc-mu">En curso</span>'}
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-bar-fill" style="width:${pctProgress}%;background:${escapeHtml(sub.color || 'var(--c1)')}"></div>
      </div>
      <div class="progress-footer">
        <span>${doneActs}/${totalActs} entregadas (${pctProgress}%)</span>
        <span>${sub.weight_total || 100}% pts</span>
      </div>
    `;
    strip.appendChild(item);
  });
}

// ─────────────────────────────────────────────────────────────
// BARRA DE FILTROS POR ASIGNATURA Y PERIODOS
// ─────────────────────────────────────────────────────────────

function buildFilterBar() {
  const bar = document.getElementById('fbar');
  if (!bar) return;

  // En Registro y Acerca de la barra de filtros de asignaturas no aplica
  if (state.currentView === 'reg' || state.currentView === 'acerca') {
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }

  bar.style.display = 'flex';
  bar.innerHTML = '';

  const createChip = (label, value, color) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'filter-chip' + (state.currentSubjectFilter === value ? ' on' : '');
    btn.textContent = label;
    if (state.currentSubjectFilter === value && color) {
      btn.style.color = color;
      btn.style.borderColor = color;
    }
    btn.onclick = () => {
      state.currentSubjectFilter = value;
      refreshUI();
    };
    bar.appendChild(btn);
  };

  createChip('Todas', 'all', null);

  const visibleSubjects = state.showArchivedInViews
    ? state.subjects
    : state.subjects.filter((s) => s.period_is_active !== 0 && !s.is_archived);

  visibleSubjects.forEach((s) => createChip(s.name, String(s.id), s.color));

  if (state.currentView !== 'ent' && state.currentView !== 'not') {
    createChip('📅 Solo Eventos', 'events', 'var(--ce)');
  }

  const hasArchived = state.subjects.some((s) => s.period_is_active === 0 || s.is_archived === 1);
  if (hasArchived) {
    const toggleArchivedBtn = document.createElement('button');
    toggleArchivedBtn.type = 'button';
    toggleArchivedBtn.className = 'filter-chip' + (state.showArchivedInViews ? ' on' : '');
    toggleArchivedBtn.style.marginLeft = 'auto';
    toggleArchivedBtn.textContent = state.showArchivedInViews ? '📂 Ocultar archivadas' : '📦 Ver archivadas';
    toggleArchivedBtn.onclick = () => {
      state.showArchivedInViews = !state.showArchivedInViews;
      refreshUI();
    };
    bar.appendChild(toggleArchivedBtn);
  }
}

// ─────────────────────────────────────────────────────────────
// 2. VISTA DE CALENDARIO ACADÉMICO
// ─────────────────────────────────────────────────────────────

function renderCalendarView() {
  const dowHeader = document.getElementById('dowr');
  const calGrid = document.getElementById('calg');
  const monthTitle = document.getElementById('calendar-month-title');

  if (!dowHeader || !calGrid || !monthTitle) return;

  monthTitle.textContent = `${MONTH_NAMES[state.currentMonth]} ${state.currentYear}`;
  dowHeader.innerHTML = DOW_NAMES.map((d) => `<div class="cal-dow">${d}</div>`).join('');
  calGrid.innerHTML = '';

  const cy = state.currentYear;
  const cm = state.currentMonth;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const firstDayIndex = new Date(cy, cm, 1).getDay();
  const lastDate = new Date(cy, cm + 1, 0).getDate();
  const prevMonthLastDate = new Date(cy, cm, 0).getDate();

  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const cell = document.createElement('div');
    cell.className = 'cal-cell other-month';
    cell.innerHTML = `<div class="cal-day-num">${prevMonthLastDate - i}</div>`;
    calGrid.appendChild(cell);
  }

  let items = state.unifiedCalendar.filter((it) => {
    if (!it.event_date) return false;
    const [iy, im] = it.event_date.split('-').map(Number);
    if (iy !== cy || im - 1 !== cm) return false;

    if (state.currentSubjectFilter === 'events') return it.item_type === 'evento';
    if (state.currentSubjectFilter !== 'all') {
      return String(it.subject_id) === state.currentSubjectFilter;
    }
    return true;
  });

  for (let day = 1; day <= lastDate; day++) {
    const padM = String(cm + 1).padStart(2, '0');
    const padD = String(day).padStart(2, '0');
    const dateStr = `${cy}-${padM}-${padD}`;
    const isToday = new Date(cy, cm, day).getTime() === today.getTime();

    const cell = document.createElement('div');
    cell.className = 'cal-cell' + (isToday ? ' today' : '');

    const dayNumEl = document.createElement('div');
    dayNumEl.className = 'cal-day-num';
    dayNumEl.innerHTML = isToday ? `<span class="today-dot">${day}</span>` : String(day);
    cell.appendChild(dayNumEl);

    const chipsContainer = document.createElement('div');
    chipsContainer.className = 'cal-chips';

    const dayItems = items.filter((x) => x.event_date === dateStr);
    const MAX_VISIBLE = 3;

    dayItems.slice(0, MAX_VISIBLE).forEach((it) => {
      const chip = document.createElement('div');
      const isDelivered = it.item_type === 'actividad' && (it.completed_date || it.submitted_at || it.status === 'aprobado' || it.status === 'presentado');
      const hasGrade = it.item_type === 'actividad' && it.grade_obtained !== null && it.grade_obtained !== '';
      const urgency = getUrgencyLevel(it.event_date);

      chip.className = 'cal-chip' + (isDelivered ? ' done' : '') + (it.item_type === 'evento' ? ' evc' : '');
      if (it.item_type === 'actividad') {
        const subColor = it.category_color || '#3B82F6';
        chip.style.background = `${subColor}22`;
        chip.style.color = subColor;
        chip.style.borderLeft = `3px solid ${subColor}`;
        if (!isDelivered) {
          const dot = document.createElement('span');
          dot.className = `adot ${urgency === 'x' ? 'r' : urgency}`;
          chip.appendChild(dot);
        }
        chip.appendChild(document.createTextNode(it.title + (hasGrade ? ` (⭐ ${it.grade_obtained})` : '')));
        chip.onclick = (e) => {
          e.stopPropagation();
          openActModal(it.id, it.subject_id);
        };
      } else {
        chip.textContent = `📅 ${it.title}`;
        chip.onclick = (e) => {
          e.stopPropagation();
          openEvtDetail(it.id);
        };
      }
      chipsContainer.appendChild(chip);
    });

    if (dayItems.length > MAX_VISIBLE) {
      const more = document.createElement('div');
      more.className = 'more-chip';
      more.textContent = `+${dayItems.length - MAX_VISIBLE} más`;
      more.onclick = () => setView('list');
      chipsContainer.appendChild(more);
    }

    cell.appendChild(chipsContainer);
    calGrid.appendChild(cell);
  }

  const totalCells = firstDayIndex + lastDate;
  const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let i = 1; i <= remaining; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-cell other-month';
    cell.innerHTML = `<div class="cal-day-num">${i}</div>`;
    calGrid.appendChild(cell);
  }
}

function changeMonth(delta) {
  state.currentMonth += delta;
  if (state.currentMonth < 0) {
    state.currentMonth = 11;
    state.currentYear--;
  } else if (state.currentMonth > 11) {
    state.currentMonth = 0;
    state.currentYear++;
  }
  renderCalendarView();
}

function goToToday() {
  const t = new Date();
  state.currentYear = t.getFullYear();
  state.currentMonth = t.getMonth();
  renderCalendarView();
}

// ─────────────────────────────────────────────────────────────
// 3. VISTA DE LISTA CRONOLÓGICA
// ─────────────────────────────────────────────────────────────

function renderListView() {
  const container = document.getElementById('listV');
  if (!container) return;
  container.innerHTML = '';

  let items = [...state.unifiedCalendar];
  if (state.currentSubjectFilter === 'events') {
    items = items.filter((x) => x.item_type === 'evento');
  } else if (state.currentSubjectFilter !== 'all') {
    items = items.filter((x) => String(x.subject_id) === state.currentSubjectFilter);
  }

  if (!items.length) {
    container.innerHTML = '<div style="color:var(--mu);text-align:center;padding:40px;">No hay actividades ni eventos para mostrar con el filtro actual.</div>';
    return;
  }

  const listWrap = document.createElement('div');
  listWrap.className = 'list-view-container';

  let currentMonthKey = '';

  items.forEach((it) => {
    if (it.event_date) {
      const [y, m] = it.event_date.split('-').map(Number);
      const monthKey = `${MONTH_NAMES[m - 1]} ${y}`;
      if (monthKey !== currentMonthKey) {
        currentMonthKey = monthKey;
        const sep = document.createElement('div');
        sep.className = 'list-month-sep';
        sep.textContent = monthKey;
        listWrap.appendChild(sep);
      }
    }

    const row = document.createElement('div');
    const isDelivered = it.item_type === 'actividad' && (it.completed_date || it.submitted_at || it.status === 'aprobado' || it.status === 'presentado');
    const hasGrade = it.item_type === 'actividad' && it.grade_obtained !== null && it.grade_obtained !== '';
    row.className = 'list-item' + (isDelivered ? ' done' : '');

    const color = it.category_color || '#3B82F6';
    const urgency = getUrgencyLevel(it.event_date);

    let statusText = '🟢 Pendiente de entrega';
    if (hasGrade) {
      statusText = '✔ Calificada';
    } else if (isDelivered) {
      statusText = '📨 Entregada (Esperando nota)';
    } else if (urgency === 'r') {
      statusText = '🔴 Cierra pronto';
    } else if (urgency === 'y') {
      statusText = '🟡 Esta semana';
    }

    row.innerHTML = `
      <div class="list-bar" style="background:${escapeHtml(color)}"></div>
      <div class="list-info">
        <div class="list-title" style="${isDelivered ? 'text-decoration:line-through;' : ''}">${escapeHtml(it.title)}</div>
        <div class="list-sub">${escapeHtml(it.category_name || 'General')} ${it.weight ? `· ${it.weight}%` : ''} ${hasGrade ? `· ⭐ Nota: ${it.grade_obtained}/${it.grade_total || 100}` : (isDelivered ? '· ⏳ Esperando calificación' : '')}</div>
      </div>
      <div class="list-date-box">
        <div class="list-date">${escapeHtml(it.event_date || 'Sin fecha')}</div>
        <div class="list-status-txt">${statusText}</div>
      </div>
    `;

    row.onclick = () => {
      if (it.item_type === 'actividad') openActModal(it.id, it.subject_id);
      else openEvtDetail(it.id);
    };

    listWrap.appendChild(row);
  });

  container.appendChild(listWrap);
}

// ─────────────────────────────────────────────────────────────
// 4. VISTA DE ENTREGAS Y EVIDENCIAS (SUBMISSIONS HUB)
// ─────────────────────────────────────────────────────────────

function renderEntregasView() {
  const container = document.getElementById('entV');
  if (!container) return;
  container.innerHTML = '';

  // Barra de herramientas de entregas con botón para registrar nueva entrega
  const toolbar = document.createElement('div');
  toolbar.style.display = 'flex';
  toolbar.style.justifyContent = 'space-between';
  toolbar.style.alignItems = 'center';
  toolbar.style.flexWrap = 'wrap';
  toolbar.style.gap = '8px';
  toolbar.style.marginBottom = '14px';

  toolbar.innerHTML = `
    <div style="font-size:0.88rem;font-weight:700;color:var(--tx);">
      📋 Registro y Control de Entregas / Evidencias
    </div>
    <div style="display:flex;gap:8px;">
      <button type="button" class="btn grn sm" id="btnNewEntregaEntV" onclick="openNewEntregaModal()">
        ＋ Registrar Nueva Entrega
      </button>
    </div>
  `;
  container.appendChild(toolbar);

  let allActivities = [];
  const subjectsToUse = state.showArchivedInViews
    ? state.subjects
    : state.subjects.filter((s) => s.period_is_active !== 0 && !s.is_archived);

  subjectsToUse.forEach((sub) => {
    if (sub.activities) {
      sub.activities.forEach((act) => {
        allActivities.push({ ...act, subject_name: sub.name, subject_color: sub.color || '#3B82F6' });
      });
    }
  });

  if (state.currentSubjectFilter !== 'all') {
    allActivities = allActivities.filter((a) => String(a.subject_id) === state.currentSubjectFilter);
  }

  const deliveredActivities = allActivities.filter((a) => a.submitted_at || a.submission_link || a.completed_date || a.status === 'aprobado' || a.status === 'presentado');

  if (!deliveredActivities.length) {
    const emptyBox = document.createElement('div');
    emptyBox.style.cssText = 'color:var(--mu);text-align:center;padding:50px 20px;';
    emptyBox.innerHTML = `
      📭 No hay evidencias ni entregas registradas aún.<br>
      <small style="font-size:0.8rem;">Haz clic en el botón <strong>"＋ Registrar Nueva Entrega"</strong> arriba o abre cualquier actividad para registrar tu enlace de evidencia, fecha y plataforma.</small>
    `;
    container.appendChild(emptyBox);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'entregas-grid';

  deliveredActivities.forEach((act) => {
    const card = document.createElement('div');
    card.className = 'entrega-card';

    const hasGrade = act.grade_obtained !== null && act.grade_obtained !== '';
    const gradeBadgeText = hasGrade
      ? `⭐ Calificación: ${act.grade_obtained} / ${act.grade_total || 100} pts`
      : '⏳ Entregado · En espera de calificación docente';

    card.innerHTML = `
      <div class="entrega-card-top" style="background:${escapeHtml(act.subject_color)}"></div>
      <div class="entrega-card-body">
        <div class="ec-title">${escapeHtml(act.title)}</div>
        <div class="ec-sub">${escapeHtml(act.subject_name)} · ${escapeHtml(act.activity_type || 'Tarea')} · ${act.weight || 0}%</div>
        ${act.submitted_at || act.completed_date ? `<div class="ec-row"><span class="ec-icon">📅</span><span class="ec-val">Enviado: ${escapeHtml(act.submitted_at || act.completed_date)}</span></div>` : ''}
        ${act.platform ? `<div class="ec-row"><span class="ec-icon">🖥</span><span class="ec-val">Plataforma: ${escapeHtml(act.platform)}</span></div>` : ''}
        ${act.submission_link ? `<div class="ec-row"><span class="ec-icon">🔗</span><span class="ec-val"><a href="${escapeHtml(act.submission_link)}" target="_blank" rel="noopener noreferrer">Abrir evidencia adjunta</a></span></div>` : ''}
        ${act.feedback_notes ? `<div class="ec-row"><span class="ec-icon">📝</span><span class="ec-val">${escapeHtml(act.feedback_notes)}</span></div>` : ''}
        <div class="ec-grade-badge" style="background:${escapeHtml(act.subject_color)}22;color:${escapeHtml(act.subject_color)};">
          ${escapeHtml(gradeBadgeText)}
        </div>
        <div class="ec-actions">
          <button type="button" class="btn sm" onclick="openActModal(${act.id}, ${act.subject_id})">Ver actividad</button>
          <button type="button" class="btn grn sm" onclick="openActModal(${act.id}, ${act.subject_id}); setTimeout(() => openEntModal(true), 150);">✏ Editar entrega</button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });

  container.appendChild(grid);
}

// ─────────────────────────────────────────────────────────────
// 5. VISTA DE NOTAS Y TABLAS INTERACTIVAS (INLINE EDIT)
// ─────────────────────────────────────────────────────────────

function renderNotasView() {
  const container = document.getElementById('notV');
  if (!container) return;
  container.innerHTML = '';

  let filteredSubjects = state.showArchivedInViews
    ? state.subjects
    : state.subjects.filter((s) => s.period_is_active !== 0 && !s.is_archived);

  if (state.currentSubjectFilter !== 'all') {
    filteredSubjects = state.subjects.filter((s) => String(s.id) === state.currentSubjectFilter);
  }

  // Barra de herramientas para exportar reportes de calificaciones
  const toolbar = document.createElement('div');
  toolbar.style.display = 'flex';
  toolbar.style.justifyContent = 'space-between';
  toolbar.style.alignItems = 'center';
  toolbar.style.flexWrap = 'wrap';
  toolbar.style.gap = '8px';
  toolbar.style.marginBottom = '14px';

  toolbar.innerHTML = `
    <div style="font-size:0.88rem;font-weight:700;color:var(--tx);">
      📊 Calificaciones y Simulación Académica
    </div>
    <div style="display:flex;gap:8px;">
      <button type="button" class="btn sm grn" onclick="exportExcelReport()">📊 Descargar Excel</button>
      <button type="button" class="btn sm" onclick="exportPDFReport()">📄 Imprimir Boletín PDF</button>
    </div>
  `;
  container.appendChild(toolbar);

  if (!filteredSubjects.length) {
    const emptyMsg = document.createElement('div');
    emptyMsg.style.cssText = 'color:var(--mu);text-align:center;padding:40px;';
    emptyMsg.textContent = 'No hay asignaturas activas registradas para calcular notas.';
    container.appendChild(emptyMsg);
    return;
  }

  const sumGrid = document.createElement('div');
  sumGrid.className = 'notas-summary-grid';

  filteredSubjects.forEach((sub) => {
    const grade5 = sub.grade_5_scale || 0;
    const colors = getGradeColors(grade5);
    const hasGrade = sub.activities && sub.activities.some((a) => a.grade_obtained !== null && a.grade_obtained !== '');
    const isArchivedSub = sub.period_is_active === 0 || sub.is_archived === 1;

    const card = document.createElement('div');
    card.className = 'nota-card';
    card.innerHTML = `
      <div class="nota-card-top" style="background:${escapeHtml(sub.color || '#3B82F6')}"></div>
      <div class="nota-card-body">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div class="nc-name">${escapeHtml(sub.name)}</div>
          ${isArchivedSub ? '<span class="nota-badge nb-yel" style="font-size:0.65rem;">Archivada</span>' : ''}
        </div>
        <div class="nc-code">${escapeHtml(sub.code || 'Sin código')} · ${escapeHtml(sub.teacher || 'Sin docente')} · 📅 ${escapeHtml(sub.period_name || 'Sin periodo')}</div>
        <div class="nc-grade-row">
          <span style="font-size:0.75rem;color:var(--mu)">Calificación Acumulada</span>
          ${hasGrade ? `<strong class="nc-grade-big" style="color:${colors.hex}">${grade5.toFixed(2)}<span class="nc-grade-of">/5.0</span></strong>` : '<span style="font-size:0.8rem;color:var(--mu)">Sin notas aún</span>'}
        </div>
        <div class="nc-bar">
          <div class="nc-bar-fill" style="width:${Math.min(100, sub.progress_percent || 0)}%;background:${colors.hex}"></div>
        </div>
        <div class="nc-stats-grid">
          <div class="nc-stat-box"><div class="nc-stat-val">${sub.completed_weight || 0}/${sub.weight_total || 100}%</div><div class="nc-stat-lbl">Peso completado</div></div>
          <div class="nc-stat-box"><div class="nc-stat-val">${(sub.final_grade_value || 0).toFixed(1)}/${sub.total_grade_value || 100}</div><div class="nc-stat-lbl">Puntos totales</div></div>
        </div>
        <div class="nc-passing-badge ${colors.passCls}">
          ${grade5 >= 3.0 ? `✅ Aprobando (${grade5.toFixed(2)}/5.0 ≥ 3.0)` : `⚠️ En riesgo · Faltan ${Math.max(0, 3.0 * (sub.weight_total || 100) / 5 - (sub.completed_weight || 0)).toFixed(1)} pts`}
        </div>
      </div>
    `;
    sumGrid.appendChild(card);
  });
  container.appendChild(sumGrid);

  filteredSubjects.forEach((sub) => {
    const wrap = document.createElement('div');
    wrap.className = 'nota-table-card';

    const grade5 = sub.grade_5_scale || 0;
    const colors = getGradeColors(grade5);

    wrap.innerHTML = `
      <div class="nota-table-header">
        <div style="width:5px;height:24px;border-radius:3px;background:${escapeHtml(sub.color || '#3B82F6')};"></div>
        <h3>${escapeHtml(sub.name)}</h3>
        <span class="nota-badge ${colors.badgeCls}">${grade5.toFixed(2)} / 5.0</span>
      </div>
      <table class="nota-table">
        <thead>
          <tr>
            <th>Actividad</th>
            <th>Tipo</th>
            <th>Peso (%)</th>
            <th style="text-align:center;">Nota Obtenida</th>
            <th style="text-align:center;">Aporte Ponderado</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody id="tbody-sub-${sub.id}"></tbody>
      </table>
    `;

    const tbody = wrap.querySelector(`#tbody-sub-${sub.id}`);
    const acts = sub.activities || [];

    acts.forEach((act) => {
      const tr = document.createElement('tr');
      const hasGrade = act.grade_obtained !== null && act.grade_obtained !== '';
      const isDelivered = !!(act.completed_date || act.submitted_at || act.status === 'aprobado' || act.status === 'presentado');

      if (isDelivered) tr.className = 'done-row';

      const contrib = (hasGrade && (act.grade_total || 100) > 0)
        ? ((act.grade_obtained / (act.grade_total || 100)) * (act.weight || 0))
        : null;

      let statusBadge = '<span style="color:var(--mu);font-size:0.75rem;">🟡 Pendiente de entrega</span>';
      if (hasGrade) {
        statusBadge = '<span style="color:var(--grn);font-size:0.75rem;font-weight:600;">✔ Calificada</span>';
      } else if (isDelivered) {
        statusBadge = '<span style="color:var(--c1);font-size:0.75rem;font-weight:600;">📨 Entregada (Esperando nota)</span>';
      }

      tr.innerHTML = `
        <td style="cursor:pointer;" onclick="openActModal(${act.id}, ${sub.id})">
          <strong>${escapeHtml(act.title)}</strong>
        </td>
        <td style="color:var(--mu);">${escapeHtml(act.activity_type || 'Tarea')}</td>
        <td>${act.weight || 0}%</td>
        <td style="text-align:center;">
          <div class="pts-input-wrap">
            <input type="number" class="pts-input" min="0" max="${act.grade_total || 100}" step="0.1"
              value="${hasGrade ? act.grade_obtained : ''}" placeholder="—"
              data-act-id="${act.id}" data-sub-id="${sub.id}"
              title="Ingresa la nota cuando el docente califique o si es un examen con resultado inmediato"
              oninput="setUnsavedChanges(true)"
              onkeydown="if(event.key==='Enter'){saveInlineGrade(this);this.blur();}"
              onblur="saveInlineGrade(this)">
            <span class="pts-of">/${act.grade_total || 100}</span>
          </div>
        </td>
        <td style="text-align:center;">
          ${contrib !== null ? `<span class="nota-badge nb-blu">+${contrib.toFixed(1)}%</span>` : '<span style="color:var(--mu)">—</span>'}
        </td>
        <td>
          ${statusBadge}
        </td>
      `;
      tbody.appendChild(tr);
    });

    container.appendChild(wrap);
  });
}

async function saveInlineGrade(inputEl) {
  const actId = inputEl.dataset.actId;
  const subId = inputEl.dataset.subId;
  const rawVal = inputEl.value.trim();
  const nextGrade = rawVal === '' ? null : Number(rawVal);

  try {
    await apiRequest(`/api/subjects/${subId}/activities/${actId}`, {
      method: 'PUT',
      body: JSON.stringify({
        grade_obtained: nextGrade,
        status: nextGrade !== null ? 'aprobado' : 'presentado'
      })
    });
    inputEl.style.borderColor = 'var(--grn)';
    setTimeout(() => { inputEl.style.borderColor = 'var(--bd)'; }, 800);
    setUnsavedChanges(false);
    loadAllData();
  } catch (err) {
    inputEl.style.borderColor = 'var(--red)';
    showToast('Error al guardar la calificación: ' + err.message, 'error');
  }
}

// ─────────────────────────────────────────────────────────────
// 6. VISTA DE REGISTRO Y ADMINISTRACIÓN (CON GESTIÓN DE ARCHIVADO)
// ─────────────────────────────────────────────────────────────

function renderRegistrationView() {
  const subPeriodSelect = document.getElementById('subject-period');
  const subPeriodFilter = document.getElementById('subject-period-filter');
  if (subPeriodSelect) {
    subPeriodSelect.innerHTML = '<option value="">— Sin periodo asignado —</option>' +
      state.periods.map((p) => `<option value="${p.id}">${escapeHtml(p.name)} ${p.is_active === 0 ? '(Archivado)' : ''}</option>`).join('');
  }
  if (subPeriodFilter) {
    const currentVal = subPeriodFilter.value;
    subPeriodFilter.innerHTML = '<option value="all">Todos los periodos</option>' +
      state.periods.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    if (currentVal) subPeriodFilter.value = currentVal;
  }

  const actSubSelect = document.getElementById('activity-subject');
  const actSubFilter = document.getElementById('activity-subject-filter');
  if (actSubSelect) {
    const prevActSub = actSubSelect.value;
    actSubSelect.innerHTML = state.subjects.map((s) => `<option value="${s.id}">${escapeHtml(s.name)} (Escala: ${s.total_grade_value || 100} pts)</option>`).join('');
    if (prevActSub && state.subjects.some((s) => String(s.id) === String(prevActSub))) {
      actSubSelect.value = prevActSub;
    }
  }
  if (actSubFilter) {
    const currentVal = actSubFilter.value;
    actSubFilter.innerHTML = '<option value="all">Todas las asignaturas</option>' +
      state.subjects.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
    if (currentVal) actSubFilter.value = currentVal;
  }

  const summaryBox = document.getElementById('registration-summary');
  if (summaryBox) {
    const totalActs = state.subjects.reduce((sum, s) => sum + (s.activities ? s.activities.length : 0), 0);
    const activeSubs = state.subjects.filter((s) => s.period_is_active !== 0 && !s.is_archived).length;
    summaryBox.innerHTML = `
      <div class="summary-card"><strong>${activeSubs} / ${state.subjects.length}</strong><span>Materias en curso</span></div>
      <div class="summary-card"><strong>${totalActs}</strong><span>Actividades</span></div>
      <div class="summary-card"><strong>${state.periods.length}</strong><span>Periodos</span></div>
      <div class="summary-card"><strong>${state.events.length}</strong><span>Eventos</span></div>
    `;
  }

  const periodList = document.getElementById('period-list');
  if (periodList) {
    if (!state.periods.length) {
      periodList.innerHTML = '<div style="color:var(--mu);font-size:0.8rem;padding:8px 0;">No hay periodos registrados aún.</div>';
    } else {
      periodList.innerHTML = state.periods.map((p) => {
        const isActive = p.is_active !== 0;
        return `
          <div class="subject-item-card" style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="display:flex;align-items:center;gap:8px;">
                <strong>${escapeHtml(p.name)}</strong>
                <span class="filter-chip on" style="font-size:0.65rem;color:${isActive ? 'var(--grn)' : 'var(--yel)'};">
                  ${isActive ? '🟢 En curso' : '📦 Archivado'}
                </span>
              </div>
              <div style="font-size:0.72rem;color:var(--mu);">${escapeHtml(p.start_date || 'Sin inicio')} a ${escapeHtml(p.end_date || 'Sin fin')}</div>
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
              <button type="button" class="btn sm ghost" onclick="editPeriod(${p.id})" title="Editar datos del periodo">✏ Editar</button>
              <button type="button" class="btn sm ${isActive ? 'yel' : 'grn'}" onclick="togglePeriodActive(${p.id})">
                ${isActive ? '📦 Archivar' : '🟢 Activar'}
              </button>
              <button type="button" class="btn sm red" onclick="deletePeriod(${p.id})">🗑</button>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  const subList = document.getElementById('subjects-list');
  if (subList) {
    const searchVal = (document.getElementById('subject-search-input')?.value || '').toLowerCase().trim();
    const periodFilter = document.getElementById('subject-period-filter')?.value || 'all';

    let filtered = state.subjects.filter((s) => {
      if (periodFilter !== 'all' && String(s.period_id) !== periodFilter) return false;
      if (searchVal) {
        const matchName = (s.name || '').toLowerCase().includes(searchVal);
        const matchCode = (s.code || '').toLowerCase().includes(searchVal);
        const matchTeacher = (s.teacher || '').toLowerCase().includes(searchVal);
        return matchName || matchCode || matchTeacher;
      }
      return true;
    });

    if (!filtered.length) {
      subList.innerHTML = '<div style="color:var(--mu);font-size:0.8rem;padding:8px 0;">No hay asignaturas que coincidan con los criterios.</div>';
    } else {
      subList.innerHTML = filtered.map((s) => {
        const isArchived = s.period_is_active === 0 || s.is_archived === 1;
        const passVal = s.passing_grade_value !== undefined ? s.passing_grade_value : (asNumber(s.total_grade_value, 100) * 0.6);
        return `
          <div class="subject-item-card">
            <div style="display:flex;align-items:center;gap:8px;">
              <div style="width:12px;height:12px;border-radius:50%;background:${escapeHtml(s.color || '#3B82F6')};"></div>
              <div>
                <div style="display:flex;align-items:center;gap:6px;">
                  <strong>${escapeHtml(s.name)}</strong>
                  <span style="font-size:0.75rem;color:var(--mu);">${escapeHtml(s.code || 'S/C')}</span>
                  ${isArchived ? '<span class="filter-chip on" style="font-size:0.65rem;color:var(--yel);">📦 Archivado</span>' : ''}
                </div>
                <div style="font-size:0.72rem;color:var(--mu);">
                  ${escapeHtml(s.teacher || 'Docente no asignado')} · Periodo: ${escapeHtml(s.period_name || 'Sin periodo')} · Escala: ${s.total_grade_value || 100} pts · <span style="color:var(--tx);font-weight:600;">Aprueba con: ${passVal} pts (${((passVal / (s.total_grade_value || 100)) * 100).toFixed(0)}%)</span>
                </div>
              </div>
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
              <button type="button" class="btn sm ghost" onclick="editSubject(${s.id})" title="Editar datos de la asignatura y docente">✏ Editar</button>
              <button type="button" class="btn sm ${s.is_archived === 1 ? 'grn' : 'yel'}" onclick="toggleSubjectArchive(${s.id})" title="${s.is_archived === 1 ? 'Desarchivar' : 'Archivar individualmente'}">
                ${s.is_archived === 1 ? '🟢 Desarchivar' : '📦'}
              </button>
              <button type="button" class="btn sm red" onclick="deleteSubject(${s.id})">🗑</button>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  const actList = document.getElementById('activities-list');
  if (actList) {
    const actSearch = (document.getElementById('activity-search-input')?.value || '').toLowerCase().trim();
    const actSubFil = document.getElementById('activity-subject-filter')?.value || 'all';

    let allActs = [];
    state.subjects.forEach((s) => {
      (s.activities || []).forEach((a) => {
        allActs.push({ ...a, subject_name: s.name, subject_color: s.color || '#3B82F6', subject_total: s.total_grade_value || 100 });
      });
    });

    let filteredActs = allActs.filter((a) => {
      if (actSubFil !== 'all' && String(a.subject_id) !== actSubFil) return false;
      if (actSearch) {
        const matchTitle = (a.title || '').toLowerCase().includes(actSearch);
        const matchSub = (a.subject_name || '').toLowerCase().includes(actSearch);
        return matchTitle || matchSub;
      }
      return true;
    });

    if (!filteredActs.length) {
      actList.innerHTML = '<div style="color:var(--mu);font-size:0.8rem;padding:8px 0;">No hay actividades registradas con los filtros seleccionados.</div>';
    } else {
      actList.innerHTML = filteredActs.map((a) => {
        const hasGrade = a.grade_obtained !== null && a.grade_obtained !== '';
        const isDone = !!(a.completed_date || a.submitted_at || a.status === 'aprobado' || a.status === 'presentado');
        let statusBadge = '<span style="font-size:0.68rem;color:var(--mu);">🟡 Pendiente</span>';
        if (hasGrade) statusBadge = `<span style="font-size:0.68rem;color:var(--grn);font-weight:600;">⭐ Nota: ${a.grade_obtained}/${a.grade_total || 100}</span>`;
        else if (isDone) statusBadge = '<span style="font-size:0.68rem;color:var(--c1);font-weight:600;">📨 Entregada</span>';

        return `
          <div class="subject-item-card">
            <div style="display:flex;align-items:center;gap:8px;">
              <div style="width:10px;height:10px;border-radius:2px;background:${escapeHtml(a.subject_color)};"></div>
              <div>
                <div style="display:flex;align-items:center;gap:6px;">
                  <strong>${escapeHtml(a.title)}</strong>
                  <span class="filter-chip on" style="font-size:0.65rem;">${escapeHtml(a.activity_type || 'Tarea')}</span>
                  ${statusBadge}
                </div>
                <div style="font-size:0.72rem;color:var(--mu);">
                  Materia: <strong>${escapeHtml(a.subject_name)}</strong> · Peso: ${a.weight || 0}% · Puntaje máx: ${a.grade_total || 100} pts · Vence: ${escapeHtml(a.due_date || 'Sin fecha')}
                </div>
              </div>
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
              <button type="button" class="btn sm ghost" onclick="editActivity(${a.id}, ${a.subject_id})" title="Editar actividad, ponderación o fecha">✏ Editar</button>
              <button type="button" class="btn sm red" onclick="deleteActivity(${a.id}, ${a.subject_id})">🗑</button>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}

// ─────────────────────────────────────────────────────────────
// FUNCIONES DE EDICIÓN Y CANCELACIÓN EN REGISTRO
// ─────────────────────────────────────────────────────────────

function editPeriod(periodId) {
  const period = state.periods.find((p) => p.id === Number(periodId));
  if (!period) return;

  document.getElementById('period-id').value = period.id;
  document.getElementById('period-name').value = period.name || '';
  document.getElementById('period-start').value = period.start_date || '';
  document.getElementById('period-end').value = period.end_date || '';

  const titleEl = document.getElementById('period-form-title');
  const btnEl = document.getElementById('period-submit-btn');
  const cancelBtn = document.getElementById('cancel-period-edit');

  if (titleEl) titleEl.textContent = '✏ Editar periodo académico';
  if (btnEl) btnEl.textContent = 'Actualizar periodo';
  if (cancelBtn) cancelBtn.classList.remove('hidden');

  document.getElementById('period-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelPeriodEdit() {
  document.getElementById('period-id').value = '';
  document.getElementById('period-form')?.reset();

  const titleEl = document.getElementById('period-form-title');
  const btnEl = document.getElementById('period-submit-btn');
  const cancelBtn = document.getElementById('cancel-period-edit');

  if (titleEl) titleEl.textContent = 'Nuevo periodo académico';
  if (btnEl) btnEl.textContent = 'Guardar periodo';
  if (cancelBtn) cancelBtn.classList.add('hidden');
}

function editSubject(subjectId) {
  const subject = state.subjects.find((s) => s.id === Number(subjectId));
  if (!subject) return;

  document.getElementById('subject-id').value = subject.id;
  document.getElementById('subject-name').value = subject.name || '';
  document.getElementById('subject-code').value = subject.code || '';
  document.getElementById('subject-teacher').value = subject.teacher || '';
  document.getElementById('subject-period').value = subject.period_id || '';
  document.getElementById('subject-total').value = subject.total_grade_value || 100;
  document.getElementById('subject-passing').value = subject.passing_grade_value !== undefined ? subject.passing_grade_value : ((subject.total_grade_value || 100) * 0.6);
  document.getElementById('subject-color').value = subject.color || '#3B82F6';
  document.getElementById('subject-notes').value = subject.notes || '';

  const titleEl = document.getElementById('subject-form-title');
  const btnEl = document.getElementById('subject-submit-btn');
  const cancelBtn = document.getElementById('cancel-subject-edit');

  if (titleEl) titleEl.textContent = '✏ Editar asignatura y docente';
  if (btnEl) btnEl.textContent = 'Actualizar asignatura';
  if (cancelBtn) cancelBtn.classList.remove('hidden');

  document.getElementById('subject-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelSubjectEdit() {
  document.getElementById('subject-id').value = '';
  document.getElementById('subject-form')?.reset();
  const colorInput = document.getElementById('subject-color');
  if (colorInput) colorInput.value = '#3B82F6';
  const totalInput = document.getElementById('subject-total');
  if (totalInput) totalInput.value = '100';
  const passingInput = document.getElementById('subject-passing');
  if (passingInput) passingInput.value = '60';

  const titleEl = document.getElementById('subject-form-title');
  const btnEl = document.getElementById('subject-submit-btn');
  const cancelBtn = document.getElementById('cancel-subject-edit');

  if (titleEl) titleEl.textContent = 'Nueva asignatura';
  if (btnEl) btnEl.textContent = 'Guardar asignatura';
  if (cancelBtn) cancelBtn.classList.add('hidden');
}

function editActivity(activityId, subjectId) {
  const sub = state.subjects.find((s) => s.id === Number(subjectId));
  const act = sub ? sub.activities.find((a) => a.id === Number(activityId)) : null;
  if (!act) return;

  document.getElementById('activity-id').value = act.id;
  document.getElementById('activity-subject').value = subjectId;
  document.getElementById('activity-title').value = act.title || '';
  document.getElementById('activity-type').value = act.activity_type || 'Tarea';
  document.getElementById('activity-due-date').value = act.due_date || '';
  document.getElementById('activity-weight').value = act.weight || 0;
  document.getElementById('activity-grade-total').value = act.grade_total || 100;
  document.getElementById('activity-grade').value = (act.grade_obtained !== null && act.grade_obtained !== undefined) ? act.grade_obtained : '';

  const titleEl = document.getElementById('activity-form-title');
  const btnEl = document.getElementById('activity-submit-btn');
  const cancelBtn = document.getElementById('cancel-activity-edit');

  if (titleEl) titleEl.textContent = '✏ Editar actividad o evaluación';
  if (btnEl) btnEl.textContent = 'Actualizar actividad';
  if (cancelBtn) cancelBtn.classList.remove('hidden');

  document.getElementById('activity-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelActivityEdit() {
  document.getElementById('activity-id').value = '';
  document.getElementById('activity-form')?.reset();
  const weightInput = document.getElementById('activity-weight');
  if (weightInput) weightInput.value = '20';
  const totalInput = document.getElementById('activity-grade-total');
  if (totalInput) totalInput.value = '100';

  const titleEl = document.getElementById('activity-form-title');
  const btnEl = document.getElementById('activity-submit-btn');
  const cancelBtn = document.getElementById('cancel-activity-edit');

  if (titleEl) titleEl.textContent = 'Nueva actividad o evaluación';
  if (btnEl) btnEl.textContent = 'Guardar actividad';
  if (cancelBtn) cancelBtn.classList.add('hidden');
}

async function deleteActivity(activityId, subjectId) {
  const ok = await confirmAction('¿Eliminar esta actividad evaluativa?', 'Eliminar actividad');
  if (!ok) return;

  try {
    await apiRequest(`/api/subjects/${subjectId}/activities/${activityId}`, { method: 'DELETE' });
    showToast('Actividad eliminada correctamente.', 'success');
    loadAllData();
  } catch (err) {
    showToast('Error al eliminar actividad: ' + err.message, 'error');
  }
}

// ─────────────────────────────────────────────────────────────
// SINCRONIZACIÓN AUTOMÁTICA DE PUNTAJE MÁXIMO Y PESO (%)
// ─────────────────────────────────────────────────────────────

function syncActivityWeightFromGradeTotal() {
  const subSelect = document.getElementById('activity-subject');
  const gradeTotalInput = document.getElementById('activity-grade-total');
  const weightInput = document.getElementById('activity-weight');
  if (!subSelect || !gradeTotalInput || !weightInput) return;

  const subId = Number(subSelect.value);
  const sub = state.subjects.find((s) => s.id === subId);
  const subTotal = sub ? asNumber(sub.total_grade_value, 100) : 100;
  const gradeTotal = parseFloat(gradeTotalInput.value);

  if (!isNaN(gradeTotal) && gradeTotal > 0 && subTotal > 0) {
    const calcWeight = (gradeTotal / subTotal) * 100;
    weightInput.value = Number.isInteger(calcWeight) ? calcWeight : parseFloat(calcWeight.toFixed(2));
  }
}

function syncActivityGradeTotalFromWeight() {
  const subSelect = document.getElementById('activity-subject');
  const gradeTotalInput = document.getElementById('activity-grade-total');
  const weightInput = document.getElementById('activity-weight');
  if (!subSelect || !gradeTotalInput || !weightInput) return;

  const subId = Number(subSelect.value);
  const sub = state.subjects.find((s) => s.id === subId);
  const subTotal = sub ? asNumber(sub.total_grade_value, 100) : 100;
  const weightVal = parseFloat(weightInput.value);

  if (!isNaN(weightVal) && weightVal >= 0 && subTotal > 0) {
    const calcGradeTotal = (weightVal / 100) * subTotal;
    gradeTotalInput.value = Number.isInteger(calcGradeTotal) ? calcGradeTotal : parseFloat(calcGradeTotal.toFixed(2));
  }
}

async function togglePeriodActive(periodId) {
  try {
    const res = await apiRequest(`/api/periods/${periodId}/toggle-status`, { method: 'PATCH' });
    showToast(res.message, 'success');
    loadAllData();
  } catch (err) {
    showToast('Error al cambiar estado del periodo: ' + err.message, 'error');
  }
}

async function toggleSubjectArchive(subjectId) {
  try {
    const res = await apiRequest(`/api/subjects/${subjectId}/toggle-archive`, { method: 'PATCH' });
    showToast(res.message, 'success');
    loadAllData();
  } catch (err) {
    showToast('Error al archivar asignatura: ' + err.message, 'error');
  }
}

// ─────────────────────────────────────────────────────────────
// 7. GENERACIÓN DE REPORTES EN EXCEL Y PDF OFICIAL
// ─────────────────────────────────────────────────────────────

/**
 * Descarga el reporte tabular completo en formato Excel (.csv compatible).
 */
function exportExcelReport() {
  window.location.href = '/api/reports/excel';
  showToast('Generando y descargando reporte en Excel...', 'info');
}

/**
 * Genera el boletín de calificaciones oficial de Noctua y abre el diálogo de impresión / PDF.
 */
function exportPDFReport() {
  const printContainer = document.getElementById('print-report-container');
  if (!printContainer) return;

  const dateNow = new Date().toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
  const uniName = state.settings.university_name || 'Noctua Academic';

  let summaryRows = '';
  let detailSections = '';

  state.subjects.forEach((sub) => {
    const grade5 = (sub.grade_5_scale || 0).toFixed(2);
    const isPassing = (sub.grade_5_scale || 0) >= 3.0;
    const totalActs = sub.activities ? sub.activities.length : 0;
    const doneActs = sub.activities ? sub.activities.filter((a) => a.grade_obtained !== null && a.grade_obtained !== '').length : 0;

    summaryRows += `
      <tr>
        <td><strong>${escapeHtml(sub.name)}</strong> (${escapeHtml(sub.code || 'S/C')})</td>
        <td>${escapeHtml(sub.period_name || 'Sin periodo')}</td>
        <td>${escapeHtml(sub.teacher || 'No asignado')}</td>
        <td>${doneActs} / ${totalActs}</td>
        <td>${sub.completed_weight || 0}% / ${sub.weight_total || 100}%</td>
        <td class="${isPassing ? 'print-grade-pass' : 'print-grade-risk'}">${grade5} / 5.0</td>
        <td>${isPassing ? 'Aprobando' : 'En riesgo'}</td>
      </tr>
    `;

    let actRows = '';
    const acts = sub.activities || [];
    acts.forEach((act) => {
      const maxPts = act.grade_total || 100;
      const hasGrade = act.grade_obtained !== null && act.grade_obtained !== '';
      const actGrade5 = (hasGrade && maxPts > 0) ? ((act.grade_obtained / maxPts) * 5.0).toFixed(2) : '—';
      const contrib = (hasGrade && maxPts > 0) ? (((act.grade_obtained / maxPts) * (act.weight || 0))).toFixed(1) + '%' : '—';

      actRows += `
        <tr>
          <td>${escapeHtml(act.title)}</td>
          <td>${escapeHtml(act.activity_type || 'Tarea')}</td>
          <td>${act.weight || 0}%</td>
          <td>${hasGrade ? `${act.grade_obtained} / ${maxPts}` : 'Pendiente'}</td>
          <td>${actGrade5}</td>
          <td>${contrib}</td>
          <td>${act.submitted_at || act.completed_date || act.due_date || '—'}</td>
        </tr>
      `;
    });

    detailSections += `
      <div style="margin-bottom:18px;page-break-inside:avoid;">
        <h4 style="margin:10px 0 6px;color:#0F172A;font-size:0.95rem;border-left:4px solid #3B82F6;padding-left:8px;">
          ${escapeHtml(sub.name)} (${escapeHtml(sub.code || 'S/C')}) · Docente: ${escapeHtml(sub.teacher || 'No asignado')} · Promedio: ${grade5}/5.0
        </h4>
        <table class="print-detail-table">
          <thead>
            <tr>
              <th>Actividad</th>
              <th>Tipo</th>
              <th>Peso (%)</th>
              <th>Nota</th>
              <th>Escala /5.0</th>
              <th>Aporte</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            ${actRows || '<tr><td colspan="7" style="text-align:center;color:#64748B;">Sin actividades registradas.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  });

  printContainer.innerHTML = `
    <div class="print-header">
      <div>
        <div class="print-title">🦉 Noctua Academic — Boletín de Calificaciones</div>
        <div class="print-meta">Institución: <strong>${escapeHtml(uniName)}</strong> · Fecha de emisión: ${dateNow}</div>
      </div>
      <div style="text-align:right;">
        <span style="font-size:0.8rem;color:#64748B;">Gestión y Control Universitario</span>
      </div>
    </div>

    <h3 style="font-size:1.05rem;margin-bottom:8px;color:#0F172A;">1. Resumen Consolidado de Asignaturas</h3>
    <table class="print-summary-table">
      <thead>
        <tr>
          <th>Asignatura</th>
          <th>Periodo</th>
          <th>Docente</th>
          <th>Evaluadas</th>
          <th>Peso Evaluado</th>
          <th>Nota /5.0</th>
          <th>Estado</th>
        </tr>
      </thead>
      <tbody>
        ${summaryRows || '<tr><td colspan="7" style="text-align:center;color:#64748B;">Sin materias registradas.</td></tr>'}
      </tbody>
    </table>

    <h3 style="font-size:1.05rem;margin:20px 0 8px;color:#0F172A;">2. Desglose Detallado por Actividad Evaluativa</h3>
    ${detailSections}

    <div class="print-footer">
      <span>Generado autónomamente por <strong>Noctua 🦉</strong> con persistencia local en SQLite.</span>
      <span>Página de control estudiantil</span>
    </div>
  `;

  window.print();
}

// ─────────────────────────────────────────────────────────────
// MODAL 1: DETALLE RÁPIDO DE ACTIVIDAD
// ─────────────────────────────────────────────────────────────

function openActModal(activityId, subjectId) {
  state.selectedActivityId = activityId;
  state.selectedSubjectId = subjectId;

  const sub = state.subjects.find((s) => s.id === Number(subjectId));
  const act = sub ? sub.activities.find((a) => a.id === Number(activityId)) : null;

  if (!act) return;

  const hasGrade = act.grade_obtained !== null && act.grade_obtained !== '';
  const isDelivered = !!(act.completed_date || act.submitted_at || act.submission_link || act.status === 'aprobado' || act.status === 'presentado');
  const urgency = getUrgencyLevel(act.due_date);

  document.getElementById('mCol').style.background = sub.color || 'var(--c1)';
  document.getElementById('mNm').textContent = act.title;
  document.getElementById('mSb').textContent = `${sub.name} (${sub.code || 'S/C'}) · ${act.activity_type || 'Tarea'}`;
  document.getElementById('mEn').textContent = act.due_date || 'Sin fecha límite';
  document.getElementById('mWeight').textContent = `${act.weight || 0}% del curso`;

  const bgs = document.getElementById('mBgs');
  bgs.innerHTML = `
    <span class="filter-chip on">${escapeHtml(act.activity_type || 'Tarea')}</span>
    <span class="filter-chip on">${act.weight || 0}%</span>
    <span class="filter-chip on" style="color:var(--${urgency === 'r' ? 'red' : urgency === 'y' ? 'yel' : 'grn'})">
      ${urgency === 'r' ? '🔴 Cierra pronto' : urgency === 'y' ? '🟡 Esta semana' : '🟢 Habilitada'}
    </span>
  `;

  const flowIcon = document.getElementById('mFlowIcon');
  const flowTitle = document.getElementById('mFlowTitle');
  const flowDesc = document.getElementById('mFlowDesc');

  if (hasGrade) {
    flowIcon.textContent = '⭐';
    flowTitle.textContent = `Estado: Calificada (${act.grade_obtained}/${act.grade_total || 100} pts)`;
    flowDesc.textContent = 'La nota ya fue registrada y suma a tu promedio.';
  } else if (isDelivered) {
    flowIcon.textContent = '📨';
    flowTitle.textContent = 'Estado: Entregada (En espera de calificación)';
    flowDesc.textContent = 'Trabajo enviado correctamente. La nota se registrará cuando el profesor publique los resultados.';
  } else {
    flowIcon.textContent = '🟡';
    flowTitle.textContent = 'Estado: Pendiente por realizar / entregar';
    flowDesc.textContent = 'Aún no has registrado evidencia ni examen para esta actividad.';
  }

  updateDoneButtonUI(isDelivered, act.submitted_at || act.completed_date);

  const maxPts = act.grade_total || 100;
  document.getElementById('calMax').textContent = maxPts;
  const calInput = document.getElementById('calInput');
  calInput.max = maxPts;
  calInput.value = hasGrade ? act.grade_obtained : '';
  updateModalGradePreview();

  const sumEl = document.getElementById('entSum');
  const sumBody = document.getElementById('entSumBody');
  if (act.submitted_at || act.submission_link || act.platform || act.feedback_notes) {
    sumEl.style.display = '';
    sumBody.innerHTML = `
      ${act.submitted_at ? `<div><strong>Fecha de envío:</strong> ${escapeHtml(act.submitted_at)}</div>` : ''}
      ${act.platform ? `<div><strong>Plataforma:</strong> ${escapeHtml(act.platform)}</div>` : ''}
      ${act.submission_link ? `<div><strong>Evidencia:</strong> <a href="${escapeHtml(act.submission_link)}" target="_blank" rel="noopener noreferrer">Abrir enlace adjunto</a></div>` : ''}
      ${act.feedback_notes ? `<div><strong>Retroalimentación / Notas:</strong> ${escapeHtml(act.feedback_notes)}</div>` : ''}
    `;
    document.getElementById('btnRegEnt').textContent = '✏ Editar evidencia de entrega';
  } else {
    sumEl.style.display = 'none';
    document.getElementById('btnRegEnt').textContent = '📨 Registrar / Adjuntar evidencia de entrega';
  }

  document.getElementById('actOv').classList.add('op');
}

function updateDoneButtonUI(isDone, completedDate) {
  const b = document.getElementById('doneB');
  const ch = document.getElementById('doneChk');
  const dt = document.getElementById('doneDt');
  const txt = document.getElementById('doneTxtMain');

  b.classList.toggle('ck', isDone);
  ch.classList.toggle('ck', isDone);
  ch.textContent = isDone ? '✓' : '';
  txt.textContent = isDone ? 'Actividad marcada como entregada / realizada' : 'Marcar como realizada / entregada';
  dt.textContent = isDone
    ? `Registrada el ${completedDate || new Date().toISOString().slice(0, 10)} (Haz clic para revertir)`
    : 'Haz clic cuando envíes tu trabajo o presentes tu examen';
}

async function toggleDoneActivity() {
  const subId = state.selectedSubjectId;
  const actId = state.selectedActivityId;
  const sub = state.subjects.find((s) => s.id === Number(subId));
  const act = sub ? sub.activities.find((a) => a.id === Number(actId)) : null;
  if (!act) return;

  const wasDone = !!(act.completed_date || act.submitted_at || act.status === 'aprobado' || act.status === 'presentado');
  const nextCompletedDate = wasDone ? null : new Date().toISOString().slice(0, 10);
  const nextStatus = wasDone ? 'pendiente' : (act.grade_obtained !== null ? 'aprobado' : 'presentado');

  try {
    await apiRequest(`/api/subjects/${subId}/activities/${actId}`, {
      method: 'PUT',
      body: JSON.stringify({
        completed_date: nextCompletedDate,
        submitted_at: wasDone ? null : (act.submitted_at || nextCompletedDate),
        status: nextStatus
      })
    });
    showToast(!wasDone ? 'Actividad marcada como enviada / realizada.' : 'Actividad marcada como pendiente.', 'success');
    openActModal(actId, subId);
    loadAllData();
  } catch (err) {
    showToast('Error al actualizar: ' + err.message, 'error');
  }
}

function updateModalGradePreview() {
  const input = document.getElementById('calInput');
  const fill = document.getElementById('calFill');
  const prev = document.getElementById('calPreview');
  const note = document.getElementById('calNoteTxt');
  const max = Number(document.getElementById('calMax').textContent) || 100;
  const val = input.value.trim() === '' ? NaN : Number(input.value);

  if (isNaN(val) || val < 0) {
    fill.style.width = '0%';
    prev.textContent = 'Sin nota';
    prev.style.color = 'var(--mu)';
    note.textContent = 'En espera de calificación docente o examen virtual.';
    return;
  }

  const pct = Math.min(100, (val / max) * 100);
  const grade5 = (val / max) * 5.0;
  const colors = getGradeColors(grade5);

  fill.style.width = pct + '%';
  fill.style.background = colors.hex;
  prev.textContent = `${grade5.toFixed(2)}/5.0`;
  prev.style.color = colors.hex;
  note.textContent = `${val} de ${max} pts · Equivale a ${grade5.toFixed(2)} en escala /5.0 (${colors.text})`;
}

async function saveModalGrade() {
  const subId = state.selectedSubjectId;
  const actId = state.selectedActivityId;
  const val = document.getElementById('calInput').value.trim();
  const gradeObtained = val === '' ? null : Number(val);

  try {
    await apiRequest(`/api/subjects/${subId}/activities/${actId}`, {
      method: 'PUT',
      body: JSON.stringify({
        grade_obtained: gradeObtained,
        status: gradeObtained !== null ? 'aprobado' : 'presentado'
      })
    });
    setUnsavedChanges(false);
    showToast(gradeObtained !== null ? 'Calificación guardada exitosamente.' : 'Nota eliminada (quedó como pendiente de calificación).', 'success');
    openActModal(actId, subId);
    loadAllData();
  } catch (err) {
    showToast('Error al guardar nota: ' + err.message, 'error');
  }
}

async function removeModalGrade() {
  const subId = state.selectedSubjectId;
  const actId = state.selectedActivityId;
  document.getElementById('calInput').value = '';
  await saveModalGrade();
}

// ─────────────────────────────────────────────────────────────
// MODAL 2: FORMULARIO DE ENTREGA
// ─────────────────────────────────────────────────────────────

function openNewEntregaModal() {
  const selectWrap = document.getElementById('efSelectActWrap');
  const actSelect = document.getElementById('efActSelect');

  let optionsHtml = '<option value="">— Selecciona la actividad a entregar —</option>';
  state.subjects.forEach((s) => {
    const acts = s.activities || [];
    if (acts.length > 0) {
      optionsHtml += `<optgroup label="${escapeHtml(s.name)}">`;
      acts.forEach((a) => {
        const hasGrade = a.grade_obtained !== null && a.grade_obtained !== '';
        const isDone = !!(a.completed_date || a.submitted_at || a.status === 'aprobado' || a.status === 'presentado');
        const statusTxt = hasGrade ? '⭐ Calificada' : (isDone ? '📨 Entregada' : '🟡 Pendiente');
        optionsHtml += `<option value="${s.id}_${a.id}">${escapeHtml(a.title)} (${escapeHtml(a.activity_type || 'Tarea')} - ${a.weight || 0}%) [${statusTxt}]</option>`;
      });
      optionsHtml += `</optgroup>`;
    }
  });

  if (actSelect) {
    actSelect.innerHTML = optionsHtml;
  }
  if (selectWrap) {
    selectWrap.style.display = 'block';
  }

  document.getElementById('entFTit').textContent = 'Registrar nueva entrega';
  document.getElementById('efFecha').value = new Date().toISOString().slice(0, 10);
  document.getElementById('efPlat').value = '';
  document.getElementById('efLink').value = '';
  document.getElementById('efNotas').value = '';

  const chk = document.getElementById('efHasInstantGrade');
  const wrap = document.getElementById('efInstantGradeWrap');
  const valInput = document.getElementById('efInstantGradeVal');
  if (chk) chk.checked = false;
  if (wrap) wrap.style.display = 'none';
  if (valInput) valInput.value = '';

  document.getElementById('entOv').classList.add('op');
}

function openEntModal(isEdit = false) {
  const selectWrap = document.getElementById('efSelectActWrap');
  if (selectWrap) {
    selectWrap.style.display = 'none';
  }

  const sub = state.subjects.find((s) => s.id === Number(state.selectedSubjectId));
  const act = sub ? sub.activities.find((a) => a.id === Number(state.selectedActivityId)) : null;

  document.getElementById('entFTit').textContent = isEdit ? 'Editar evidencia de entrega' : 'Registrar evidencia de entrega';
  document.getElementById('efFecha').value = act?.submitted_at || act?.completed_date || new Date().toISOString().slice(0, 10);
  document.getElementById('efPlat').value = act?.platform || '';
  document.getElementById('efLink').value = act?.submission_link || '';
  document.getElementById('efNotas').value = act?.feedback_notes || '';

  const hasGrade = act?.grade_obtained !== null && act?.grade_obtained !== undefined && act?.grade_obtained !== '';
  const chk = document.getElementById('efHasInstantGrade');
  const wrap = document.getElementById('efInstantGradeWrap');
  const valInput = document.getElementById('efInstantGradeVal');

  if (chk && wrap && valInput) {
    chk.checked = hasGrade;
    wrap.style.display = hasGrade ? 'block' : 'none';
    valInput.value = hasGrade ? act.grade_obtained : '';
  }

  document.getElementById('entOv').classList.add('op');
}

async function saveEntregaModal() {
  const selectWrap = document.getElementById('efSelectActWrap');
  let subId = state.selectedSubjectId;
  let actId = state.selectedActivityId;

  if (selectWrap && selectWrap.style.display !== 'none') {
    const actSelectVal = document.getElementById('efActSelect')?.value;
    if (!actSelectVal) {
      showToast('Por favor selecciona una asignatura y actividad.', 'warning');
      return;
    }
    const [sId, aId] = actSelectVal.split('_').map(Number);
    subId = sId;
    actId = aId;
  }

  if (!subId || !actId) {
    showToast('Actividad no seleccionada.', 'warning');
    return;
  }

  const fecha = document.getElementById('efFecha').value;
  const plat = document.getElementById('efPlat').value.trim();
  const link = document.getElementById('efLink').value.trim();
  const notas = document.getElementById('efNotas').value.trim();

  const isInstant = document.getElementById('efHasInstantGrade')?.checked;
  const instantVal = document.getElementById('efInstantGradeVal')?.value.trim();
  const gradeObtained = (isInstant && instantVal !== '') ? Number(instantVal) : null;

  if (!fecha) {
    showToast('La fecha de entrega es obligatoria.', 'warning');
    return;
  }

  try {
    await apiRequest(`/api/subjects/${subId}/activities/${actId}`, {
      method: 'PUT',
      body: JSON.stringify({
        submitted_at: fecha,
        completed_date: fecha,
        platform: plat,
        submission_link: link,
        feedback_notes: notas,
        grade_obtained: gradeObtained,
        status: gradeObtained !== null ? 'aprobado' : 'presentado'
      })
    });
    document.getElementById('entOv').classList.remove('op');
    setUnsavedChanges(false);
    showToast(gradeObtained !== null ? 'Entrega y calificación registrada.' : 'Evidencia de entrega guardada correctamente.', 'success');
    if (state.selectedActivityId && state.selectedSubjectId) {
      openActModal(actId, subId);
    }
    loadAllData();
  } catch (err) {
    showToast('Error al guardar entrega: ' + err.message, 'error');
  }
}

// ─────────────────────────────────────────────────────────────
// MODAL 3 & 4: EVENTOS GENERALES
// ─────────────────────────────────────────────────────────────

function openEvtModal(eventToEdit = null) {
  document.getElementById('evtFTit').textContent = eventToEdit ? 'Editar evento académico' : 'Agregar evento académico';
  document.getElementById('evtId').value = eventToEdit?.id || '';
  document.getElementById('evtNm').value = eventToEdit?.title || '';
  document.getElementById('evtDt').value = eventToEdit?.event_date || new Date().toISOString().slice(0, 10);
  document.getElementById('evtTm').value = eventToEdit?.event_time || '';
  document.getElementById('evtPl').value = eventToEdit?.location || '';
  document.getElementById('evtLk').value = eventToEdit?.link || '';
  document.getElementById('evtNt').value = eventToEdit?.description || '';

  const catSelect = document.getElementById('evtCategorySelect');
  if (catSelect) {
    catSelect.innerHTML = state.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    if (eventToEdit?.category_id) catSelect.value = eventToEdit.category_id;
  }

  document.getElementById('evtFOv').classList.add('op');
}

async function saveEvtModal() {
  const id = document.getElementById('evtId').value;
  const title = document.getElementById('evtNm').value.trim();
  const date = document.getElementById('evtDt').value;
  const catId = document.getElementById('evtCategorySelect').value;
  const time = document.getElementById('evtTm').value.trim();
  const loc = document.getElementById('evtPl').value.trim();
  const link = document.getElementById('evtLk').value.trim();
  const desc = document.getElementById('evtNt').value.trim();

  if (!title || !date) {
    showToast('El título y la fecha son obligatorios.', 'warning');
    return;
  }

  try {
    if (id) {
      await apiRequest(`/api/events/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ title, event_date: date, category_id: catId, event_time: time, location: loc, link, description: desc })
      });
      showToast('Evento actualizado.', 'success');
    } else {
      await apiRequest('/api/events', {
        method: 'POST',
        body: JSON.stringify({ title, event_date: date, category_id: catId, event_time: time, location: loc, link, description: desc })
      });
      showToast('Evento registrado.', 'success');
    }
    document.getElementById('evtFOv').classList.remove('op');
    setUnsavedChanges(false);
    loadAllData();
  } catch (err) {
    showToast('Error al guardar evento: ' + err.message, 'error');
  }
}

function openEvtDetail(eventId) {
  state.selectedEventId = eventId;
  const ev = state.events.find((x) => x.id === Number(eventId));
  if (!ev) return;

  document.getElementById('edTit').textContent = ev.title;
  document.getElementById('edSb').textContent = `${ev.category_name || 'Evento general'}`;
  document.getElementById('edBgs').innerHTML = `<span class="filter-chip on" style="color:var(--ce)">${escapeHtml(ev.category_name || 'Evento')}</span>`;

  const dts = document.getElementById('edDts');
  dts.innerHTML = `
    <div class="date-box"><div class="date-lbl">Fecha</div><div class="date-val">${escapeHtml(ev.event_date)}</div></div>
    <div class="date-box"><div class="date-lbl">Hora / Lugar</div><div class="date-val">${escapeHtml(ev.event_time || ev.location || '—')}</div></div>
  `;

  const nts = document.getElementById('edNts');
  if (ev.description || ev.link) {
    nts.style.display = '';
    nts.innerHTML = `${escapeHtml(ev.description || '')} ${ev.link ? `<br><a href="${escapeHtml(ev.link)}" target="_blank" rel="noopener noreferrer">Enlace web</a>` : ''}`;
  } else {
    nts.style.display = 'none';
  }

  document.getElementById('evtDOv').classList.add('op');
}

// ─────────────────────────────────────────────────────────────
// MODAL 5: IMPORTAR / EXPORTAR DRAG & DROP
// ─────────────────────────────────────────────────────────────

function openIE() {
  _importPayload = null;
  renderIEExportSummary();
  resetImportPanel();
  document.getElementById('ieOv').classList.add('op');
}

function renderIEExportSummary() {
  const sumEl = document.getElementById('ieExpSum');
  if (!sumEl) return;
  const totalActs = state.subjects.reduce((sum, s) => sum + (s.activities ? s.activities.length : 0), 0);
  sumEl.innerHTML = `
    <div class="ie-stat-card"><span class="ie-stat-n">${state.subjects.length}</span><span>Materias</span></div>
    <div class="ie-stat-card"><span class="ie-stat-n" style="color:var(--grn)">${totalActs}</span><span>Actividades</span></div>
    <div class="ie-stat-card"><span class="ie-stat-n" style="color:var(--c1)">${state.events.length}</span><span>Eventos</span></div>
  `;
}

function resetImportPanel() {
  const dropZone = document.getElementById('ieDropZone');
  if (dropZone) dropZone.classList.remove('drag');
  document.getElementById('ieFileInput').value = '';
  document.getElementById('iePreview').style.display = 'none';
  document.getElementById('ieImportActions').style.display = 'none';
  document.getElementById('ieDropLabel').style.display = '';
}

function exportAll() {
  window.location.href = '/api/export';
  showToast('Descargando respaldo JSON de Noctua...', 'info');
}

function parseImportFile(file) {
  if (!file.name.endsWith('.json')) {
    showToast('Solo se aceptan archivos .json', 'warning');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      _importPayload = parsed;
      showImportPreview(parsed);
    } catch (err) {
      showToast('Archivo JSON corrupto o inválido.', 'error');
    }
  };
  reader.readAsText(file);
}

function showImportPreview(payload) {
  const backupData = payload.data || payload;
  const subs = Array.isArray(backupData.subjects) ? backupData.subjects.length : 0;
  const acts = Array.isArray(backupData.activities) ? backupData.activities.length : 0;
  const evts = Array.isArray(backupData.events) ? backupData.events.length : 0;

  document.getElementById('ieDropLabel').style.display = 'none';
  const preview = document.getElementById('iePreview');
  preview.style.display = '';
  preview.innerHTML = `
    <div style="font-weight:700;margin-bottom:4px;">📄 Archivo listo para restaurar</div>
    <div style="font-size:0.75rem;color:var(--mu);margin-bottom:10px;">Exportado el ${escapeHtml(payload.exported_at || 'desconocido')}</div>
    <div class="ie-stats-grid">
      <div class="ie-stat-card"><span class="ie-stat-n">${subs}</span><span>Materias</span></div>
      <div class="ie-stat-card"><span class="ie-stat-n" style="color:var(--grn)">${acts}</span><span>Actividades</span></div>
      <div class="ie-stat-card"><span class="ie-stat-n" style="color:var(--c1)">${evts}</span><span>Eventos</span></div>
    </div>
  `;
  document.getElementById('ieImportActions').style.display = 'flex';
}

async function doImport(mode) {
  if (!_importPayload) return;

  if (mode === 'replace') {
    const ok = await confirmAction('Esta opción REEMPLAZARÁ toda tu base de datos actual con la del archivo. ¿Deseas continuar?', 'Atención: Reemplazo total');
    if (!ok) return;
  }

  try {
    const res = await apiRequest('/api/import', {
      method: 'POST',
      body: JSON.stringify({ mode, payload: _importPayload })
    });
    document.getElementById('ieOv').classList.remove('op');
    showToast(res.message || 'Importación completada exitosamente.', 'success');
    loadAllData();
  } catch (err) {
    showToast('Error en importación: ' + err.message, 'error');
  }
}

// ─────────────────────────────────────────────────────────────
// ACCIONES DE FORMULARIOS Y CRUD
// ─────────────────────────────────────────────────────────────

async function deleteSubject(subjectId) {
  const ok = await confirmAction('¿Eliminar esta asignatura y todas sus actividades evaluativas?', 'Eliminar asignatura');
  if (!ok) return;

  try {
    await apiRequest(`/api/subjects/${subjectId}`, { method: 'DELETE' });
    showToast('Asignatura eliminada.', 'success');
    loadAllData();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

async function deletePeriod(periodId) {
  const ok = await confirmAction('¿Eliminar este periodo académico?', 'Eliminar periodo');
  if (!ok) return;

  try {
    await apiRequest(`/api/periods/${periodId}`, { method: 'DELETE' });
    showToast('Periodo eliminado.', 'success');
    loadAllData();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// ─────────────────────────────────────────────────────────────
// INICIALIZACIÓN DE EVENTOS DEL DOM
// ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  setupTheme();

  // Navegación de vistas
  document.getElementById('bCal')?.addEventListener('click', () => setView('cal'));
  document.getElementById('bList')?.addEventListener('click', () => setView('list'));
  document.getElementById('bEnt')?.addEventListener('click', () => setView('ent'));
  document.getElementById('bNot')?.addEventListener('click', () => setView('not'));
  document.getElementById('bReg')?.addEventListener('click', () => setView('reg'));
  document.getElementById('bAcerca')?.addEventListener('click', () => setView('acerca'));

  // Botones de Reportes
  document.getElementById('btnReportExcel')?.addEventListener('click', exportExcelReport);
  document.getElementById('btnReportPDF')?.addEventListener('click', exportPDFReport);

  // Botón de Estado de Guardado
  document.getElementById('save-status-btn')?.addEventListener('click', () => {
    if (state.hasUnsavedChanges) {
      showToast('Sincronizando y guardando cambios...', 'info');
      setUnsavedChanges(false);
      loadAllData();
    } else {
      showToast('Todo se encuentra guardado y sincronizado.', 'success');
    }
  });

  // Alerta nativa de cierre / salida si hay modificaciones pendientes
  window.addEventListener('beforeunload', (e) => {
    if (state.hasUnsavedChanges) {
      e.preventDefault();
      e.returnValue = 'Tienes cambios no guardados en Noctua. ¿Seguro que deseas salir?';
      return e.returnValue;
    }
  });

  // Navegación del calendario
  document.getElementById('prev-month-btn')?.addEventListener('click', () => changeMonth(-1));
  document.getElementById('next-month-btn')?.addEventListener('click', () => changeMonth(1));
  document.getElementById('today-btn')?.addEventListener('click', goToToday);

  // Modales
  document.getElementById('btnOpenEvtModal')?.addEventListener('click', () => openEvtModal());
  document.getElementById('btnOpenIEModal')?.addEventListener('click', openIE);

  document.getElementById('closeActModal')?.addEventListener('click', () => document.getElementById('actOv').classList.remove('op'));
  document.getElementById('closeEntModal')?.addEventListener('click', () => document.getElementById('entOv').classList.remove('op'));
  document.getElementById('cancelEntModal')?.addEventListener('click', () => document.getElementById('entOv').classList.remove('op'));
  document.getElementById('closeEvtFModal')?.addEventListener('click', () => document.getElementById('evtFOv').classList.remove('op'));
  document.getElementById('cancelEvtFModal')?.addEventListener('click', () => document.getElementById('evtFOv').classList.remove('op'));
  document.getElementById('closeEvtDModal')?.addEventListener('click', () => document.getElementById('evtDOv').classList.remove('op'));
  document.getElementById('closeIEModal')?.addEventListener('click', () => document.getElementById('ieOv').classList.remove('op'));

  // Acciones en modal de actividad
  document.getElementById('doneB')?.addEventListener('click', toggleDoneActivity);
  document.getElementById('calInput')?.addEventListener('input', () => {
    setUnsavedChanges(true);
    updateModalGradePreview();
  });
  document.getElementById('btnSaveGradeModal')?.addEventListener('click', saveModalGrade);
  document.getElementById('btnDelGradeModal')?.addEventListener('click', removeModalGrade);
  document.getElementById('btnRegEnt')?.addEventListener('click', () => openEntModal(false));
  document.getElementById('btnEditEnt')?.addEventListener('click', () => openEntModal(true));
  document.getElementById('saveEntBtn')?.addEventListener('click', saveEntregaModal);

  // Switch de calificación inmediata en modal de entrega
  document.getElementById('efHasInstantGrade')?.addEventListener('change', function () {
    setUnsavedChanges(true);
    const wrap = document.getElementById('efInstantGradeWrap');
    if (wrap) wrap.style.display = this.checked ? 'block' : 'none';
  });

  // Acciones en modal de evento
  document.getElementById('saveEvtBtn')?.addEventListener('click', saveEvtModal);
  document.getElementById('editEvtBtn')?.addEventListener('click', () => {
    document.getElementById('evtDOv').classList.remove('op');
    const ev = state.events.find((x) => x.id === state.selectedEventId);
    openEvtModal(ev);
  });
  document.getElementById('delEvtBtn')?.addEventListener('click', async () => {
    const ok = await confirmAction('¿Eliminar este evento académico?', 'Eliminar evento');
    if (!ok) return;
    try {
      await apiRequest(`/api/events/${state.selectedEventId}`, { method: 'DELETE' });
      document.getElementById('evtDOv').classList.remove('op');
      showToast('Evento eliminado.', 'success');
      loadAllData();
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  });

  // Pestañas de Importar/Exportar
  document.getElementById('ieTabExpBtn')?.addEventListener('click', function () {
    this.classList.add('on');
    document.getElementById('ieTabImpBtn').classList.remove('on');
    document.getElementById('ieExp').classList.remove('hidden');
    document.getElementById('ieImp').classList.add('hidden');
  });

  document.getElementById('ieTabImpBtn')?.addEventListener('click', function () {
    this.classList.add('on');
    document.getElementById('ieTabExpBtn').classList.remove('on');
    document.getElementById('ieImp').classList.remove('hidden');
    document.getElementById('ieExp').classList.add('hidden');
  });

  // Drag & drop de archivos
  const dropZone = document.getElementById('ieDropZone');
  const fileInput = document.getElementById('ieFileInput');

  if (dropZone && fileInput) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag');
      if (e.dataTransfer.files.length) parseImportFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length) parseImportFile(e.target.files[0]);
    });
  }

  document.getElementById('ieMergeBtn')?.addEventListener('click', () => doImport('merge'));
  document.getElementById('ieReplaceBtn')?.addEventListener('click', () => doImport('replace'));

  // Detección de cambios pendientes en formularios principales
  ['settings-form', 'period-form', 'subject-form', 'activity-form'].forEach((formId) => {
    document.getElementById(formId)?.addEventListener('input', () => setUnsavedChanges(true));
  });

  // Botón directo de registrar nueva entrega en el header
  document.getElementById('btnHeaderNewEntrega')?.addEventListener('click', openNewEntregaModal);

  // Cambio de actividad en selector de entrega directa
  document.getElementById('efActSelect')?.addEventListener('change', function () {
    const val = this.value;
    if (!val) return;
    const [sId, aId] = val.split('_').map(Number);
    const sub = state.subjects.find((s) => s.id === sId);
    const act = sub ? sub.activities.find((a) => a.id === aId) : null;
    if (act) {
      document.getElementById('efFecha').value = act.submitted_at || act.completed_date || new Date().toISOString().slice(0, 10);
      document.getElementById('efPlat').value = act.platform || '';
      document.getElementById('efLink').value = act.submission_link || '';
      document.getElementById('efNotas').value = act.feedback_notes || '';
      const hasGrade = act.grade_obtained !== null && act.grade_obtained !== undefined && act.grade_obtained !== '';
      const chk = document.getElementById('efHasInstantGrade');
      const wrap = document.getElementById('efInstantGradeWrap');
      const valInput = document.getElementById('efInstantGradeVal');
      if (chk) chk.checked = hasGrade;
      if (wrap) wrap.style.display = hasGrade ? 'block' : 'none';
      if (valInput) valInput.value = hasGrade ? act.grade_obtained : '';
    }
  });

  // Cancelar edición en formularios de Registro
  document.getElementById('cancel-period-edit')?.addEventListener('click', cancelPeriodEdit);
  document.getElementById('cancel-subject-edit')?.addEventListener('click', cancelSubjectEdit);
  document.getElementById('cancel-activity-edit')?.addEventListener('click', cancelActivityEdit);

  // Sincronización automática de peso y puntaje máximo de actividades
  ['change', 'input'].forEach((evt) => {
    document.getElementById('activity-subject')?.addEventListener(evt, syncActivityWeightFromGradeTotal);
  });
  ['input', 'change', 'keyup'].forEach((evt) => {
    document.getElementById('activity-grade-total')?.addEventListener(evt, syncActivityWeightFromGradeTotal);
    document.getElementById('activity-weight')?.addEventListener(evt, syncActivityGradeTotalFromWeight);
  });

  // Filtros y búsquedas en tiempo real en Registro
  document.getElementById('subject-search-input')?.addEventListener('input', renderRegistrationView);
  document.getElementById('subject-period-filter')?.addEventListener('change', renderRegistrationView);
  document.getElementById('activity-search-input')?.addEventListener('input', renderRegistrationView);
  document.getElementById('activity-subject-filter')?.addEventListener('change', renderRegistrationView);

  // Formulario de Configuración
  document.getElementById('settings-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('university-name-input').value.trim();
    try {
      await apiRequest('/api/settings', { method: 'PUT', body: JSON.stringify({ university_name: name }) });
      setUnsavedChanges(false);
      showToast('Nombre de institución actualizado.', 'success');
      loadAllData();
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  });

  // Formulario de Periodos (Crear o Actualizar)
  document.getElementById('period-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('period-id').value;
    const name = document.getElementById('period-name').value.trim();
    const start_date = document.getElementById('period-start').value;
    const end_date = document.getElementById('period-end').value;

    try {
      if (id) {
        await apiRequest(`/api/periods/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ name, start_date, end_date })
        });
        cancelPeriodEdit();
        showToast('Periodo académico actualizado correctamente.', 'success');
      } else {
        await apiRequest('/api/periods', {
          method: 'POST',
          body: JSON.stringify({ name, start_date, end_date, is_active: 1 })
        });
        document.getElementById('period-form').reset();
        showToast('Periodo registrado exitosamente.', 'success');
      }
      setUnsavedChanges(false);
      loadAllData();
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  });

  // Formulario de Asignaturas (Crear o Actualizar)
  document.getElementById('subject-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('subject-id').value;
    const name = document.getElementById('subject-name').value.trim();
    const code = document.getElementById('subject-code').value.trim();
    const teacher = document.getElementById('subject-teacher').value.trim();
    const period_id = document.getElementById('subject-period').value;
    const total_grade_value = document.getElementById('subject-total').value;
    const passing_grade_value = document.getElementById('subject-passing').value;
    const color = document.getElementById('subject-color').value;
    const notes = document.getElementById('subject-notes').value.trim();

    try {
      if (id) {
        await apiRequest(`/api/subjects/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ name, code, teacher, period_id, total_grade_value, passing_grade_value, color, notes })
        });
        cancelSubjectEdit();
        showToast('Asignatura actualizada correctamente.', 'success');
      } else {
        await apiRequest('/api/subjects', {
          method: 'POST',
          body: JSON.stringify({ name, code, teacher, period_id, total_grade_value, passing_grade_value, color, notes })
        });
        cancelSubjectEdit();
        showToast('Asignatura registrada correctamente.', 'success');
      }
      setUnsavedChanges(false);
      loadAllData();
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  });

  // Formulario de Actividades (Crear o Actualizar)
  document.getElementById('activity-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('activity-id').value;
    const subject_id = document.getElementById('activity-subject').value;
    const title = document.getElementById('activity-title').value.trim();
    const activity_type = document.getElementById('activity-type').value;
    const due_date = document.getElementById('activity-due-date').value;
    const weight = document.getElementById('activity-weight').value;
    const grade_obtained_raw = document.getElementById('activity-grade').value.trim();
    const grade_obtained = grade_obtained_raw !== '' ? Number(grade_obtained_raw) : null;
    const grade_total = document.getElementById('activity-grade-total').value;

    if (!subject_id) {
      showToast('Debes seleccionar una asignatura.', 'warning');
      return;
    }

    try {
      if (id) {
        await apiRequest(`/api/subjects/${subject_id}/activities/${id}`, {
          method: 'PUT',
          body: JSON.stringify({
            title,
            activity_type,
            due_date,
            weight,
            grade_obtained,
            grade_total,
            status: grade_obtained !== null ? 'aprobado' : 'pendiente'
          })
        });
        cancelActivityEdit();
        showToast('Actividad actualizada correctamente.', 'success');
      } else {
        await apiRequest(`/api/subjects/${subject_id}/activities`, {
          method: 'POST',
          body: JSON.stringify({
            title,
            activity_type,
            due_date,
            weight,
            grade_obtained,
            grade_total,
            status: grade_obtained !== null ? 'aprobado' : 'pendiente'
          })
        });
        cancelActivityEdit();
        showToast(grade_obtained !== null ? 'Actividad y calificación registrada.' : 'Actividad planeada registrada.', 'success');
      }
      setUnsavedChanges(false);
      loadAllData();
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  });

  // Atajos de teclado
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.op').forEach((m) => m.classList.remove('op'));
    }
    if (!document.querySelector('.modal-overlay.op') && state.currentView === 'cal') {
      if (e.key === 'ArrowLeft') changeMonth(-1);
      if (e.key === 'ArrowRight') changeMonth(1);
    }
  });

  // Carga inicial
  loadAllData();
});
