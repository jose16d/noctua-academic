/**
 * Pruebas Automatizadas de la API de Dark-Moon
 *
 * Valida todos los endpoints REST, integridad de datos en SQLite,
 * persistencia de metricas ponderadas, calculo de notas y el bugfix de actualizacion parcial.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'test';
process.env.PORT = '3456';

const app = require('../server.js');
let server;
const BASE_URL = 'http://localhost:3456';

async function request(path, options = {}) {
  const url = BASE_URL + path;
  const res = await fetch(url, options);
  const contentType = res.headers.get('content-type') || '';
  let data;
  if (contentType.includes('application/json')) {
    data = await res.json().catch(() => null);
  } else {
    data = await res.text().catch(() => null);
  }
  return { status: res.status, headers: res.headers, data };
}

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(3456, () => resolve());
  });
});

after(async () => {
  await new Promise((resolve) => {
    server.close(() => resolve());
  });
});

test('GET /api/settings - Debe retornar la configuracion de la institucion', async () => {
  const res = await request('/api/settings');
  assert.equal(res.status, 200);
  assert.ok(res.data.university_name);
});

test('PUT /api/settings - Debe actualizar el nombre de la universidad', async () => {
  const res = await request('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ university_name: 'Universidad Dark-Moon Test' })
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.university_name, 'Universidad Dark-Moon Test');
});

test('CRUD de Periodos Academicos', async () => {
  // Crear periodo
  const createRes = await request('/api/periods', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Periodo 2026-T1', start_date: '2026-02-01', end_date: '2026-06-30' })
  });
  assert.equal(createRes.status, 201);
  const periodId = createRes.data.id;
  assert.ok(periodId);

  // Listar periodos
  const listRes = await request('/api/periods');
  assert.equal(listRes.status, 200);
  const created = listRes.data.find((p) => p.id === periodId);
  assert.ok(created);
  assert.equal(created.name, 'Periodo 2026-T1');

  // Actualizar periodo
  const updateRes = await request('/api/periods/' + periodId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Periodo 2026-T1 Editado', start_date: '2026-02-15', end_date: '2026-07-15' })
  });
  assert.equal(updateRes.status, 200);

  // Eliminar periodo
  const delRes = await request('/api/periods/' + periodId, { method: 'DELETE' });
  assert.equal(delRes.status, 200);
});

test('CRUD de Categorias y validacion de nombres unicos', async () => {
  const catName = 'TestCat_' + Date.now();
  const createRes = await request('/api/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: catName, color: '#10B981' })
  });
  assert.equal(createRes.status, 201);
  const catId = createRes.data.id;

  // Intentar crear duplicada debe fallar con 400
  const dupRes = await request('/api/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: catName, color: '#DC2626' })
  });
  assert.equal(dupRes.status, 400);

  // Limpiar
  await request('/api/categories/' + catId, { method: 'DELETE' });
});

test('CRUD de Asignaturas, Actividades y verificacion de Bugfix de Actualizacion Parcial', async () => {
  // 1. Crear Asignatura
  const subRes = await request('/api/subjects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Estructuras de Datos',
      code: 'ED-101',
      teacher: 'Prof. Alan Turing',
      total_grade_value: 100
    })
  });
  assert.equal(subRes.status, 201);
  const subjectId = subRes.data.id;

  // 2. Crear Actividad con peso del 30% y nota total de 100
  const actRes = await request('/api/subjects/' + subjectId + '/activities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Parcial 1 Arboles',
      activity_type: 'Examen',
      due_date: '2026-03-20',
      weight: 30,
      grade_total: 100,
      status: 'pendiente'
    })
  });
  assert.equal(actRes.status, 201);
  const activityId = actRes.data.id;

  // 3. BUGFIX TEST: Actualizar parcialmente solo el progreso/nota sin enviar weight ni grade_total
  const partialUpdateRes = await request('/api/subjects/' + subjectId + '/activities/' + activityId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grade_obtained: 90,
      status: 'aprobado',
      submitted_at: '2026-03-19'
    })
  });
  assert.equal(partialUpdateRes.status, 200);

  // 4. Verificar que weight siga siendo 30 y grade_total siga siendo 100
  const metricsRes = await request('/api/subjects/' + subjectId);
  assert.equal(metricsRes.status, 200);
  const updatedActivity = metricsRes.data.activities.find((a) => a.id === activityId);
  assert.ok(updatedActivity, 'La actividad debe existir');
  assert.equal(updatedActivity.weight, 30, 'El peso (weight) NO debe haberse reseteado a 0');
  assert.equal(updatedActivity.grade_total, 100, 'La nota total (grade_total) NO debe haberse reseteado');
  assert.equal(updatedActivity.grade_obtained, 90);
  assert.equal(updatedActivity.status, 'aprobado');

  // 5. Verificar calculo de metricas ponderadas
  // 90/100 * 30% = 27 puntos
  // Nota final ponderada = (27 / 30) * 100 = 90%
  assert.equal(metricsRes.data.weight_total, 30);
  assert.equal(metricsRes.data.completed_weight, 30);
  assert.equal(Math.round(metricsRes.data.final_grade_percent), 90);
  assert.equal(Math.round(metricsRes.data.final_grade_value), 90);

  // 6. MODIFICACIÓN RETROACTIVA: Modificar docente y valor de aprobación
  const updateSubRes = await request('/api/subjects/' + subjectId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Estructuras de Datos Avanzadas',
      code: 'ED-102',
      teacher: 'Dra. Ada Lovelace',
      total_grade_value: 100,
      passing_grade_value: 70
    })
  });
  assert.equal(updateSubRes.status, 200);
  assert.equal(updateSubRes.data.teacher, 'Dra. Ada Lovelace');
  assert.equal(updateSubRes.data.passing_grade_value, 70);
  assert.equal(updateSubRes.data.passing_target_percent, 70);

  // Limpiar
  await request('/api/subjects/' + subjectId, { method: 'DELETE' });
});

test('GET /api/calendar/unified - Debe incluir eventos y actividades con fecha limite', async () => {
  // Crear una materia con entrega para probar
  const sub = await request('/api/subjects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Materia Calendario Test' })
  });
  const act = await request('/api/subjects/' + sub.data.id + '/activities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Entrega Proyecto Calendario',
      due_date: '2026-04-15',
      activity_type: 'Proyecto'
    })
  });

  const res = await request('/api/calendar/unified');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.data));

  const foundActivityEvent = res.data.find((item) => item.item_type === 'actividad' && item.title === 'Entrega Proyecto Calendario');
  assert.ok(foundActivityEvent, 'El calendario unificado debe contener las entregas de actividades');
  assert.equal(foundActivityEvent.event_date, '2026-04-15');

  // Limpiar
  await request('/api/subjects/' + sub.data.id, { method: 'DELETE' });
});

test('GET /api/export - Debe generar el respaldo JSON completo', async () => {
  const res = await request('/api/export');
  assert.equal(res.status, 200);
  assert.ok(res.data.version);
  assert.ok(res.data.exported_at);
  assert.ok(Array.isArray(res.data.periods));
  assert.ok(Array.isArray(res.data.subjects));
  assert.ok(Array.isArray(res.data.activities));
  assert.ok(Array.isArray(res.data.categories));
  assert.ok(Array.isArray(res.data.events));
});

test('POST /api/import - Debe importar respaldo JSON en modo merge y replace', async () => {
  const sampleBackup = {
    version: '2.0.0',
    exported_at: new Date().toISOString(),
    data: {
      periods: [{ id: 991, name: 'Periodo Importado Test', start_date: '2026-01-01', end_date: '2026-06-30' }],
      categories: [{ id: 992, name: 'Cat Importada', color: '#8B5CF6' }],
      subjects: [{ id: 993, period_id: 991, name: 'Materia Importada Test', code: 'MIT-101', teacher: 'Docente Importado', color: '#3B82F6', total_grade_value: 100 }],
      activities: [{ id: 994, subject_id: 993, title: 'Tarea Importada', activity_type: 'Taller', weight: 20, due_date: '2026-05-10', platform: 'GitHub', submission_link: 'https://github.com', feedback_notes: 'Excelente', status: 'presentado' }],
      events: [{ id: 995, title: 'Evento Importado', event_date: '2026-05-15', category_id: 992, event_time: '14:00', location: 'Aula Magna', link: 'https://unad.edu.co', description: 'Reunion' }]
    }
  };

  // 1. Probar modo Merge
  const mergeRes = await request('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'merge', payload: sampleBackup })
  });
  assert.equal(mergeRes.status, 200);
  assert.ok(mergeRes.data.success);

  // Verificar que la materia y actividad importadas existan con sus campos
  const subsRes = await request('/api/subjects');
  const importedSub = subsRes.data.find((s) => s.name === 'Materia Importada Test');
  assert.ok(importedSub, 'La materia importada debe existir');
  const importedAct = importedSub.activities.find((a) => a.title === 'Tarea Importada');
  assert.ok(importedAct, 'La actividad importada debe existir');
  assert.equal(importedAct.platform, 'GitHub');
  assert.equal(importedAct.submission_link, 'https://github.com');
  assert.equal(importedAct.feedback_notes, 'Excelente');

  // Limpiar materia importada
  if (importedSub) {
    await request('/api/subjects/' + importedSub.id, { method: 'DELETE' });
  }
});

test('PATCH /api/periods/:id/toggle-status y /api/subjects/:id/toggle-archive - Debe alternar estados de archivado', async () => {
  // 1. Crear periodo
  const pRes = await request('/api/periods', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Periodo Archivados Test' })
  });
  const periodId = pRes.data.id;

  // 2. Crear materia en ese periodo
  const sRes = await request('/api/subjects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Materia Archivados Test', period_id: periodId })
  });
  const subjectId = sRes.data.id;

  // 3. Alternar estado del periodo a archivado
  const togglePRes = await request(`/api/periods/${periodId}/toggle-status`, { method: 'PATCH' });
  assert.equal(togglePRes.status, 200);
  assert.equal(togglePRes.data.is_active, 0);

  // 4. Verificar que la materia reporte period_is_active = 0
  const subMetricsRes = await request(`/api/subjects/${subjectId}`);
  assert.equal(subMetricsRes.data.period_is_active, 0);

  // 5. Alternar archivado individual de la materia
  const toggleSRes = await request(`/api/subjects/${subjectId}/toggle-archive`, { method: 'PATCH' });
  assert.equal(toggleSRes.status, 200);
  assert.equal(toggleSRes.data.is_archived, 1);

  // Limpiar
  await request(`/api/subjects/${subjectId}`, { method: 'DELETE' });
  await request(`/api/periods/${periodId}`, { method: 'DELETE' });
});

test('GET /api/reports/excel - Debe retornar el archivo CSV con BOM UTF-8 y cabeceras correctas', async () => {
  const res = await request('/api/reports/excel');
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-type').includes('text/csv'));
  assert.ok(res.headers.get('content-disposition').includes('Reporte_Academico_Noctua_'));
  assert.ok(typeof res.data === 'string');
  assert.ok(res.data.includes('Periodo Académico'));
  assert.ok(res.data.includes('Asignatura'));
  assert.ok(res.data.includes('Promedio Acumulado (0.0 - 5.0)'));
});



