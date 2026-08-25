/**
 * Servidor Principal de Noctua 🦉
 *
 * Provee la API REST para la suite de gestión y control académico universitario:
 * periodos, asignaturas, actividades ponderadas con evidencia de entrega,
 * categorías, eventos de calendario, notas interactivas y respaldo/importación inteligente.
 * Utiliza SQLite mediante better-sqlite3 con llaves foráneas y modo WAL activos.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'university.db');

// Asegurar la existencia del directorio de datos
fs.mkdirSync(dataDir, { recursive: true });

// Inicializar la conexión a SQLite con configuraciones de alto rendimiento e integridad
const db = new Database(dbPath);
db.pragma('foreign_keys = ON'); // Asegura cascadas y restricciones referenciales
db.pragma('journal_mode = WAL'); // Modo Write-Ahead Logging para lectura/escritura concurrente

// Categorías por defecto si la base de datos es nueva
const defaultCategories = [
  { name: 'Entrega', color: '#3B82F6' },
  { name: 'Examen', color: '#EF4444' },
  { name: 'Proyecto', color: '#10B981' },
  { name: 'Laboratorio', color: '#F59E0B' },
  { name: 'Tarea', color: '#06B6D4' },
  { name: 'Reunión', color: '#8B5CF6' },
  { name: 'Evento académico', color: '#EC4899' }
];

/**
 * Convierte un valor a número seguro o retorna un valor de respaldo si es inválido.
 * @param {*} value - Valor a evaluar.
 * @param {number} fallback - Valor por defecto.
 * @returns {number}
 */
function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Obtiene el nombre actual de la universidad desde la configuración.
 * @returns {string}
 */
function getUniversityName() {
  const setting = db.prepare('SELECT university_name FROM app_settings WHERE id = 1').get();
  return setting && setting.university_name ? setting.university_name : 'Dark-Moon';
}

/**
 * Obtiene los periodos académicos ordenados cronológicamente.
 * @returns {Array}
 */
function getAcademicPeriods() {
  return db.prepare('SELECT * FROM academic_periods ORDER BY start_date IS NULL, start_date ASC, id ASC').all();
}

/**
 * Inicializa las tablas, columnas faltantes e índices de la base de datos.
 */
function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      university_name TEXT NOT NULL DEFAULT 'Dark-Moon'
    );

    CREATE TABLE IF NOT EXISTS academic_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#3B82F6'
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT,
      teacher TEXT,
      period_id INTEGER,
      total_grade_value REAL NOT NULL DEFAULT 100,
      passing_grade_value REAL NOT NULL DEFAULT 60,
      notes TEXT,
      color TEXT DEFAULT '#3B82F6',
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (period_id) REFERENCES academic_periods(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS subject_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      activity_type TEXT NOT NULL DEFAULT 'Tarea',
      due_date TEXT,
      submitted_at TEXT,
      completed_date TEXT,
      grade_obtained REAL,
      grade_total REAL DEFAULT 100,
      weight REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pendiente',
      platform TEXT,
      submission_link TEXT,
      feedback_notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      event_date TEXT NOT NULL,
      event_time TEXT,
      location TEXT,
      description TEXT,
      link TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    );

    -- Creación de índices para optimizar consultas frecuentes
    CREATE INDEX IF NOT EXISTS idx_subjects_period ON subjects(period_id);
    CREATE INDEX IF NOT EXISTS idx_activities_subject ON subject_activities(subject_id);
    CREATE INDEX IF NOT EXISTS idx_activities_due_date ON subject_activities(due_date);
    CREATE INDEX IF NOT EXISTS idx_events_date ON calendar_events(event_date);
    CREATE INDEX IF NOT EXISTS idx_events_category ON calendar_events(category_id);
  `);

  // Migración automática de columnas en caso de estructuras de versiones previas
  const tables = ['app_settings', 'academic_periods', 'categories', 'subjects', 'subject_activities', 'calendar_events'];
  const columnMappings = {
    app_settings: ['id', 'university_name'],
    academic_periods: ['id', 'name', 'start_date', 'end_date', 'is_active', 'created_at'],
    categories: ['id', 'name', 'color'],
    subjects: ['id', 'name', 'code', 'teacher', 'period_id', 'total_grade_value', 'passing_grade_value', 'notes', 'color', 'is_archived', 'created_at'],
    subject_activities: ['id', 'subject_id', 'title', 'activity_type', 'due_date', 'submitted_at', 'completed_date', 'grade_obtained', 'grade_total', 'weight', 'status', 'platform', 'submission_link', 'feedback_notes', 'created_at'],
    calendar_events: ['id', 'title', 'category_id', 'event_date', 'event_time', 'location', 'description', 'link', 'created_at']
  };

  tables.forEach((tableName) => {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
    const existingColumns = new Set(columns.map((column) => column.name));
    (columnMappings[tableName] || []).forEach((columnName) => {
      if (!existingColumns.has(columnName)) {
        if (tableName === 'academic_periods' && columnName === 'is_active') {
          db.exec('ALTER TABLE academic_periods ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
        } else if (tableName === 'subjects' && columnName === 'is_archived') {
          db.exec('ALTER TABLE subjects ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0');
        } else if (tableName === 'subjects' && columnName === 'period_id') {
          db.exec('ALTER TABLE subjects ADD COLUMN period_id INTEGER');
        } else if (tableName === 'subjects' && columnName === 'passing_grade_value') {
          db.exec('ALTER TABLE subjects ADD COLUMN passing_grade_value REAL NOT NULL DEFAULT 60');
        } else if (tableName === 'subjects' && columnName === 'color') {
          db.exec('ALTER TABLE subjects ADD COLUMN color TEXT DEFAULT "#3B82F6"');
        } else if (tableName === 'subject_activities' && columnName === 'grade_total') {
          db.exec('ALTER TABLE subject_activities ADD COLUMN grade_total REAL DEFAULT 100');
        } else if (tableName === 'subject_activities' && columnName === 'status') {
          db.exec('ALTER TABLE subject_activities ADD COLUMN status TEXT NOT NULL DEFAULT "pendiente"');
        } else if (tableName === 'subject_activities' && columnName === 'completed_date') {
          db.exec('ALTER TABLE subject_activities ADD COLUMN completed_date TEXT');
        } else if (tableName === 'subject_activities' && columnName === 'platform') {
          db.exec('ALTER TABLE subject_activities ADD COLUMN platform TEXT');
        } else if (tableName === 'subject_activities' && columnName === 'submission_link') {
          db.exec('ALTER TABLE subject_activities ADD COLUMN submission_link TEXT');
        } else if (tableName === 'subject_activities' && columnName === 'feedback_notes') {
          db.exec('ALTER TABLE subject_activities ADD COLUMN feedback_notes TEXT');
        } else if (tableName === 'calendar_events' && columnName === 'location') {
          db.exec('ALTER TABLE calendar_events ADD COLUMN location TEXT');
        } else if (tableName === 'calendar_events' && columnName === 'event_time') {
          db.exec('ALTER TABLE calendar_events ADD COLUMN event_time TEXT');
        } else if (tableName === 'calendar_events' && columnName === 'link') {
          db.exec('ALTER TABLE calendar_events ADD COLUMN link TEXT');
        } else if (tableName === 'calendar_events' && columnName === 'description') {
          db.exec('ALTER TABLE calendar_events ADD COLUMN description TEXT');
        } else if (tableName === 'app_settings' && columnName === 'university_name') {
          db.exec('ALTER TABLE app_settings ADD COLUMN university_name TEXT NOT NULL DEFAULT "Dark-Moon"');
        }
      }
    });
  });

  // Asegurar registro inicial en app_settings
  const settingsCount = db.prepare('SELECT COUNT(*) AS total FROM app_settings').get().total;
  if (settingsCount === 0) {
    db.prepare('INSERT INTO app_settings (id, university_name) VALUES (1, ?)').run('Dark-Moon');
  }

  // Asegurar periodos por defecto si no existen
  const periodsCount = db.prepare('SELECT COUNT(*) AS total FROM academic_periods').get().total;
  if (periodsCount === 0) {
    const insertPeriod = db.prepare('INSERT INTO academic_periods (name, start_date, end_date) VALUES (?, ?, ?)');
    insertPeriod.run('Semestre 2026-1', '2026-01-01', '2026-06-30');
    insertPeriod.run('Semestre 2026-2', '2026-07-01', '2026-12-31');
  }

  // Asegurar categorías por defecto
  const categoriesCount = db.prepare('SELECT COUNT(*) AS total FROM categories').get().total;
  if (categoriesCount === 0) {
    const insertCategory = db.prepare('INSERT INTO categories (name, color) VALUES (?, ?)');
    const transaction = db.transaction(() => {
      defaultCategories.forEach((category) => insertCategory.run(category.name, category.color));
    });
    transaction();
  }
}

/**
 * Calcula las métricas acumuladas, porcentajes y nota final de una asignatura.
 * @param {number} subjectId - ID de la asignatura.
 * @returns {object|null}
 */
function getSubjectMetrics(subjectId) {
  const subject = db.prepare(`
    SELECT s.*, ap.name AS period_name, COALESCE(ap.is_active, 1) AS period_is_active
    FROM subjects s
    LEFT JOIN academic_periods ap ON ap.id = s.period_id
    WHERE s.id = ?
  `).get(subjectId);

  if (!subject) return null;

  const activities = db.prepare(`
    SELECT *
    FROM subject_activities
    WHERE subject_id = ?
    ORDER BY due_date IS NULL, due_date ASC, created_at DESC
  `).all(subjectId);

  const totalWeight = activities.reduce((sum, item) => sum + asNumber(item.weight), 0);
  const completedWeight = activities.reduce((sum, item) => {
    const isSubmitted = item.status === 'presentado' || item.status === 'aprobado' || item.completed_date || (item.grade_obtained !== null && item.grade_obtained !== '');
    return isSubmitted ? sum + asNumber(item.weight) : sum;
  }, 0);

  const scoreWeighted = activities.reduce((sum, item) => {
    if (item.grade_obtained === null || item.grade_obtained === '' || item.grade_total === null || asNumber(item.grade_total) <= 0) {
      return sum;
    }

    const normalized = asNumber(item.grade_obtained) / asNumber(item.grade_total);
    return sum + normalized * asNumber(item.weight);
  }, 0);

  const subjectMax = asNumber(subject.total_grade_value, 100);
  const finalGradePercent = totalWeight > 0 ? (scoreWeighted / totalWeight) * 100 : 0;
  const progressPercent = totalWeight > 0 ? (completedWeight / totalWeight) * 100 : 0;
  const finalGradeValue = subjectMax ? (finalGradePercent / 100) * subjectMax : 0;
  const grade5Scale = (finalGradePercent / 100) * 5.0; // Escala 0 a 5.0 estándar universitaria

  // Cálculo de puntaje requerido para aprobar personalizado por asignatura (por defecto 60% de la escala)
  const passingScore = (subject.passing_grade_value !== null && subject.passing_grade_value !== undefined && subject.passing_grade_value !== '')
    ? asNumber(subject.passing_grade_value, subjectMax * 0.6)
    : (subjectMax * 0.6);
  const passingThresholdPercent = subjectMax > 0 ? (passingScore / subjectMax) * 100 : 60;
  const targetPoints = (passingThresholdPercent / 100) * (totalWeight || 100);
  const remainingWeight = Math.max(0, (totalWeight || 100) - completedWeight);
  const pointsNeeded = Math.max(0, targetPoints - scoreWeighted);
  const requiredAveragePercent = remainingWeight > 0 ? (pointsNeeded / remainingWeight) * 100 : 0;

  return {
    ...subject,
    passing_grade_value: passingScore,
    activities,
    weight_total: totalWeight,
    completed_weight: completedWeight,
    progress_percent: progressPercent,
    final_grade_percent: finalGradePercent,
    final_grade_value: finalGradeValue,
    grade_5_scale: grade5Scale,
    passing_target_percent: passingThresholdPercent,
    points_needed_to_pass: pointsNeeded,
    remaining_weight: remainingWeight,
    required_average_to_pass: requiredAveragePercent
  };
}

/**
 * Obtiene la lista de todas las asignaturas junto con sus métricas calculadas.
 * @returns {Array}
 */
function getSubjectsPayload() {
  const subjects = db.prepare(`
    SELECT s.*, ap.name AS period_name, COALESCE(ap.is_active, 1) AS period_is_active
    FROM subjects s
    LEFT JOIN academic_periods ap ON ap.id = s.period_id
    ORDER BY s.created_at DESC
  `).all();

  return subjects.map((subject) => getSubjectMetrics(subject.id)).filter(Boolean);
}

/**
 * Obtiene la información consolidada para el panel principal y estadísticas.
 * @returns {object}
 */
function getDashboardPayload() {
  const subjects = getSubjectsPayload();
  const periods = getAcademicPeriods();
  const events = db.prepare(`
    SELECT e.*, c.name AS category_name, c.color AS category_color
    FROM calendar_events e
    JOIN categories c ON c.id = e.category_id
    ORDER BY e.event_date ASC, e.created_at DESC
    LIMIT 8
  `).all();

  const totalSubjects = subjects.length;
  const totalActivities = db.prepare('SELECT COUNT(*) AS total FROM subject_activities').get().total;
  const totalEvents = db.prepare('SELECT COUNT(*) AS total FROM calendar_events').get().total;
  const avgGrade = totalSubjects
    ? subjects.reduce((sum, subject) => sum + asNumber(subject.final_grade_value), 0) / totalSubjects
    : 0;

  const periodSummary = periods.map((period) => {
    const periodSubjects = subjects.filter((subject) => String(subject.period_id) === String(period.id));
    const average = periodSubjects.length
      ? periodSubjects.reduce((sum, subject) => sum + asNumber(subject.final_grade_value), 0) / periodSubjects.length
      : 0;

    return {
      ...period,
      subjects_count: periodSubjects.length,
      average_grade: average
    };
  });

  return {
    university_name: getUniversityName(),
    total_subjects: totalSubjects,
    total_activities: totalActivities,
    total_events: totalEvents,
    average_grade: avgGrade,
    periods: periodSummary,
    upcoming_events: events,
    subjects
  };
}

// Inicializar la base de datos al arrancar
initializeDatabase();

// Middlewares
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// RUTAS DE CONFIGURACIÓN (Settings)
// -------------------------------------------------------------

app.get('/api/settings', (req, res) => {
  return res.json({ university_name: getUniversityName() });
});

app.put('/api/settings', (req, res) => {
  const { university_name } = req.body || {};
  const nextName = university_name ? String(university_name).trim() : 'Dark-Moon';
  db.prepare('INSERT INTO app_settings (id, university_name) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET university_name = excluded.university_name').run(nextName);
  return res.json({ university_name: nextName });
});

// -------------------------------------------------------------
// RUTAS DE PERIODOS ACADÉMICOS
// -------------------------------------------------------------

app.get('/api/periods', (req, res) => {
  return res.json(getAcademicPeriods());
});

app.post('/api/periods', (req, res) => {
  const { name, start_date, end_date, is_active = 1 } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'El nombre del periodo académico es requerido.' });
  }

  const result = db.prepare('INSERT INTO academic_periods (name, start_date, end_date, is_active) VALUES (?, ?, ?, ?)').run(
    String(name).trim(),
    start_date || null,
    end_date || null,
    is_active ? 1 : 0
  );

  return res.status(201).json({
    id: result.lastInsertRowid,
    name: String(name).trim(),
    start_date: start_date || null,
    end_date: end_date || null,
    is_active: is_active ? 1 : 0
  });
});

app.put('/api/periods/:id', (req, res) => {
  const periodId = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM academic_periods WHERE id = ?').get(periodId);
  if (!existing) {
    return res.status(404).json({ error: 'Periodo académico no encontrado.' });
  }

  const { name, start_date, end_date, is_active } = req.body || {};
  const nextName = name !== undefined ? String(name).trim() : existing.name;
  if (!nextName) {
    return res.status(400).json({ error: 'El nombre del periodo académico es requerido.' });
  }

  const nextActive = is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active;

  db.prepare('UPDATE academic_periods SET name = ?, start_date = ?, end_date = ?, is_active = ? WHERE id = ?').run(
    nextName,
    start_date !== undefined ? start_date : existing.start_date,
    end_date !== undefined ? end_date : existing.end_date,
    nextActive,
    periodId
  );

  return res.json({ message: 'Periodo académico actualizado correctamente.', is_active: nextActive });
});

app.patch('/api/periods/:id/toggle-status', (req, res) => {
  const periodId = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM academic_periods WHERE id = ?').get(periodId);
  if (!existing) {
    return res.status(404).json({ error: 'Periodo académico no encontrado.' });
  }

  const nextActive = existing.is_active === 1 ? 0 : 1;
  db.prepare('UPDATE academic_periods SET is_active = ? WHERE id = ?').run(nextActive, periodId);
  return res.json({
    message: nextActive === 1 ? 'Periodo activado como En curso.' : 'Periodo archivado exitosamente.',
    is_active: nextActive
  });
});

app.delete('/api/periods/:id', (req, res) => {
  const periodId = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM academic_periods WHERE id = ?').get(periodId);
  if (!existing) {
    return res.status(404).json({ error: 'Periodo académico no encontrado.' });
  }

  db.prepare('DELETE FROM academic_periods WHERE id = ?').run(periodId);
  return res.json({ message: 'Periodo académico eliminado correctamente.' });
});

app.patch('/api/subjects/:id/toggle-archive', (req, res) => {
  const subjectId = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM subjects WHERE id = ?').get(subjectId);
  if (!existing) {
    return res.status(404).json({ error: 'Asignatura no encontrada.' });
  }

  const nextArchived = existing.is_archived === 1 ? 0 : 1;
  db.prepare('UPDATE subjects SET is_archived = ? WHERE id = ?').run(nextArchived, subjectId);
  return res.json({
    message: nextArchived === 1 ? 'Asignatura archivada.' : 'Asignatura desarchivada.',
    is_archived: nextArchived
  });
});

// -------------------------------------------------------------
// RUTAS DE CATEGORÍAS
// -------------------------------------------------------------

app.get('/api/categories', (req, res) => {
  return res.json(db.prepare('SELECT * FROM categories ORDER BY id ASC').all());
});

app.post('/api/categories', (req, res) => {
  const { name, color } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'El nombre de la categoría es requerido.' });
  }

  try {
    const result = db.prepare('INSERT INTO categories (name, color) VALUES (?, ?)').run(
      String(name).trim(),
      color || '#3B82F6'
    );

    return res.status(201).json({
      id: result.lastInsertRowid,
      name: String(name).trim(),
      color: color || '#3B82F6'
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(400).json({ error: 'Ya existe una categoría con ese nombre.' });
    }
    throw error;
  }
});

app.put('/api/categories/:id', (req, res) => {
  const categoryId = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId);
  if (!existing) {
    return res.status(404).json({ error: 'Categoría no encontrada.' });
  }

  const { name, color } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'El nombre de la categoría es requerido.' });
  }

  db.prepare('UPDATE categories SET name = ?, color = ? WHERE id = ?').run(
    String(name).trim(),
    color || '#3B82F6',
    categoryId
  );

  return res.json({ message: 'Categoría actualizada correctamente.' });
});

app.delete('/api/categories/:id', (req, res) => {
  const categoryId = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId);
  if (!existing) {
    return res.status(404).json({ error: 'Categoría no encontrada.' });
  }

  db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
  return res.json({ message: 'Categoría eliminada correctamente.' });
});

// -------------------------------------------------------------
// RUTAS DE ASIGNATURAS (Subjects)
// -------------------------------------------------------------

app.get('/api/subjects', (req, res) => {
  return res.json(getSubjectsPayload());
});

app.get('/api/subjects/:id', (req, res) => {
  const subject = getSubjectMetrics(Number(req.params.id));
  if (!subject) {
    return res.status(404).json({ error: 'Asignatura no encontrada.' });
  }
  return res.json(subject);
});

app.post('/api/subjects', (req, res) => {
  const { name, code, teacher, period_id, total_grade_value, passing_grade_value, notes, color } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'El nombre de la asignatura es requerido.' });
  }

  const totalMax = asNumber(total_grade_value, 100);
  const passVal = passing_grade_value !== undefined && passing_grade_value !== '' && passing_grade_value !== null
    ? asNumber(passing_grade_value, totalMax * 0.6)
    : (totalMax * 0.6);

  const result = db.prepare(`
    INSERT INTO subjects (name, code, teacher, period_id, total_grade_value, passing_grade_value, notes, color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(name).trim(),
    code ? String(code).trim() : null,
    teacher ? String(teacher).trim() : null,
    period_id ? Number(period_id) : null,
    totalMax,
    passVal,
    notes ? String(notes).trim() : null,
    color || '#3B82F6'
  );

  return res.status(201).json(getSubjectMetrics(result.lastInsertRowid));
});

app.put('/api/subjects/:id', (req, res) => {
  const subjectId = Number(req.params.id);
  const existing = getSubjectMetrics(subjectId);
  if (!existing) {
    return res.status(404).json({ error: 'Asignatura no encontrada.' });
  }

  const { name, code, teacher, period_id, total_grade_value, passing_grade_value, notes, color } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'El nombre de la asignatura es requerido.' });
  }

  const nextTotal = total_grade_value !== undefined && total_grade_value !== '' ? asNumber(total_grade_value, existing.total_grade_value) : existing.total_grade_value;
  const nextPassing = passing_grade_value !== undefined && passing_grade_value !== ''
    ? asNumber(passing_grade_value, nextTotal * 0.6)
    : (existing.passing_grade_value !== undefined ? existing.passing_grade_value : nextTotal * 0.6);

  db.prepare(`
    UPDATE subjects
    SET name = ?, code = ?, teacher = ?, period_id = ?, total_grade_value = ?, passing_grade_value = ?, notes = ?, color = ?
    WHERE id = ?
  `).run(
    String(name).trim(),
    code !== undefined ? (code ? String(code).trim() : null) : existing.code,
    teacher !== undefined ? (teacher ? String(teacher).trim() : null) : existing.teacher,
    period_id !== undefined ? (period_id ? Number(period_id) : null) : existing.period_id,
    nextTotal,
    nextPassing,
    notes !== undefined ? (notes ? String(notes).trim() : null) : existing.notes,
    color || existing.color || '#3B82F6',
    subjectId
  );

  return res.json(getSubjectMetrics(subjectId));
});

app.delete('/api/subjects/:id', (req, res) => {
  const subjectId = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM subjects WHERE id = ?').get(subjectId);
  if (!existing) {
    return res.status(404).json({ error: 'Asignatura no encontrada.' });
  }

  db.prepare('DELETE FROM subjects WHERE id = ?').run(subjectId);
  return res.json({ message: 'Asignatura eliminada correctamente.' });
});

// -------------------------------------------------------------
// RUTAS DE ACTIVIDADES DE ASIGNATURA
// -------------------------------------------------------------

app.post('/api/subjects/:id/activities', (req, res) => {
  const subjectId = Number(req.params.id);
  const subject = db.prepare('SELECT id FROM subjects WHERE id = ?').get(subjectId);
  if (!subject) {
    return res.status(404).json({ error: 'Asignatura no encontrada.' });
  }

  const {
    title, activity_type, due_date, submitted_at, completed_date,
    grade_obtained, grade_total, weight, status, platform, submission_link, feedback_notes
  } = req.body || {};

  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'El título de la actividad es requerido.' });
  }

  const result = db.prepare(`
    INSERT INTO subject_activities (
      subject_id, title, activity_type, due_date, submitted_at, completed_date,
      grade_obtained, grade_total, weight, status, platform, submission_link, feedback_notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    subjectId,
    String(title).trim(),
    activity_type ? String(activity_type).trim() : 'Tarea',
    due_date || null,
    submitted_at || null,
    completed_date || (status === 'aprobado' || status === 'presentado' ? new Date().toISOString().slice(0, 10) : null),
    grade_obtained !== undefined && grade_obtained !== '' && grade_obtained !== null ? asNumber(grade_obtained, 0) : null,
    grade_total !== undefined && grade_total !== '' && grade_total !== null ? asNumber(grade_total, 100) : 100,
    asNumber(weight, 0),
    status || (submitted_at || (grade_obtained !== undefined && grade_obtained !== '' && grade_obtained !== null) ? 'presentado' : 'pendiente'),
    platform ? String(platform).trim() : null,
    submission_link ? String(submission_link).trim() : null,
    feedback_notes ? String(feedback_notes).trim() : null
  );

  return res.status(201).json({
    id: result.lastInsertRowid,
    message: 'Actividad registrada correctamente.'
  });
});

/**
 * Actualización segura de actividad: preserva valores existentes de weight, grade_total y evidencias
 * cuando se actualizan campos parciales (por ejemplo, desde el modal de actividad o la tabla de notas).
 */
app.put('/api/subjects/:subjectId/activities/:activityId', (req, res) => {
  const subjectId = Number(req.params.subjectId);
  const activityId = Number(req.params.activityId);

  const subject = db.prepare('SELECT id FROM subjects WHERE id = ?').get(subjectId);
  if (!subject) {
    return res.status(404).json({ error: 'Asignatura no encontrada.' });
  }

  const existing = db.prepare('SELECT * FROM subject_activities WHERE id = ? AND subject_id = ?').get(activityId, subjectId);
  if (!existing) {
    return res.status(404).json({ error: 'Actividad no encontrada.' });
  }

  const {
    title, activity_type, due_date, submitted_at, completed_date,
    grade_obtained, grade_total, weight, status, platform, submission_link, feedback_notes
  } = req.body || {};

  const nextTitle = title !== undefined && String(title).trim() ? String(title).trim() : existing.title;
  const nextType = activity_type !== undefined && String(activity_type).trim() ? String(activity_type).trim() : existing.activity_type;
  const nextDueDate = due_date !== undefined ? (due_date || null) : existing.due_date;
  const nextSubmittedAt = submitted_at !== undefined ? (submitted_at || null) : existing.submitted_at;
  const nextCompletedDate = completed_date !== undefined ? (completed_date || null) : existing.completed_date;
  const nextGradeObtained = grade_obtained !== undefined ? (grade_obtained !== '' && grade_obtained !== null ? asNumber(grade_obtained, 0) : null) : existing.grade_obtained;
  const nextGradeTotal = grade_total !== undefined ? (grade_total !== '' && grade_total !== null ? asNumber(grade_total, 100) : 100) : existing.grade_total;
  const nextWeight = weight !== undefined ? asNumber(weight, existing.weight) : existing.weight;
  const nextStatus = status !== undefined ? status : existing.status;
  const nextPlatform = platform !== undefined ? (platform ? String(platform).trim() : null) : existing.platform;
  const nextLink = submission_link !== undefined ? (submission_link ? String(submission_link).trim() : null) : existing.submission_link;
  const nextFeedback = feedback_notes !== undefined ? (feedback_notes ? String(feedback_notes).trim() : null) : existing.feedback_notes;

  db.prepare(`
    UPDATE subject_activities
    SET title = ?, activity_type = ?, due_date = ?, submitted_at = ?, completed_date = ?,
        grade_obtained = ?, grade_total = ?, weight = ?, status = ?,
        platform = ?, submission_link = ?, feedback_notes = ?
    WHERE id = ? AND subject_id = ?
  `).run(
    nextTitle,
    nextType,
    nextDueDate,
    nextSubmittedAt,
    nextCompletedDate,
    nextGradeObtained,
    nextGradeTotal,
    nextWeight,
    nextStatus,
    nextPlatform,
    nextLink,
    nextFeedback,
    activityId,
    subjectId
  );

  return res.json({ message: 'Actividad actualizada correctamente.' });
});

app.delete('/api/subjects/:subjectId/activities/:activityId', (req, res) => {
  const subjectId = Number(req.params.subjectId);
  const activityId = Number(req.params.activityId);

  const exists = db.prepare('SELECT id FROM subject_activities WHERE id = ? AND subject_id = ?').get(activityId, subjectId);
  if (!exists) {
    return res.status(404).json({ error: 'Actividad no encontrada.' });
  }

  db.prepare('DELETE FROM subject_activities WHERE id = ? AND subject_id = ?').run(activityId, subjectId);
  return res.json({ message: 'Actividad eliminada correctamente.' });
});

// -------------------------------------------------------------
// RUTAS DE EVENTOS Y CALENDARIO
// -------------------------------------------------------------

app.get('/api/events', (req, res) => {
  return res.json(db.prepare(`
    SELECT e.*, c.name AS category_name, c.color AS category_color
    FROM calendar_events e
    JOIN categories c ON c.id = e.category_id
    ORDER BY e.event_date ASC, e.created_at DESC
  `).all());
});

/**
 * Endpoint para obtener el calendario unificado (eventos generales + fechas límite de actividades de materias).
 */
app.get('/api/calendar/unified', (req, res) => {
  const generalEvents = db.prepare(`
    SELECT e.id, e.title, e.event_date, e.event_time, e.location, e.description, e.link,
           c.name AS category_name, c.color AS category_color,
           'evento' AS item_type, NULL AS subject_name, NULL AS subject_id, NULL AS completed_date,
           NULL AS grade_obtained, NULL AS grade_total, NULL AS weight
    FROM calendar_events e
    JOIN categories c ON c.id = e.category_id
    ORDER BY e.event_date ASC
  `).all();

  const activityEvents = db.prepare(`
    SELECT a.id, a.title, a.due_date AS event_date, NULL AS event_time, a.platform AS location,
           ('Asignatura: ' || s.name || ' | Tipo: ' || a.activity_type || ' | Puntos: ' || a.weight || '%') AS description,
           a.submission_link AS link,
           (a.activity_type || ' - ' || s.name) AS category_name,
           COALESCE(s.color, '#3B82F6') AS category_color,
           'actividad' AS item_type, s.name AS subject_name, s.id AS subject_id, a.completed_date,
           a.grade_obtained, a.grade_total, a.weight, a.status
    FROM subject_activities a
    JOIN subjects s ON s.id = a.subject_id
    WHERE a.due_date IS NOT NULL AND a.due_date != ''
    ORDER BY a.due_date ASC
  `).all();

  const combined = [...generalEvents, ...activityEvents].sort((a, b) => {
    if (a.event_date === b.event_date) return 0;
    return a.event_date > b.event_date ? 1 : -1;
  });

  return res.json(combined);
});

app.post('/api/events', (req, res) => {
  const { title, category_id, event_date, event_time, location, description, link } = req.body || {};

  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'El título del evento es requerido.' });
  }

  if (!event_date) {
    return res.status(400).json({ error: 'La fecha del evento es requerida.' });
  }

  const categoryExists = db.prepare('SELECT id FROM categories WHERE id = ?').get(Number(category_id));
  if (!categoryExists) {
    return res.status(400).json({ error: 'La categoría seleccionada no es válida.' });
  }

  const result = db.prepare(`
    INSERT INTO calendar_events (title, category_id, event_date, event_time, location, description, link)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(title).trim(),
    Number(category_id),
    event_date,
    event_time ? String(event_time).trim() : null,
    location ? String(location).trim() : null,
    description ? String(description).trim() : null,
    link ? String(link).trim() : null
  );

  return res.status(201).json({ id: result.lastInsertRowid, message: 'Evento registrado correctamente.' });
});

app.put('/api/events/:id', (req, res) => {
  const eventId = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM calendar_events WHERE id = ?').get(eventId);
  if (!existing) {
    return res.status(404).json({ error: 'Evento no encontrado.' });
  }

  const { title, category_id, event_date, event_time, location, description, link } = req.body || {};
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'El título del evento es requerido.' });
  }

  if (!event_date) {
    return res.status(400).json({ error: 'La fecha del evento es requerida.' });
  }

  db.prepare(`
    UPDATE calendar_events
    SET title = ?, category_id = ?, event_date = ?, event_time = ?, location = ?, description = ?, link = ?
    WHERE id = ?
  `).run(
    String(title).trim(),
    Number(category_id),
    event_date,
    event_time ? String(event_time).trim() : null,
    location ? String(location).trim() : null,
    description ? String(description).trim() : null,
    link ? String(link).trim() : null,
    eventId
  );

  return res.json({ message: 'Evento actualizado correctamente.' });
});

app.delete('/api/events/:id', (req, res) => {
  const eventId = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM calendar_events WHERE id = ?').get(eventId);
  if (!existing) {
    return res.status(404).json({ error: 'Evento no encontrado.' });
  }

  db.prepare('DELETE FROM calendar_events WHERE id = ?').run(eventId);
  return res.json({ message: 'Evento eliminado correctamente.' });
});

// -------------------------------------------------------------
// DASHBOARD, REPORTES (EXCEL / PDF) E IMPORTACIÓN INTELIGENTE
// -------------------------------------------------------------

app.get('/api/dashboard', (req, res) => {
  return res.json(getDashboardPayload());
});

/**
 * Genera y descarga un reporte académico estructurado en formato compatible con Microsoft Excel (CSV UTF-8 con BOM).
 */
app.get('/api/reports/excel', (req, res) => {
  try {
    const subjects = getSubjectsPayload();
    const dateStr = new Date().toISOString().slice(0, 10);
    const uniName = getUniversityName();

    // Encabezados de columnas
    const headers = [
      'Periodo Académico',
      'Asignatura',
      'Código',
      'Docente',
      'Escala Calificación Asignatura',
      'Promedio Acumulado (0.0 - 5.0)',
      'Puntos Obtenidos Asignatura',
      'Peso Evaluado Acumulado (%)',
      'Estado Asignatura',
      'Actividad / Evaluación',
      'Tipo de Evaluación',
      'Peso Actividad (%)',
      'Nota Obtenida',
      'Puntaje Máximo',
      'Equivalencia (0.0 - 5.0)',
      'Aporte Ponderado (%)',
      'Estado Actividad',
      'Fecha Límite',
      'Fecha Entrega',
      'Plataforma / Medio',
      'Enlace de Evidencia',
      'Retroalimentación / Notas'
    ];

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = [];
    rows.push(headers.map(escapeCsv).join(','));

    subjects.forEach((sub) => {
      const pName = sub.period_name || 'Sin periodo';
      const sName = sub.name;
      const sCode = sub.code || 'S/C';
      const sTeacher = sub.teacher || 'No asignado';
      const sTotalScale = sub.total_grade_value || 100;
      const sGrade5 = (sub.grade_5_scale || 0).toFixed(2);
      const sFinalVal = (sub.final_grade_value || 0).toFixed(1);
      const sWeightDone = `${sub.completed_weight || 0}% / ${sub.weight_total || 100}%`;
      const sStatus = (sub.grade_5_scale || 0) >= 3.0 ? 'Aprobando' : 'En riesgo / Reprobando';

      const acts = sub.activities || [];
      if (!acts.length) {
        rows.push([
          escapeCsv(pName),
          escapeCsv(sName),
          escapeCsv(sCode),
          escapeCsv(sTeacher),
          escapeCsv(sTotalScale),
          escapeCsv(sGrade5),
          escapeCsv(sFinalVal),
          escapeCsv(sWeightDone),
          escapeCsv(sStatus),
          escapeCsv('Sin actividades registradas'),
          escapeCsv('—'),
          escapeCsv('0%'),
          escapeCsv('—'),
          escapeCsv('—'),
          escapeCsv('—'),
          escapeCsv('—'),
          escapeCsv('—'),
          escapeCsv('—'),
          escapeCsv('—'),
          escapeCsv('—'),
          escapeCsv('—'),
          escapeCsv('—')
        ].join(','));
      } else {
        acts.forEach((act) => {
          const maxPts = act.grade_total || 100;
          const hasGrade = act.grade_obtained !== null && act.grade_obtained !== '';
          const actGrade5 = (hasGrade && maxPts > 0) ? ((act.grade_obtained / maxPts) * 5.0).toFixed(2) : '—';
          const contrib = (hasGrade && maxPts > 0) ? (((act.grade_obtained / maxPts) * (act.weight || 0))).toFixed(2) + '%' : '—';
          const actStatus = hasGrade ? 'Calificada' : (act.submitted_at || act.completed_date ? 'Entregada (esperando nota)' : 'Pendiente');

          rows.push([
            escapeCsv(pName),
            escapeCsv(sName),
            escapeCsv(sCode),
            escapeCsv(sTeacher),
            escapeCsv(sTotalScale),
            escapeCsv(sGrade5),
            escapeCsv(sFinalVal),
            escapeCsv(sWeightDone),
            escapeCsv(sStatus),
            escapeCsv(act.title),
            escapeCsv(act.activity_type || 'Tarea'),
            escapeCsv(`${act.weight || 0}%`),
            escapeCsv(hasGrade ? act.grade_obtained : '—'),
            escapeCsv(maxPts),
            escapeCsv(actGrade5),
            escapeCsv(contrib),
            escapeCsv(actStatus),
            escapeCsv(act.due_date || '—'),
            escapeCsv(act.submitted_at || act.completed_date || '—'),
            escapeCsv(act.platform || '—'),
            escapeCsv(act.submission_link || '—'),
            escapeCsv(act.feedback_notes || '—')
          ].join(','));
        });
      }
    });

    const csvContent = '\uFEFF' + rows.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Reporte_Academico_Noctua_${dateStr}.csv"`);
    return res.status(200).send(csvContent);
  } catch (err) {
    console.error('Error al generar reporte Excel:', err);
    return res.status(500).json({ error: 'Error al generar el reporte Excel: ' + err.message });
  }
});

/**
 * Endpoint para exportar toda la base de datos en formato JSON para respaldo.
 */
app.get('/api/export', (req, res) => {
  const periods = db.prepare('SELECT * FROM academic_periods').all();
  const categories = db.prepare('SELECT * FROM categories').all();
  const subjects = db.prepare('SELECT * FROM subjects').all();
  const activities = db.prepare('SELECT * FROM subject_activities').all();
  const events = db.prepare('SELECT * FROM calendar_events').all();

  const payload = {
    version: '2.1.0',
    _app: 'noctua',
    _version: '2.1.0',
    exported_at: new Date().toISOString(),
    university_name: getUniversityName(),
    periods,
    categories,
    subjects,
    activities,
    events,
    data: {
      periods,
      categories,
      subjects,
      activities,
      events
    }
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="noctua-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  return res.send(JSON.stringify(payload, null, 2));
});

/**
 * Endpoint para importar datos desde un archivo JSON (soporta modos 'merge' y 'replace').
 */
app.post('/api/import', (req, res) => {
  const { mode = 'merge', payload } = req.body || {};

  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'El archivo de respaldo es inválido o está vacío.' });
  }

  const backupData = payload.data || payload;
  const periods = Array.isArray(backupData.periods) ? backupData.periods : [];
  const categories = Array.isArray(backupData.categories) ? backupData.categories : [];
  const subjects = Array.isArray(backupData.subjects) ? backupData.subjects : [];
  const activities = Array.isArray(backupData.activities) ? backupData.activities : [];
  const events = Array.isArray(backupData.events) ? backupData.events : [];
  const uniName = payload.university_name || backupData.university_name;

  const importTransaction = db.transaction(() => {
    if (mode === 'replace') {
      db.exec(`
        DELETE FROM calendar_events;
        DELETE FROM subject_activities;
        DELETE FROM subjects;
        DELETE FROM categories;
        DELETE FROM academic_periods;
      `);
    }

    if (uniName) {
      db.prepare('INSERT INTO app_settings (id, university_name) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET university_name = excluded.university_name').run(uniName);
    }

    // Mapas para resolución de claves foráneas
    const periodIdMap = new Map();
    const catIdMap = new Map();

    // 1. Importar periodos
    const insertPeriod = db.prepare('INSERT INTO academic_periods (name, start_date, end_date) VALUES (?, ?, ?)');
    periods.forEach((p) => {
      if (p.name) {
        const existing = db.prepare('SELECT id FROM academic_periods WHERE name = ?').get(p.name);
        if (existing) {
          if (p.id) periodIdMap.set(p.id, existing.id);
        } else {
          const resP = insertPeriod.run(p.name, p.start_date || null, p.end_date || null);
          if (p.id) periodIdMap.set(p.id, resP.lastInsertRowid);
        }
      }
    });

    // 2. Importar categorías
    const insertCat = db.prepare('INSERT OR IGNORE INTO categories (name, color) VALUES (?, ?)');
    categories.forEach((c) => {
      if (c.name) {
        const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(c.name);
        if (existing) {
          if (c.id) catIdMap.set(c.id, existing.id);
        } else {
          const resC = insertCat.run(c.name, c.color || '#3B82F6');
          const finalId = resC.lastInsertRowid || db.prepare('SELECT id FROM categories WHERE name = ?').get(c.name)?.id;
          if (c.id && finalId) catIdMap.set(c.id, finalId);
        }
      }
    });

    // Asegurar que exista al menos una categoría válida
    let defaultCatId = db.prepare('SELECT id FROM categories LIMIT 1').get()?.id;
    if (!defaultCatId) {
      const initCat = db.prepare('INSERT INTO categories (name, color) VALUES (?, ?)').run('General', '#3B82F6');
      defaultCatId = initCat.lastInsertRowid;
    }

    // 3. Importar asignaturas
    const insertSubject = db.prepare(`
      INSERT INTO subjects (name, code, teacher, period_id, total_grade_value, passing_grade_value, notes, color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    subjects.forEach((s) => {
      if (s.name) {
        let mappedPeriodId = null;
        if (s.period_id && periodIdMap.has(s.period_id)) {
          mappedPeriodId = periodIdMap.get(s.period_id);
        } else if (s.period_id && db.prepare('SELECT id FROM academic_periods WHERE id = ?').get(s.period_id)) {
          mappedPeriodId = s.period_id;
        }

        const existing = db.prepare('SELECT id FROM subjects WHERE name = ?').get(s.name);
        let currentSubId = existing ? existing.id : null;
        if (!existing) {
          const totalVal = asNumber(s.total_grade_value, 100);
          const passVal = s.passing_grade_value !== undefined && s.passing_grade_value !== null ? asNumber(s.passing_grade_value, totalVal * 0.6) : (totalVal * 0.6);
          const resSub = insertSubject.run(s.name, s.code || null, s.teacher || null, mappedPeriodId, totalVal, passVal, s.notes || null, s.color || '#3B82F6');
          currentSubId = resSub.lastInsertRowid;
        }

        // Importar actividades asociadas si vienen embebidas o en array plano
        const subActs = activities.filter((a) => a.subject_id === s.id || String(a.subject_name).toLowerCase() === String(s.name).toLowerCase());
        const insertAct = db.prepare(`
          INSERT INTO subject_activities (
            subject_id, title, activity_type, due_date, submitted_at, completed_date,
            grade_obtained, grade_total, weight, status, platform, submission_link, feedback_notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        subActs.forEach((a) => {
          if (a.title && currentSubId) {
            const actExists = db.prepare('SELECT id FROM subject_activities WHERE subject_id = ? AND title = ?').get(currentSubId, a.title);
            if (!actExists) {
              insertAct.run(
                currentSubId, a.title, a.activity_type || 'Tarea',
                a.due_date || null, a.submitted_at || null, a.completed_date || null,
                a.grade_obtained !== undefined ? asNumber(a.grade_obtained, 0) : null,
                a.grade_total !== undefined ? asNumber(a.grade_total, 100) : 100,
                asNumber(a.weight, 0), a.status || 'pendiente',
                a.platform || null, a.submission_link || null, a.feedback_notes || null
              );
            }
          }
        });
      }
    });

    // 4. Importar eventos
    const insertEvt = db.prepare(`
      INSERT INTO calendar_events (title, category_id, event_date, event_time, location, description, link)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    events.forEach((e) => {
      if (e.title && e.event_date) {
        let mappedCatId = defaultCatId;
        if (e.category_id && catIdMap.has(e.category_id)) {
          mappedCatId = catIdMap.get(e.category_id);
        } else if (e.category_id && db.prepare('SELECT id FROM categories WHERE id = ?').get(e.category_id)) {
          mappedCatId = e.category_id;
        }

        const evtExists = db.prepare('SELECT id FROM calendar_events WHERE title = ? AND event_date = ?').get(e.title, e.event_date);
        if (!evtExists) {
          insertEvt.run(e.title, mappedCatId, e.event_date, e.event_time || null, e.location || null, e.description || null, e.link || null);
        }
      }
    });
  });

  try {
    importTransaction();
    return res.json({ success: true, message: `Datos importados exitosamente en modo "${mode}".` });
  } catch (err) {
    console.error('Error durante la importación:', err);
    return res.status(500).json({ error: 'Error al procesar la importación: ' + err.message });
  }
});

// Enrutamiento frontend SPA
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Manejador centralizado de errores
app.use((err, req, res, next) => {
  console.error('Error en el servidor:', err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

// Exportar la app para pruebas automatizadas o iniciar el servidor si se corre directamente
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`🦉 Servidor Noctua iniciado en http://localhost:${PORT}`);
  });
}

module.exports = app;


