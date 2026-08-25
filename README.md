# 🦉 Noctua Academic - Suite de Control y Productividad Universitaria

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5.x-blue.svg)](https://expressjs.com/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL%20Mode-blueviolet.svg)](https://www.sqlite.org/)
[![Tests](https://img.shields.io/badge/Tests-10%2F10%20Passing-brightgreen.svg)]()
[![License](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc/4.0/)

**Noctua** es una plataforma web completa, rápida, autónoma y privada para el control académico universitario. Inspirada en el mochuelo de Atenea como símbolo universal del conocimiento y el rigor académico, permite planificar periodos académicos, simular y calcular calificaciones en escala `0.0 a 5.0`, adjuntar evidencias de entrega (Drive, GitHub, OneDrive, Teams), generar reportes en **Excel** y **PDF**, y consultar calendarios con alertas de urgencia temporal, respaldado por una base de datos local SQLite de alto rendimiento.

---

## ✨ Características Principales

### 📊 Gestión de Notas y Simulación Académica
- **Escala de Calificación Universitaria:** Conversión automática y proyección en escala `0.0 a 5.0`.
- **Edición en Línea (*Inline Editing*):** Digita tus notas directamente en la tabla y presiona `Enter` para actualizar tu promedio al instante.
- **Simulador de Aprobación:** Te indica si vas aprobando (`≥ 3.0 / 5.0`) y cuánto puntaje exacto necesitas en las evaluaciones restantes.
- **Ciclo de Vida de Evaluaciones:**
  - `🟡 Pendiente`: Planificación de actividades sin exigir nota previa.
  - `📨 Entregada`: Registro de evidencias y fecha de entrega (en espera de calificación docente).
  - `⭐ Calificada`: Nota definitiva o calificación inmediata para exámenes y quizzes virtuales.

### 📦 Reportes y Exportación de Datos
- **Planilla en Excel (`.csv` UTF-8 con BOM):** Descarga con un clic un reporte estructurado de todas tus asignaturas, actividades, pesos, notas y evidencias, listo para abrir en Microsoft Excel o Google Sheets.
- **Boletín Oficial en PDF:** Formato membretado con resumen consolidado y desglose de notas, optimizado para impresión directa o guardado como PDF (`Ctrl + P`).
- **Respaldo JSON Integral con Drag & Drop:** Exporta tu base de datos completa y restáurala arrastrando el archivo en modos **Combinar (*Merge*)** o **Reemplazo Total (*Replace*)**.

### ⚡ Productividad y Usabilidad
- **Franja Superior de Avance (*Progress Strip*):** Barra fija horizontal que resume tu progreso y materias activas.
- **Sistema de Archivado de Semestres:** Archiva periodos pasados para mantener la franja superior enfocada únicamente en tus materias en curso.
- **Protección de Cambios No Guardados:** Botón indicador de sincronización y alerta nativa `beforeunload` para evitar pérdida accidental de información al cerrar o recargar.
- **Calendario Unificado:** Semáforo de urgencias (🔴 Crítico ≤ 3 días, 🟡 Próximo ≤ 7 días, 🟢 Habilitado) para parciales y entregas.
- **🎨 Modo Oscuro y Claro:** Tema visual nativo con persistencia local.

---

## 📁 Estructura del Proyecto

```text
noctua-academic/
├── data/
│   └── university.db       # Base de datos SQLite local (modo WAL)
├── public/                 # Interfaz de usuario Single Page Application (SPA)
│   ├── index.html          # Estructura semántica, modales y plantilla PDF
│   ├── styles.css          # Variables CSS, diseño responsivo y reglas @media print
│   └── app.js              # Lógica de cliente, modales, validaciones y exportaciones
├── test/
│   └── api.test.js         # Suite de 10 pruebas unitarias e integración con node:test
├── server.js               # Servidor Express, API REST, SQLite y reportes Excel
├── package.json            # Metadatos del proyecto y scripts
├── README.md               # Documentación general en español
└── LICENSE                 # Licencia CC BY-NC 4.0
```

---

## 🚀 Requisitos Previos

- **Node.js** v18.0.0 o superior (Recomendado v20+ o v24+)
- **npm** v8.0.0 o superior

---

## 💻 Instalación y Puesta en Marcha

1. **Clonar el repositorio:**
   ```bash
   git clone https://github.com/jose16d/noctua-academic.git
   cd noctua-academic
   ```

2. **Instalar dependencias:**
   ```bash
   npm install
   ```

3. **Iniciar el servidor:**
   ```bash
   # Modo desarrollo (con recarga en vivo):
   npm run dev

   # Modo estándar:
   npm start
   ```

4. **Abrir en el navegador:**
   Accede a [http://localhost:3000](http://localhost:3000).

---

## 🧪 Ejecución de Pruebas Automatizadas

El proyecto cuenta con cobertura completa usando el ejecutor nativo de Node.js:

```bash
npm test
```

**Validaciones incluidas (10 de 10 tests):**
1. Configuración institucional y nombres de universidad.
2. Operaciones CRUD completas de periodos académicos.
3. Validación de unicidad de categorías.
4. CRUD de asignaturas y actividades con actualización parcial segura.
5. Calendario unificado de actividades y eventos académicos.
6. Exportación de respaldo completo en JSON.
7. Importación y resolución de claves foráneas en modos *Merge* y *Replace*.
8. Alternancia de estado y archivado de semestres (`PATCH /api/periods/:id/toggle-status`).
9. Archivado individual de asignaturas (`PATCH /api/subjects/:id/toggle-archive`).
10. Generación de planilla Excel con BOM UTF-8 (`GET /api/reports/excel`).

---

## 📜 Licencia

Este proyecto está bajo la licencia **Creative Commons Atribución-NoComercial 4.0 Internacional (CC BY-NC 4.0)**.
Eres libre de usar, estudiar, modificar y compartir este software para fines formativos y personales no comerciales, manteniendo la atribución correspondiente.



