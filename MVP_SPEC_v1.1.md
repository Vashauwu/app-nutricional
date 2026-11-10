# MVP_SPEC.md

## Especificación maestra del MVP --- Plataforma de gestión nutricional

**Versión:** 1.1\
**Estado:** Alcance funcional y técnico consolidado; sujeto a validación
final de implementación.\
**Idioma y región:** Español (México).\
**Objetivo:** Construir una plataforma web para que una nutrióloga
gestione pacientes, expedientes, platillos, equivalentes SMAE, planes
alimentarios, seguimiento y reportes. Los pacientes consultan sus planes
desde una experiencia web responsive/PWA.

------------------------------------------------------------------------

# 1. Visión y alcance

La plataforma permitirá a una nutrióloga administrar el ciclo de
atención nutricional: alta de pacientes, captura de información clínica
y antropométrica, creación de platillos, cálculo nutricional con SMAE,
elaboración de menús mediante calendario, publicación para pacientes,
seguimiento y análisis de evolución.

El MVP inicia con una sola nutrióloga administradora. La arquitectura
deberá permitir evolucionar a múltiples nutriólogas y organizaciones,
pero **no se implementará multi-tenant en esta etapa**.

## 1.1 Objetivos del MVP

-   Centralizar expedientes y mediciones de pacientes.
-   Mantener una biblioteca reutilizable de platillos y recetas.
-   Calcular energía, macronutrientes y equivalentes SMAE.
-   Crear y editar planes alimentarios con un calendario drag & drop.
-   Publicar planes en una PWA para pacientes.
-   Recopilar seguimiento de comidas, fotografías y comentarios.
-   Mostrar evolución antropométrica, cumplimiento y reportes.
-   Proteger los datos personales y clínicos.
-   Mantener trazabilidad de cambios, versiones y cálculos.

## 1.2 Fuera del alcance inicial

-   Multi-tenancy y operación de varias nutriólogas.
-   Registro y atención de menores de 18 años.
-   Notificaciones por correo, push o recordatorios.
-   Chat independiente; la comunicación se limita a comentarios
    asociados a tiempos de comida.
-   MFA obligatorio en el MVP.
-   Administración visual de permisos individuales.
-   Automatizaciones clínicas que sustituyan el criterio profesional.
-   Integraciones externas no definidas expresamente.

------------------------------------------------------------------------

# 2. Usuarios, roles y autorización

## 2.1 Roles iniciales

**Nutrióloga** - Gestiona pacientes y expedientes. - Crea y administra
platillos y recetas. - Administra el catálogo SMAE disponible en la
plataforma. - Crea plantillas y planes alimentarios. - Publica, finaliza
y archiva planes. - Consulta seguimiento, alertas, reportes y
auditoría. - Configura identidad visual, cuotas y parámetros de la
plataforma.

**Paciente** - Consulta exclusivamente su propia información
autorizada. - Consulta planes vigentes e historial disponible. -
Consulta platillos, recetas, sustituciones e indicaciones. - Registra
comidas, fotografías y comentarios. - Consulta sus mediciones y
evolución cuando la nutrióloga lo habilite. - No puede acceder a notas
privadas ni a expedientes de otros pacientes.

## 2.2 Modelo de permisos

-   Implementar RBAC (Role-Based Access Control) desde el MVP.
-   Los permisos iniciales estarán asociados a roles.
-   Preparar la arquitectura para permisos granulares por usuario, sin
    construir su interfaz administrativa en el MVP.
-   Validar autorización en el backend en cada operación; ocultar
    controles en Angular no constituye seguridad.
-   Aplicar aislamiento estricto entre pacientes y pruebas contra
    accesos cruzados.
-   Las notas privadas de la nutrióloga nunca serán visibles para
    pacientes.

------------------------------------------------------------------------

# 3. Pacientes y expediente clínico

## 3.1 Alta de pacientes

La nutrióloga podrá: - Registrar pacientes manualmente. - Invitar a
pacientes para que completen su registro. - Consultar, editar,
desactivar y restaurar registros según permisos. - Buscar pacientes por
nombre, correo, teléfono, estado y objetivo.

El MVP estará limitado a pacientes adultos. El flujo de menores de edad
se desarrollará en una etapa posterior, incluyendo tutor y
autorizaciones correspondientes.

## 3.2 Datos del expediente

**Datos personales** - Nombre. - Fecha de nacimiento. - Sexo. - Correo
electrónico. - Teléfono.

**Antropometría** - Peso. - Talla. - IMC. - Circunferencia de cintura. -
Circunferencia de cadera. - Porcentaje de grasa corporal.

Las mediciones deben tener fecha. El historial antropométrico será
acumulativo: una medición nueva no sobrescribe las anteriores.

**Información clínica** - Enfermedades y condiciones relevantes. -
Alergias. - Medicamentos. - Antecedentes. - Indicaciones clínicas.

**Objetivos y preferencias** - Objetivo nutricional, por ejemplo pérdida
de peso, ganancia muscular o mantenimiento. - Alimentos favoritos. -
Restricciones y alimentos que no consume. - Preferencias alimentarias.

**Notas** - Notas privadas de la nutrióloga. - Evolución y observaciones
clínicas.

## 3.3 Documentos clínicos

-   Permitir adjuntar PDF al expediente.
-   Registrar nombre, categoría, fecha y descripción.
-   Almacenar de forma privada.
-   Permitir vista previa y descarga segura.
-   Registrar quién cargó o modificó el documento.
-   Aplicar límite configurable de tamaño.
-   El acceso del paciente será opcional y autorizado por la nutrióloga.
-   Aplicar eliminación lógica y trazabilidad.

------------------------------------------------------------------------

# 4. Consentimiento, privacidad y protección de datos

## 4.1 Documentos y aceptación

Incluir: 1. Aviso de privacidad. 2. Consentimiento informado para la
atención nutricional.

Deben ser documentos diferenciados, configurables y versionados.

Registrar: - Identidad del paciente que acepta. - Documento y versión
aceptados. - Fecha y hora. - Evidencia de aceptación. - Revocaciones y
solicitudes relacionadas con datos personales.

El paciente deberá completar las aceptaciones correspondientes antes de
iniciar la captura clínica. La nutrióloga podrá crear previamente el
registro administrativo, pero el expediente clínico permanecerá
restringido hasta cumplir este requisito.

Las obligaciones legales concretas, textos y mecanismos de
consentimiento deberán validarse con asesoría jurídica especializada en
protección de datos y atención sanitaria en México antes de producción.

## 4.2 Privacidad y seguridad

-   Datos clínicos, documentos y fotografías de seguimiento en
    almacenamiento privado.
-   Autorización del backend por recurso y paciente.
-   URLs firmadas de corta duración o endpoints autenticados para
    archivos privados.
-   No exponer rutas ni identificadores internos sensibles.
-   Cifrado en tránsito mediante HTTPS.
-   Gestión segura de secretos y credenciales.
-   Registro de eventos relevantes de seguridad.
-   Procedimientos de respaldo y restauración.

------------------------------------------------------------------------

# 5. Autenticación y sesiones

## 5.1 Autenticación

-   Correo y contraseña.
-   Contraseñas almacenadas con Argon2id.
-   JWT mediante cookies HttpOnly, Secure y SameSite.
-   Access token de corta duración.
-   Refresh tokens con rotación y revocación.
-   Protección CSRF cuando corresponda.
-   No almacenar tokens en localStorage ni sessionStorage.

## 5.2 Recuperación de contraseña

-   Enlace enviado al correo registrado.
-   Token criptográficamente seguro, de un solo uso y con expiración
    configurable; valor inicial recomendado: 30 minutos.
-   Invalidación del token tras el cambio.
-   Respuesta genérica para no revelar si una cuenta existe.
-   Notificación de cambio de contraseña.

El envío de correo requiere integrar un proveedor transaccional,
pendiente de selección.

## 5.3 Sesiones simultáneas

-   Permitir sesiones en varios dispositivos.
-   Registrar dispositivo, navegador, fecha de acceso y última
    actividad.
-   Consultar sesiones activas.
-   Cerrar una sesión individual.
-   Cerrar todas las demás sesiones.
-   Revocar refresh tokens al cerrar sesión.

## 5.4 MFA

MFA no será obligatorio en el MVP. Se deja como trabajo pendiente,
manteniendo la arquitectura extensible para incorporar: - TOTP mediante
aplicación autenticadora. - Códigos de recuperación. - Administración de
dispositivos confiables. - Políticas diferenciadas por rol.

------------------------------------------------------------------------

# 6. Biblioteca de platillos y recetas

## 6.1 Biblioteca

La nutrióloga podrá crear, consultar, editar, duplicar, desactivar y
buscar platillos.

Filtros: - Nombre. - Ingredientes. - Categoría. - Grupo SMAE.

Los platillos podrán reutilizarse en múltiples planes.

## 6.2 Información del platillo

El modelo deberá contemplar, como mínimo: - Nombre y descripción. -
Fotografía. - Categoría y etiquetas. - Ingredientes y cantidades. -
Unidad de medida. - Rendimiento o número de porciones. - Instrucciones
de preparación. - Valores de energía y macronutrientes. - Equivalentes
SMAE por grupo y subgrupo. - Sustitutos autorizados. - Recomendaciones u
observaciones. - Estado y versión.

Los campos definitivos y su obligatoriedad deberán cerrarse durante el
diseño de UX y modelo de datos.

## 6.3 Modalidades de receta

Se admiten dos modalidades: - **Texto libre:** instrucciones y
descripción redactadas por la nutrióloga. - **Receta estructurada:**
ingredientes, cantidades, pasos numerados, tiempo de preparación y
porciones.

Ambas pueden incluir fotografías. Cuando existan ingredientes y
cantidades estructurados, los cálculos nutricionales deberán derivarse
de esos datos.

------------------------------------------------------------------------

# 7. Catálogo SMAE y motor nutricional

## 7.1 Catálogo

-   Catálogo local de alimentos, porciones, grupos y subgrupos,
    equivalentes y composición nutricional.
-   Registrar edición, fuente y versión del catálogo.
-   La edición de referencia definida para el MVP es SMAE 4.ª edición,
    sujeta a confirmar disponibilidad y derechos de uso.
-   La importación de una base licenciada deberá respetar los términos
    del titular. No se asumirá que el contenido del libro puede copiarse
    o redistribuirse libremente.
-   Los alimentos personalizados podrán incluir valores nutricionales
    propios y deberán distinguirse claramente de los alimentos oficiales
    del catálogo.

## 7.2 Motor nutricional

Implementar un módulo independiente `nutrition_engine`, reutilizable
por: - Biblioteca de platillos. - Calendario y distribución diaria. -
Sustituciones. - Comparación de objetivos. - Reportes.

Funciones: - Cálculo de energía, proteínas, carbohidratos y lípidos. -
Conversión de cantidades y porciones. - Cálculo y agregación de
equivalentes. - Distribución de equivalentes por día y tiempo de
comida. - Comparación de valores planeados y calculados. - Reglas y
tolerancias configurables. - Propuestas de objetivos diarios según
requerimientos, ajustables por la nutrióloga.

La herramienta brinda apoyo al profesional; no reemplaza su juicio
clínico.

## 7.3 Precisión decimal

Política numérica: - PostgreSQL `NUMERIC` sin escala fija impuesta a
nivel de columna. - No usar `REAL` ni `DOUBLE PRECISION` para cálculos
nutricionales. - Conservar valores originales y resultados calculados. -
Sumas y multiplicaciones sin redondeo intermedio. - Divisiones con
precisión de 16 decimales. - Regla de redondeo técnico: **Round Half
Even**. - La regla se aplica cuando una operación necesita limitar
decimales; no modifica los datos originales. - La interfaz mostrará como
mínimo dos decimales, según tipo de dato, sin alterar el valor
almacenado. - API REST serializará decimales como strings. - Angular
utilizará una librería decimal para operaciones nutricionales; no usar
`Number` para estos cálculos. - Las exportaciones conservarán la
precisión disponible.

En resultados matemáticos infinitos, como 1/3, 16 decimales representan
una aproximación finita. La implementación deberá documentar la
precisión y el comportamiento de la librería elegida.

Tecnologías sugeridas: - Go: `github.com/shopspring/decimal`. -
PostgreSQL: `NUMERIC`. - Angular: `decimal.js` o alternativa
equivalente. - SQLC + pgx con conversión explícita y probada entre
`NUMERIC` y decimal.

## 7.4 Versiones SMAE y recalculación

Cada ingrediente y platillo conservará: - Cantidad y valor original. -
Valores calculados. - Edición y versión del catálogo SMAE utilizado. -
Datos necesarios para reproducir el cálculo.

Al actualizar o corregir el catálogo: 1. Detectar platillos afectados.
2. Calcular diferencias nutricionales y de equivalentes. 3. Mostrar
comparación entre valores anteriores y nuevos. 4. Solicitar autorización
de la nutrióloga. 5. Registrar la decisión y su responsable.

No se actualizarán platillos ni planes publicados sin autorización.

Cada modificación autorizada generará una nueva versión inmutable del
platillo. Las versiones anteriores permanecerán consultables y los
planes históricos conservarán la versión que tenían asignada.

------------------------------------------------------------------------

# 8. Sustituciones de alimentos y platillos

-   Permitir sustitutos manuales registrados por la nutrióloga.
-   Permitir sugerencias automáticas basadas en equivalentes SMAE.
-   La nutrióloga revisa y ajusta las sugerencias.
-   El paciente solo consulta alternativas autorizadas; no modifica la
    composición nutricional.
-   Una sustitución en un plan publicado reemplaza inmediatamente el
    platillo visible al paciente.
-   El platillo anterior permanece en el historial del plan.
-   Registrar responsable, fecha, versión anterior y nueva.
-   Los seguimientos previos permanecen asociados al platillo y versión
    originales.

------------------------------------------------------------------------

# 9. Calendario y editor de planes

## 9.1 Estructura

-   Calendario por días y tiempos de comida.
-   Tiempos predeterminados: desayuno, colación matutina, comida,
    colación vespertina y cena.
-   Permitir tiempos personalizados.
-   Cada tiempo puede contener varios platillos.
-   Duración flexible: días específicos, semanas completas o periodos
    personalizados con fechas de inicio y término.

La semana lunes-domingo se propone como valor inicial y debe confirmarse
en UX.

## 9.2 Funciones drag & drop

-   Arrastrar platillos de la biblioteca a cualquier día y tiempo.
-   Reordenar platillos mediante drag & drop.
-   Copiar un platillo a otros días.
-   Duplicar un día completo.
-   Duplicar una semana completa.
-   Mover platillos entre días y tiempos.
-   Eliminar platillos.
-   Visualizar energía y macros por comida y día.
-   Visualizar equivalentes SMAE acumulados por día.

## 9.3 Guardado y resiliencia

-   Autoguardado con debounce.
-   Indicadores: guardando, guardado y error.
-   Deshacer cambios recientes.
-   Recuperación ante pérdida de conexión.
-   Control de concurrencia.
-   Persistencia del orden de platillos.
-   Confirmación al salir si existen cambios pendientes.
-   Recuperación de operaciones pendientes cuando vuelva la conexión.
-   Evitar sobrescrituras silenciosas ante ediciones concurrentes.

------------------------------------------------------------------------

# 10. Plantillas

-   Plantillas globales reutilizables.
-   Plantillas específicas por paciente.
-   Duplicar plantillas para crear nuevos planes.
-   Los planes asignados conservan una copia independiente.
-   Modificar una plantilla no modifica planes previamente asignados.

Queda pendiente definir la granularidad de las plantillas: semana
completa, día, tiempo de comida o combinaciones.

------------------------------------------------------------------------

# 11. Estados y ciclo de vida de planes

Estados: - **Borrador:** solo visible para la nutrióloga. -
**Publicado:** visible para el paciente. - **Finalizado:** histórico, ya
no es el plan vigente. - **Archivado:** fuera de operación habitual,
pero conservado.

Reglas: - Los cambios en un menú publicado se reflejan inmediatamente en
la vista del paciente. - Las sustituciones conservan historial. -
Registrar auditoría y fecha de modificación. - Al terminar el periodo,
el plan pasa a finalizado. - La nutrióloga decide manualmente cuándo
crear/asignar el siguiente plan. - Puede duplicar el último plan como
base. - El nuevo plan es independiente; editarlo no cambia el anterior.

Pendiente de definición: si se conservarán snapshots completos de cada
publicación o si bastará el historial de versiones y eventos. Se
recomienda snapshot de publicación para reconstrucción exacta del menú
que vio el paciente.

------------------------------------------------------------------------

# 12. Experiencia del paciente

## 12.1 Acceso

-   Aplicación web responsive/PWA.
-   Acceso con cuenta y contraseña.
-   También se contempla enlace privado con token único y revocable; la
    expiración y alcance exactos deberán definirse antes de producción.
-   El paciente solo puede consultar sus propios datos y los recursos
    que la nutrióloga haya autorizado.

## 12.2 Consulta de plan

-   Vista diaria y semanal.
-   Tarjetas de platillos optimizadas para móvil.
-   Fotografía.
-   Ingredientes y cantidades.
-   Preparación.
-   Porciones y equivalentes SMAE.
-   Energía y macronutrientes.
-   Sustitutos autorizados.
-   Recomendaciones y observaciones.
-   Indicaciones especiales del día.

## 12.3 Seguimiento

El paciente podrá: - Marcar cada comida como realizada, omitida o
pendiente. - Subir fotografías. - Agregar comentarios por tiempo de
comida. - Consultar porcentaje de cumplimiento diario y semanal.

La nutrióloga podrá: - Consultar los registros desde el expediente. -
Responder comentarios asociados al tiempo de comida. - Consultar
fotografías y actividad.

Cada registro se vincula a la versión exacta del platillo asignado en
ese momento. Las sustituciones posteriores no alteran registros
anteriores.

El cumplimiento se reporta por separado de la evolución antropométrica.

## 12.4 Comunicación

-   Comentarios asociados a tiempos de comida.
-   Paciente comenta y nutrióloga responde.
-   Historial de conversación por tiempo de comida.
-   No habrá chat independiente en el MVP.

## 12.5 Modo offline

La PWA permitirá consulta offline de menús previamente cargados,
incluyendo fotografías, ingredientes, preparación y equivalentes. El
registro de seguimiento y comentarios requerirá conexión.

-   Indicador de conexión.
-   Fecha/hora de última sincronización.
-   Actualización de cambios de la nutrióloga al reconectar.
-   Service Worker y estrategia de caché.
-   No almacenar en caché información clínica privada más allá de lo
    estrictamente necesario; definir expiración, borrado al cerrar
    sesión y protección del dispositivo.

------------------------------------------------------------------------

# 13. Dashboard de nutrióloga

Incluir: - Resumen de pacientes. - Estado de planes. - Cumplimiento. -
Alertas nutricionales. - Actividad reciente: fotografías, comentarios y
registros. - Accesos rápidos para crear paciente, platillo y plan.

Los indicadores deberán permitir navegación al registro o expediente que
origina cada dato.

------------------------------------------------------------------------

# 14. Alertas nutricionales

Detectar: - Ingredientes que coincidan con alergias. - Alimentos
restringidos o que el paciente no consume. - Conflictos con indicaciones
clínicas registradas. - Desviaciones respecto a objetivos de energía,
macros y equivalentes.

Niveles: - Informativa. - Advertencia. - Crítica.

Cada alerta debe explicar el motivo y el dato que la originó. Las
alertas apoyan la revisión profesional y no bloquean automáticamente la
publicación.

Las reglas clínicas y umbrales deberán ser configurables y validados por
la nutrióloga; no inferir diagnósticos.

------------------------------------------------------------------------

# 15. Reportes y exportaciones

## 15.1 Reportes

-   Evolución antropométrica: peso, IMC, cintura, cadera y porcentaje de
    grasa.
-   Cumplimiento diario y semanal.
-   Energía y macros planeados frente a registrados.
-   Comparativas entre periodos.
-   Progreso respecto a objetivos.
-   Exportación de reportes a PDF.

## 15.2 Exportación de datos

-   Excel y CSV para expedientes, mediciones, seguimiento y
    estadísticas.
-   PDF para planes y reportes.
-   Aplicar permisos y protección de datos.
-   Registrar exportaciones sensibles en auditoría.

------------------------------------------------------------------------

# 16. Búsqueda y filtros

**Pacientes:** nombre, correo, teléfono, estado y objetivo.\
**Platillos:** nombre, ingredientes, categoría y grupo SMAE.\
**Planes:** paciente, estado y fechas.\
**Seguimiento:** cumplimiento, alertas y actividad.

Implementar búsqueda con debounce, filtros en backend y paginación.

------------------------------------------------------------------------

# 17. Auditoría y eliminación lógica

## 17.1 Auditoría

Auditoría interna, no visible para pacientes. Registrar: - Creaciones,
modificaciones y eliminaciones lógicas. - Cambios en expedientes. -
Cambios en platillos y versiones. - Publicaciones y modificaciones de
planes. - Sustituciones. - Cambios de consentimiento. - Eventos
relevantes de autenticación y seguridad. - Exportaciones sensibles.

Registrar actor, acción, recurso, fecha/hora y datos necesarios para
reconstruir el evento, evitando guardar secretos o datos innecesarios.

## 17.2 Soft delete

-   No borrar físicamente registros clínicos desde las operaciones
    normales.
-   Pacientes pueden desactivarse.
-   Platillos pueden marcarse inactivos.
-   Planes y seguimientos conservan historia.
-   Los elementos eliminados lógicamente no aparecen en consultas
    habituales.
-   La nutrióloga podrá consultar/restaurar cuando corresponda.
-   La conservación y eventual supresión definitiva deberán respetar
    obligaciones legales y políticas de retención aplicables.

------------------------------------------------------------------------

# 18. Almacenamiento y archivos

## 18.1 Arquitectura

Separar: - Archivos públicos controlados: fotografías de platillos y
recursos de identidad visual autorizados. - Archivos privados:
fotografías de seguimiento, documentos clínicos y archivos del
expediente.

Almacenamiento de objetos compatible con S3, por ejemplo R2, S3 o MinIO.
La elección del proveedor queda pendiente.

Los metadatos y relaciones se almacenan en PostgreSQL. Organizar
archivos por tipo, paciente y fecha, sin depender de rutas expuestas al
usuario.

## 18.2 Cuotas

-   Cuota predeterminada configurable globalmente.
-   Asignación automática al registrar pacientes.
-   Ampliaciones individuales autorizadas por la nutrióloga.
-   Medición de espacio usado y disponible.
-   Alertas por umbrales configurables.
-   Validación antes de aceptar nuevas cargas.

## 18.3 Imágenes

-   Aceptar JPG, PNG, WebP y HEIC.
-   Conversión interna a WebP.
-   Redimensionamiento hasta 1920 × 1080 px como referencia, conservando
    proporciones.
-   Compresión automática.
-   Miniaturas.
-   Validación de formato, tamaño y archivos corruptos.
-   Procesamiento asíncrono cuando convenga.
-   Fotografías clínicas y de seguimiento siempre privadas.
-   Límite inicial propuesto: 10 MB por archivo, configurable.

## 18.4 Documentos

-   PDF para documentos clínicos.
-   Límite configurable.
-   Validación real del tipo de archivo y análisis de seguridad antes de
    habilitar descarga.
-   Acceso privado y registro de actividad.

------------------------------------------------------------------------

# 19. Configuración regional e identidad visual

## 19.1 Región

-   Idioma: español.
-   País: México.
-   Moneda: MXN.
-   Peso: kg.
-   Estatura y perímetros: cm.
-   Ingredientes: g, ml y medidas caseras.
-   Fecha: DD/MM/AAAA.
-   Zona horaria configurable; valor inicial sugerido:
    `America/Mexico_City`.

## 19.2 Marca de la nutrióloga

Configuración dinámica sin cambios de código: - Nombre comercial. -
Logotipo. - Colores principales y secundarios. - Fotografía
profesional. - Datos de contacto. - Credenciales y datos profesionales
para PDFs e impresiones.

## 19.3 Design system

Frontend con Taiga UI y un sistema visual propio personalizable. Paleta
base sugerida: - Rosa pastel `#F4C9D6`. - Verde salvia `#D7E8D5`. -
Lavanda `#DDD6F2`. - Amarillo mantequilla `#F8E8B8`. - Azul cielo
`#D8E8F2`. - Marfil `#FAF7F2`. - Texto ciruela grisáceo `#514653`. -
Bordes gris rosado `#E9E3E5`.

Tipografías sugeridas: Inter para interfaz y Playfair Display para
títulos destacados. Los colores pastel se usarán en superficies, no en
texto pequeño de bajo contraste.

------------------------------------------------------------------------

# 20. Accesibilidad, rendimiento y carga

## 20.1 Accesibilidad

Objetivo: WCAG 2.2 AA. - Contraste suficiente. - Navegación por
teclado. - Compatibilidad con lectores de pantalla. - Etiquetas en
formularios. - Foco visible. - Mensajes de error claros. - Texto
alternativo para imágenes. - Objetivos táctiles adecuados. - No depender
exclusivamente del color.

## 20.2 Carga de datos

Estrategia híbrida: - Paginación tradicional para pacientes,
expedientes, planes y reportes. - Carga progresiva para biblioteca y
catálogo SMAE. - Búsqueda con debounce. - Filtros en backend. - Límites
por petición. - Indicadores de carga y estados vacíos/error.

## 20.3 Rendimiento

-   Optimización de imágenes.
-   Miniaturas para listados.
-   Lazy loading de vistas y recursos.
-   Consultas indexadas y paginadas.
-   Evitar cargar expedientes completos en listados.
-   Procesamiento asíncrono para tareas pesadas.

------------------------------------------------------------------------

# 21. Arquitectura técnica

## 21.1 Stack confirmado

  Capa             Tecnología
  ---------------- ------------------------------
  Frontend         Angular 22
  UI               Taiga UI
  Drag & drop      Angular CDK
  Backend          Go
  Framework HTTP   Gin
  API              REST versionada
  Eventos          Server-Sent Events (SSE)
  Base de datos    PostgreSQL
  Acceso a datos   SQLC + pgx
  Migraciones      SQL versionado
  PWA              Angular Service Worker
  Archivos         Object storage S3-compatible
  Contenedores     Docker
  Proxy/TLS        Nginx o Caddy

## 21.2 Arquitectura de aplicación

Monolito modular: una API Go desplegable, con módulos separados por
dominio. No implementar microservicios en el MVP.

Patrón por módulo: - **Controller:** recibe peticiones, valida entrada y
responde HTTP. - **Service:** reglas de negocio y coordinación. -
**Repository:** acceso a datos. - **Model:** entidades y persistencia. -
**DTO:** contratos de entrada/salida. - **Interfaces:** desacoplamiento
y pruebas.

## 21.3 Módulos backend

``` text
backend/
├── cmd/api/main.go
├── internal/
│   ├── config/
│   ├── middleware/
│   ├── shared/
│   ├── auth/
│   ├── patients/
│   ├── dishes/
│   ├── smae/
│   ├── nutrition_engine/
│   ├── mealplans/
│   ├── tracking/
│   ├── reports/
│   ├── storage/
│   ├── audit/
│   └── settings/
├── migrations/
├── queries/
├── generated/
├── tests/
├── Dockerfile
└── go.mod
```

`notifications` puede reservarse como módulo futuro; no se implementan
notificaciones en el MVP.

## 21.4 Motor SMAE independiente

``` text
internal/
├── smae/
│   ├── model/
│   ├── repository/
│   ├── service/
│   └── controller/
└── nutrition_engine/
    ├── model/
    ├── calculator/
    ├── service/
    └── tests/
```

## 21.5 Frontend Angular

Arquitectura Feature-Based con Standalone Components y lazy loading:

``` text
frontend/src/app/
├── core/
│   ├── auth/
│   ├── guards/
│   ├── interceptors/
│   ├── services/
│   └── layout/
├── features/
│   ├── dashboard/
│   ├── patients/
│   ├── dishes/
│   ├── smae/
│   ├── meal-plans/
│   ├── tracking/
│   ├── reports/
│   └── settings/
├── shared/
│   ├── components/
│   ├── directives/
│   ├── pipes/
│   ├── models/
│   └── utils/
├── app.routes.ts
└── app.config.ts
```

-   Angular Signals para estado local y derivado.
-   `computed` para valores derivados.
-   `effect` solo para efectos secundarios.
-   RxJS para HTTP y flujos asíncronos.
-   Sin NgRx en el MVP.
-   Reactive Forms tipados y validadores personalizados.
-   Validación tanto en frontend como backend.

## 21.6 API

-   Prefijo `/api/v1`.
-   Recursos y subrecursos REST.
-   Ejemplos: `/api/v1/patients/{id}/measurements`,
    `/api/v1/meal-plans/{id}/days`.
-   JSON estandarizado.
-   Códigos HTTP coherentes.
-   Paginación, filtros y ordenamiento.
-   Errores uniformes.
-   DTO y validaciones documentados.

## 21.7 REST y SSE

-   REST para CRUD y fuente de verdad.
-   SSE para notificar actualizaciones de planes publicados, comentarios
    y seguimiento.
-   Reconexión y recuperación de eventos.
-   El cliente siempre podrá recuperar el estado mediante REST.
-   Implementar SSE con streaming HTTP y cancelación mediante contexto.

## 21.8 SQL y persistencia

-   SQL explícito con SQLC + pgx.
-   No utilizar ORM.
-   Migraciones SQL versionadas.
-   Transacciones coordinadas desde Services.
-   Pruebas de repositorios y transacciones.
-   Índices para filtros y relaciones frecuentes.
-   Soft delete y auditoría donde aplique.

## 21.9 OpenAPI

-   OpenAPI 3.x desde el inicio.
-   Documentar endpoints, parámetros, DTO, validaciones, ejemplos,
    códigos HTTP y errores.
-   Documentar autenticación mediante cookies y SSE.
-   Swagger UI.
-   Versionar el contrato de API.

------------------------------------------------------------------------

# 22. Pruebas y calidad

Estrategia: - Unitarias para reglas de negocio y motor nutricional. -
Integración con PostgreSQL real. - Pruebas de API y autorización. - E2E
de flujos críticos. - Seguridad: aislamiento entre pacientes, cookies,
CSRF, sesiones, cargas y descargas. - Rendimiento para calendario,
biblioteca y reportes.

CI en GitHub Actions: - Build. - Linter y análisis estático. - Pruebas
backend y frontend. - Migraciones. - Revisión de dependencias y
vulnerabilidades. - Build de producción. - E2E críticos.

No perseguir cobertura artificial; priorizar reglas críticas, cálculos y
permisos.

------------------------------------------------------------------------

# 23. Git y flujo de desarrollo

GitHub Flow: - `main` protegida. - Ramas `feature/*`, `fix/*` y
`docs/*`. - Pull Requests. - CI requerido antes de merge. - Conventional
Commits. - No realizar cambios directos a `main`.

------------------------------------------------------------------------

# 24. Ambientes y despliegue

## 24.1 Ambientes

-   Development local con Docker Compose.
-   Staging independiente.
-   Production independiente.
-   Variables, base de datos, almacenamiento y secretos separados.
-   Staging con datos sintéticos o anonimizados.
-   Migraciones controladas.

## 24.2 Infraestructura inicial

Arquitectura prevista: - VPS Contabo. - Dominio personalizado. - Angular
PWA. - API Go bajo `/api/v1`. - PostgreSQL. - Object storage
S3-compatible. - Docker. - Nginx o Caddy. - HTTPS.

Proveedor concreto de PostgreSQL y almacenamiento, dominio y estrategia
de despliegue quedan pendientes de selección.

## 24.3 Observabilidad

Nivel intermedio: - Logs estructurados con `slog`. - Request IDs. -
Métricas de disponibilidad, latencia, errores HTTP, CPU y memoria. -
Monitoreo de API, PostgreSQL y almacenamiento. - Alertas por errores
críticos, caídas y uso de recursos. - Dashboards. - Preparación para
OpenTelemetry.

## 24.4 Backups

-   Respaldo diario de PostgreSQL y archivos.
-   Copias fuera del VPS.
-   Retención configurable.
-   Registro de resultado.
-   Procedimiento documentado de restauración.
-   Ambientes separados.

Quedan para evolución: cifrado avanzado de respaldos, retención de 30
días, PITR, monitoreo automatizado y pruebas periódicas de restauración.
La implementación deberá definir cifrado y controles de acceso antes de
producción con datos reales.

------------------------------------------------------------------------

# 25. Trabajos pendientes y decisiones por cerrar

Esta sección funciona como backlog de definición y preparación. No todo
debe construirse en el MVP; distingue decisiones necesarias para
iniciar, tareas de implementación y mejoras futuras.

## 25.1 Pendientes bloqueantes antes de producción

-   [ ] Validar legalmente aviso de privacidad, consentimiento
    informado, retención, derechos ARCO y tratamiento de datos sensibles
    en México.
-   [ ] Confirmar derechos/licencia y condiciones de uso de la base
    SMAE; definir proceso autorizado de importación.
-   [ ] Elegir proveedor de correo transaccional para recuperación de
    contraseña e invitaciones.
-   [ ] Elegir proveedor de object storage S3-compatible.
-   [ ] Definir dominio, DNS, TLS y configuración de producción.
-   [ ] Definir cuota base de almacenamiento por paciente.
-   [ ] Confirmar límite inicial de 10 MB por archivo y límites para
    PDF.
-   [ ] Definir expiración y alcance de los enlaces privados de acceso.
-   [ ] Definir política de retención de documentos, fotografías,
    auditoría y respaldos.
-   [ ] Definir reglas clínicas y umbrales de alertas con validación
    profesional.
-   [ ] Validar estrategia de consentimiento y bloqueo de captura
    clínica.
-   [ ] Definir snapshot de publicación para reconstruir exactamente el
    menú visto por el paciente.

## 25.2 Pendientes de producto y UX

-   [ ] Confirmar los campos obligatorios y opcionales de un platillo.
-   [ ] Definir granularidad de plantillas: semana, día, tiempo de
    comida o combinaciones.
-   [ ] Confirmar calendario inicial lunes-domingo y zona horaria por
    defecto.
-   [ ] Diseñar flujos de alta manual e invitación de pacientes.
-   [ ] Diseñar experiencia de aceptación de aviso y consentimiento.
-   [ ] Definir reglas de visibilidad de mediciones y documentos para
    pacientes.
-   [ ] Definir estados visuales de alertas y revisión profesional.
-   [ ] Definir criterios de cálculo del porcentaje de cumplimiento.
-   [ ] Definir qué ocurre con comentarios y seguimiento si un plan se
    archiva.
-   [ ] Definir experiencia de conflictos de edición concurrente en el
    calendario.
-   [ ] Diseñar estados offline, sincronización y resolución de cambios
    pendientes.
-   [ ] Definir configuración de marca y previsualización de PDF.

## 25.3 Pendientes técnicos de implementación

-   [ ] Diseñar modelo entidad-relación completo.
-   [ ] Diseñar migraciones iniciales y convenciones de IDs.
-   [ ] Definir mapeo SQLC/pgx de `NUMERIC` a `shopspring/decimal`.
-   [ ] Implementar y probar Round Half Even con 16 decimales para
    divisiones.
-   [ ] Definir el comportamiento exacto de divisiones y operaciones
    encadenadas.
-   [ ] Implementar serialización JSON de decimales como strings.
-   [ ] Elegir librería decimal para Angular.
-   [ ] Implementar versionado inmutable de platillos.
-   [ ] Implementar versionado del catálogo SMAE y autorización de
    recálculo.
-   [ ] Implementar snapshots/versiones de publicación de planes.
-   [ ] Implementar RBAC y pruebas de aislamiento de pacientes.
-   [ ] Implementar recuperación de contraseña y sesiones
    multidispositivo.
-   [ ] Implementar cargas privadas, URLs firmadas y autorización de
    archivos.
-   [ ] Implementar conversión HEIC/JPG/PNG/WebP a WebP, miniaturas y
    límites.
-   [ ] Implementar procesamiento asíncrono de imágenes.
-   [ ] Implementar PWA offline con política de caché segura.
-   [ ] Implementar SSE y recuperación mediante REST.
-   [ ] Implementar auditoría y soft delete.
-   [ ] Implementar backups y probar restauración.
-   [ ] Configurar CI/CD y ambientes separados.
-   [ ] Configurar observabilidad y alertas.

## 25.4 Funcionalidades explícitamente pospuestas

-   [ ] MFA para nutrióloga y, si aplica, pacientes.
-   [ ] Registro y atención de menores con tutor y autorizaciones.
-   [ ] Multi-nutrióloga/multi-tenant.
-   [ ] Interfaz para permisos individuales y roles personalizados.
-   [ ] Notificaciones por correo, push y recordatorios.
-   [ ] Chat independiente.
-   [ ] Integraciones externas y automatizaciones no incluidas en el
    alcance inicial.

------------------------------------------------------------------------

# 26. Fases sugeridas de implementación

## Fase 0 --- Preparación

-   Repositorios, convenciones, ambientes y CI.
-   Diseño de arquitectura y modelo de datos.
-   OpenAPI inicial.
-   Configuración de autenticación, seguridad y almacenamiento.

## Fase 1 --- Fundamentos

-   Autenticación, sesiones y recuperación.
-   RBAC.
-   Pacientes y expedientes.
-   Mediciones e historial.
-   Consentimientos y documentos.
-   Auditoría y soft delete.

## Fase 2 --- Catálogo y cálculo

-   Catálogo SMAE licenciado.
-   Motor nutricional y precisión decimal.
-   Biblioteca de platillos.
-   Recetas y fotografías.
-   Versiones de platillos y alertas nutricionales.

## Fase 3 --- Planificación

-   Calendario drag & drop.
-   Plantillas.
-   Distribución de equivalentes.
-   Estados de planes.
-   Publicación, snapshots, sustituciones e historial.
-   Autoguardado y control de concurrencia.

## Fase 4 --- Paciente y seguimiento

-   PWA responsive.
-   Acceso seguro.
-   Consulta diaria/semanal.
-   Offline de consulta.
-   Registro de comidas, fotografías y comentarios.
-   Sincronización y trazabilidad por versión.

## Fase 5 --- Analítica y operación

-   Dashboard.
-   Reportes y exportaciones.
-   Búsqueda y filtros.
-   Cuotas y administración de archivos.
-   Observabilidad, backups y endurecimiento de seguridad.

------------------------------------------------------------------------

# 27. Criterios generales de aceptación del MVP

El MVP se considerará funcionalmente completo cuando:

1.  La nutrióloga pueda registrar pacientes adultos y gestionar
    expedientes con historial antropométrico.
2.  Los consentimientos requeridos se registren antes de iniciar captura
    clínica.
3.  La nutrióloga pueda crear platillos y recetas reutilizables.
4.  El motor calcule energía, macronutrientes y equivalentes con la
    política decimal acordada.
5.  Los cálculos puedan reproducirse con la versión de catálogo
    correspondiente.
6.  Las actualizaciones del catálogo no modifiquen platillos sin
    autorización.
7.  Cada cambio autorizado genere una versión nueva e inmutable.
8.  La nutrióloga pueda crear, editar, duplicar y publicar planes desde
    el calendario drag & drop.
9.  Los cambios en planes publicados se reflejen inmediatamente,
    conservando historial.
10. El paciente consulte únicamente su información autorizada.
11. El paciente pueda registrar seguimiento, fotos y comentarios
    vinculados a la versión correcta del platillo.
12. La nutrióloga pueda consultar cumplimiento, alertas, evolución y
    reportes.
13. Los archivos privados no sean accesibles mediante URLs públicas ni
    por otros pacientes.
14. Existan auditoría, soft delete, backups y pruebas de restauración.
15. Los flujos críticos tengan pruebas automatizadas y CI.

------------------------------------------------------------------------

# 28. Principios no negociables

-   La seguridad y autorización se aplican en backend.
-   Los datos clínicos y fotografías de seguimiento son privados.
-   No alterar registros históricos al cambiar platillos o planes.
-   Conservar versiones de platillos y fuentes de cálculo.
-   No redondear datos originales ni sumas/multiplicaciones; usar Round
    Half Even a 16 decimales en divisiones que requieren precisión
    finita.
-   Los cálculos deben ser reproducibles.
-   Las alertas apoyan, pero no sustituyen, el criterio de la
    nutrióloga.
-   La arquitectura inicial será un monolito modular, no microservicios.
-   El MVP debe priorizar los flujos esenciales antes de desarrollar
    módulos pospuestos.

------------------------------------------------------------------------

# 29. Modelo entidad-relación (ERD) propuesto

Este ERD es la propuesta lógica inicial para PostgreSQL. Define los
dominios y sus relaciones principales; los tipos definitivos, índices,
restricciones, nombres finales y estrategia de migraciones se cerrarán
durante el diseño físico y la implementación.

**Convenciones** - PK: llave primaria. - FK: llave foránea. -
`created_at` y `updated_at`: fechas UTC. - `deleted_at`: eliminación
lógica cuando aplique. - Identificadores: UUID. - Cantidades y valores
nutricionales: `NUMERIC` sin escala fija impuesta. - Los nombres de
tablas se muestran en `snake_case`. - Las relaciones históricas deben
conservar referencias a versiones inmutables.

## 29.1 ERD general

``` mermaid
erDiagram
    USERS ||--o{ USER_ROLE_ASSIGNMENTS : has
    ROLES ||--o{ USER_ROLE_ASSIGNMENTS : assigned
    ROLES ||--o{ ROLE_PERMISSIONS : grants
    PERMISSIONS ||--o{ ROLE_PERMISSIONS : included

    USERS ||--o| PATIENTS : owns_account
    USERS ||--o{ AUDIT_LOGS : performs
    USERS ||--o{ USER_SESSIONS : opens

    PATIENTS ||--o| PATIENT_PROFILES : has
    PATIENTS ||--o{ PATIENT_MEASUREMENTS : records
    PATIENTS ||--o{ PATIENT_CONDITIONS : has
    PATIENTS ||--o{ PATIENT_ALLERGIES : has
    PATIENTS ||--o{ PATIENT_MEDICATIONS : takes
    PATIENTS ||--o{ PATIENT_FOOD_PREFERENCES : expresses
    PATIENTS ||--o{ PATIENT_NOTES : has
    PATIENTS ||--o{ PATIENT_DOCUMENTS : owns
    PATIENTS ||--o{ CONSENT_ACCEPTANCES : accepts
    CONSENT_DOCUMENTS ||--o{ CONSENT_ACCEPTANCES : versioned_as

    SMAE_EDITIONS ||--o{ SMAE_FOOD_GROUPS : defines
    SMAE_EDITIONS ||--o{ SMAE_FOODS : contains
    SMAE_FOOD_GROUPS ||--o{ SMAE_FOOD_SUBGROUPS : contains
    SMAE_FOOD_SUBGROUPS ||--o{ SMAE_FOODS : classifies
    SMAE_FOODS ||--o{ SMAE_PORTIONS : offers
    SMAE_FOODS ||--o{ SMAE_NUTRIENT_PROFILES : has
    SMAE_FOODS ||--o{ SMAE_EQUIVALENCE_RULES : defines
    SMAE_FOOD_SUBGROUPS ||--o{ SMAE_EQUIVALENCE_RULES : groups

    DISHES ||--o{ DISH_VERSIONS : versions
    DISH_VERSIONS ||--o{ DISH_INGREDIENTS : contains
    SMAE_FOODS ||--o{ DISH_INGREDIENTS : referenced_by
    SMAE_PORTIONS ||--o{ DISH_INGREDIENTS : measures
    DISH_VERSIONS ||--o{ DISH_NUTRITION_SNAPSHOTS : calculates
    DISH_VERSIONS ||--o{ DISH_SUBSTITUTIONS : offers

    PATIENTS ||--o{ MEAL_PLANS : receives
    MEAL_PLANS ||--o{ MEAL_PLAN_VERSIONS : versions
    MEAL_PLAN_VERSIONS ||--o{ MEAL_PLAN_DAYS : contains
    MEAL_PLAN_DAYS ||--o{ MEAL_SLOTS : contains
    MEAL_SLOTS ||--o{ MEAL_SLOT_ITEMS : contains
    DISH_VERSIONS ||--o{ MEAL_SLOT_ITEMS : assigned

    PATIENTS ||--o{ TRACKING_ENTRIES : records
    MEAL_SLOT_ITEMS ||--o{ TRACKING_ENTRIES : tracked_as
    TRACKING_ENTRIES ||--o{ TRACKING_PHOTOS : includes
    TRACKING_ENTRIES ||--o{ MEAL_COMMENTS : has
    USERS ||--o{ MEAL_COMMENTS : writes

    PATIENTS ||--o{ STORAGE_USAGE : consumes
    FILE_OBJECTS ||--o{ PATIENT_DOCUMENTS : attached_as
    FILE_OBJECTS ||--o{ TRACKING_PHOTOS : stored_as
    FILE_OBJECTS ||--o{ DISH_VERSIONS : image_for
```

## 29.2 Entidades principales y campos relevantes

### Identidad y autorización

  -------------------------------------------------------------------------
  Tabla                     Campos principales      Notas
  ------------------------- ----------------------- -----------------------
  `users`                   `id PK`, `email`,       Cuenta de acceso; email
                            `password_hash`,        normalizado y único.
                            `status`,               
                            `last_login_at`,        
                            `created_at`,           
                            `updated_at`            

  `roles`                   `id PK`, `code`,        Roles iniciales
                            `name`, `description`   `nutritionist` y
                                                    `patient`.

  `permissions`             `id PK`, `code`,        Catálogo de permisos
                            `description`           preparado para
                                                    granularidad futura.

  `user_role_assignments`   `user_id FK`,           Relación N:M; unicidad
                            `role_id FK`,           por usuario/rol.
                            `assigned_at`           

  `role_permissions`        `role_id FK`,           Relación N:M.
                            `permission_id FK`      

  `user_sessions`           `id PK`, `user_id FK`,  No guardar refresh
                            `refresh_token_hash`,   tokens en texto plano.
                            `device_label`,         
                            `user_agent`,           
                            `created_at`,           
                            `last_seen_at`,         
                            `expires_at`,           
                            `revoked_at`            

  `password_reset_tokens`   `id PK`, `user_id FK`,  Token de un solo uso;
                            `token_hash`,           almacenar hash.
                            `expires_at`,           
                            `used_at`, `created_at` 
  -------------------------------------------------------------------------

### Pacientes y expediente

  -----------------------------------------------------------------------------
  Tabla                        Campos principales       Notas
  ---------------------------- ------------------------ -----------------------
  `patients`                   `id PK`,                 El vínculo a cuenta
                               `user_id FK nullable`,   puede ser nulo hasta
                               `status`,                aceptar invitación.
                               `created_by FK`,         
                               `created_at`,            
                               `deleted_at`             

  `patient_profiles`           `patient_id PK/FK`,      Datos personales del
                               `first_name`,            expediente.
                               `last_name`,             
                               `birth_date`, `sex`,     
                               `email`, `phone`         

  `patient_measurements`       `id PK`,                 Historial append-only;
                               `patient_id FK`,         no sobrescribir
                               `measured_at`,           mediciones.
                               `weight_kg`,             
                               `height_cm`, `bmi`,      
                               `waist_cm`, `hip_cm`,    
                               `body_fat_pct`, `notes`, 
                               `created_by FK`          

  `patient_conditions`         `id PK`,                 Condiciones clínicas
                               `patient_id FK`, `name`, registradas.
                               `details`, `status`      

  `patient_allergies`          `id PK`,                 Fuente de alertas.
                               `patient_id FK`,         
                               `allergen`, `reaction`,  
                               `severity`, `status`     

  `patient_medications`        `id PK`,                 Información registrada
                               `patient_id FK`, `name`, por
                               `dose`, `frequency`,     profesional/paciente
                               `start_date`,            según permisos.
                               `end_date`, `status`     

  `patient_food_preferences`   `id PK`,                 Favorito, no consume,
                               `patient_id FK`,         restricción u otra
                               `food_name`,             preferencia.
                               `preference_type`,       
                               `notes`                  

  `patient_notes`              `id PK`,                 Privadas para
                               `patient_id FK`,         nutrióloga.
                               `author_user_id FK`,     
                               `body`, `created_at`,    
                               `deleted_at`             

  `patient_documents`          `id PK`,                 `visibility` controla
                               `patient_id FK`,         si el paciente puede
                               `file_object_id FK`,     consultar.
                               `category`,              
                               `description`,           
                               `document_date`,         
                               `visibility`,            
                               `uploaded_by FK`         
  -----------------------------------------------------------------------------

### Consentimientos y documentos legales

  ---------------------------------------------------------------------------
  Tabla                   Campos principales          Notas
  ----------------------- --------------------------- -----------------------
  `consent_documents`     `id PK`, `document_type`,   Tipo: aviso de
                          `version`, `title`,         privacidad o
                          `content`, `published_at`,  consentimiento
                          `is_active`                 informado. Las
                                                      versiones no se
                                                      sobrescriben.

  `consent_acceptances`   `id PK`, `patient_id FK`,   Evidencia de aceptación
                          `consent_document_id FK`,   y revocación.
                          `accepted_at`,              
                          `acceptance_method`,        
                          `evidence_metadata`,        
                          `revoked_at`                
  ---------------------------------------------------------------------------

### Catálogo SMAE y cálculo

El detalle del modelo SMAE se define en la sección 30. Las tablas
centrales son `smae_editions`, `smae_food_groups`,
`smae_food_subgroups`, `smae_foods`, `smae_portions`,
`smae_nutrient_profiles` y `smae_equivalence_rules`.

### Platillos y recetas

  ------------------------------------------------------------------------------------------------
  Tabla                        Campos principales                          Notas
  ---------------------------- ------------------------------------------- -----------------------
  `dishes`                     `id PK`, `owner_user_id FK`, `name`,        Identidad estable del
                               `category`, `status`, `created_at`,         platillo, independiente
                               `deleted_at`                                de sus versiones.

  `dish_versions`              `id PK`, `dish_id FK`, `version_number`,    Inmutable una vez
                               `description`, `recipe_mode`,               publicada/confirmada.
                               `instructions_text`, `servings`,            
                               `prep_time_minutes`,                        
                               `image_file_id FK nullable`,                
                               `smae_edition_id FK`, `created_by FK`,      
                               `created_at`, `change_reason`               

  `dish_ingredients`           `id PK`, `dish_version_id FK`,              Debe referenciar
                               `food_id FK nullable`,                      alimento SMAE o
                               `portion_id FK nullable`,                   alimento personalizado.
                               `custom_food_id FK nullable`, `quantity`,   Guardar snapshot de
                               `unit`, `ingredient_name_snapshot`,         datos usados.
                               `nutrient_snapshot`                         

  `dish_nutrition_snapshots`   `id PK`, `dish_version_id FK`,              Resultado reproducible
                               `energy_kcal`, `protein_g`,                 del motor.
                               `carbohydrates_g`, `lipids_g`,              
                               `equivalents_snapshot`, `calculated_at`,    
                               `engine_version`                            

  `dish_substitutions`         `id PK`, `dish_version_id FK`,              Sustituciones manuales
                               `substitute_dish_version_id FK nullable`,   o sugeridas, siempre
                               `substitute_food_id FK nullable`,           autorizadas.
                               `substitution_type`,                        
                               `equivalence_snapshot`, `approved_by FK`    
  ------------------------------------------------------------------------------------------------

`custom_foods` será una tabla separada para alimentos no incluidos en el
catálogo SMAE, con nombre, unidad, composición nutricional, fuente,
autor y fecha de validación. No deben presentarse como equivalentes
oficiales por defecto.

### Planes y calendario

  ---------------------------------------------------------------------------------
  Tabla                        Campos principales           Notas
  ---------------------------- ---------------------------- -----------------------
  `meal_plans`                 `id PK`, `patient_id FK`,    Identidad del plan y
                               `name`, `status`,            ciclo de vida.
                               `start_date`, `end_date`,    
                               `created_by FK`,             
                               `created_at`, `deleted_at`   

  `meal_plan_versions`         `id PK`, `meal_plan_id FK`,  Snapshot de publicación
                               `version_number`,            recomendado; preservar
                               `published_at`,              exactamente lo mostrado
                               `created_by FK`,             al paciente.
                               `change_summary`,            
                               `snapshot_metadata`          

  `meal_plan_days`             `id PK`,                     Día dentro de una
                               `meal_plan_version_id FK`,   versión.
                               `plan_date`, `day_order`,    
                               `daily_targets_snapshot`     

  `meal_slots`                 `id PK`,                     Desayuno, colaciones,
                               `meal_plan_day_id FK`,       comida, cena o tiempo
                               `slot_name`, `slot_order`,   personalizado.
                               `notes`                      

  `meal_slot_items`            `id PK`, `meal_slot_id FK`,  Referencia inmutable a
                               `dish_version_id FK`,        versión del platillo.
                               `item_order`,                
                               `servings_multiplier`,       
                               `nutrition_snapshot`,        
                               `equivalents_snapshot`,      
                               `special_instructions`       

  `meal_plan_templates`        `id PK`, `owner_user_id FK`, Plantilla global o
                               `patient_id FK nullable`,    específica del
                               `name`, `scope`,             paciente.
                               `created_at`                 

  `meal_plan_template_items`   `id PK`, `template_id FK`,   La estructura final
                               `template_structure`,        dependerá de
                               `created_at`                 granularidad elegida.
  ---------------------------------------------------------------------------------

### Seguimiento y comunicación

  -------------------------------------------------------------------------
  Tabla                   Campos principales        Notas
  ----------------------- ------------------------- -----------------------
  `tracking_entries`      `id PK`, `patient_id FK`, Vinculado al
                          `meal_slot_item_id FK`,   ítem/versión exacta
                          `status`, `recorded_at`,  asignada.
                          `patient_comment`         

  `tracking_photos`       `id PK`,                  Archivos privados.
                          `tracking_entry_id FK`,   
                          `file_object_id FK`,      
                          `uploaded_at`             

  `meal_comments`         `id PK`,                  Conversación asociada
                          `tracking_entry_id FK`,   al seguimiento, no chat
                          `author_user_id FK`,      global.
                          `body`, `created_at`,     
                          `edited_at`, `deleted_at` 
  -------------------------------------------------------------------------

### Archivos, cuotas y auditoría

  -------------------------------------------------------------------------------------
  Tabla                      Campos principales                 Notas
  -------------------------- ---------------------------------- -----------------------
  `file_objects`             `id PK`, `storage_key`,            La ruta física nunca se
                             `storage_provider`, `mime_type`,   expone directamente.
                             `size_bytes`, `width`, `height`,   
                             `visibility`, `checksum`,          
                             `created_at`, `deleted_at`         

  `storage_quota_defaults`   `id PK`, `quota_bytes`,            Cuota base
                             `effective_from`, `updated_by FK`  configurable.

  `storage_usage`            `id PK`, `patient_id FK`,          Ampliación individual y
                             `quota_override_bytes nullable`,   consumo.
                             `used_bytes`, `calculated_at`      

  `audit_logs`               `id PK`,                           Auditoría interna;
                             `actor_user_id FK nullable`,       evitar secretos y datos
                             `action`, `resource_type`,         innecesarios.
                             `resource_id`, `occurred_at`,      
                             `request_id`, `metadata`           
  -------------------------------------------------------------------------------------

## 29.3 Reglas de integridad importantes

-   Usar UUID para entidades expuestas por API.
-   `users.email` debe normalizarse y tener unicidad case-insensitive.
-   Un paciente puede existir antes de tener una cuenta;
    `patients.user_id` será nullable hasta completar invitación.
-   Un usuario con rol paciente solo puede consultar recursos cuyo
    `patient_id` corresponda a su cuenta.
-   Las notas privadas deben tener autorización exclusiva de nutrióloga.
-   Mediciones, aceptaciones, auditoría y seguimiento deben conservar
    historia.
-   Los registros versionados (`dish_versions`, `meal_plan_versions`) no
    se actualizan destructivamente.
-   Las referencias de un plan publicado apuntan a versiones inmutables
    de platillos.
-   La eliminación lógica no debe romper relaciones históricas.
-   Definir `ON DELETE RESTRICT` o estrategias equivalentes para
    entidades históricas; evitar cascadas destructivas.
-   Añadir índices en FKs, fechas, estados, correo y campos de búsqueda.
-   Para campos de estado, usar catálogos o restricciones `CHECK`
    consistentes.
-   Aplicar transacciones al publicar planes, crear versiones y
    registrar snapshots.
-   Los snapshots deben incluir versión del motor de cálculo y catálogo
    SMAE.
-   No guardar contraseñas, tokens ni secretos en auditoría.

------------------------------------------------------------------------

# 30. Modelo de datos SMAE y motor nutricional

Esta sección describe la estructura de datos necesaria para implementar
un catálogo SMAE versionado y un motor de cálculo reproducible. No
contiene ni reproduce tablas protegidas del libro; la carga real de
alimentos, porciones y equivalentes depende de una fuente cuyo uso esté
legalmente autorizado.

## 30.1 Separación de responsabilidades

**Módulo `smae`** - Administra ediciones, grupos, subgrupos, alimentos,
porciones, composición y reglas de equivalencia. - Conserva la
procedencia y versión de los datos. - Permite consultar el catálogo sin
ejecutar lógica de negocio de platillos.

**Módulo `nutrition_engine`** - Calcula nutrientes a partir de
ingredientes y cantidades. - Convierte unidades y porciones. - Agrega
resultados por receta, platillo, tiempo de comida, día y plan. - Calcula
equivalentes y compara contra objetivos. - Genera snapshots
reproducibles. - No depende de controladores HTTP ni de Angular.

## 30.2 Entidades SMAE

  -------------------------------------------------------------------------------
  Tabla                      Campos principales           Propósito
  -------------------------- ---------------------------- -----------------------
  `smae_editions`            `id PK`, `name`,             Identifica edición y
                             `edition_number`,            procedencia.
                             `publisher`,                 
                             `source_reference`,          
                             `license_reference`,         
                             `effective_date`,            
                             `imported_at`, `status`      

  `smae_food_groups`         `id PK`, `edition_id FK`,    Grupos oficiales de
                             `code`, `name`, `sort_order` alimentos por edición.

  `smae_food_subgroups`      `id PK`, `group_id FK`,      Subgrupos, cuando
                             `code`, `name`,              aplique.
                             `sort_order`, `notes`        

  `smae_foods`               `id PK`, `edition_id FK`,    Alimento dentro de una
                             `subgroup_id FK`, `code`,    edición específica.
                             `name`, `description`,       
                             `food_state`,                
                             `edible_portion_pct`,        
                             `source_reference`, `status` 

  `smae_portions`            `id PK`, `food_id FK`,       Porción y conversión a
                             `portion_name`, `quantity`,  unidad base.
                             `unit`, `grams_equivalent`,  
                             `is_reference_portion`       

  `smae_nutrient_profiles`   `id PK`, `food_id FK`,       Composición nutricional
                             `basis_quantity`,            asociada a una base
                             `basis_unit`, `energy_kcal`, cuantitativa.
                             `protein_g`,                 
                             `carbohydrates_g`,           
                             `lipids_g`, `fiber_g`,       
                             `sodium_mg`,                 
                             `other_nutrients`,           
                             `source_reference`           

  `smae_equivalence_rules`   `id PK`, `food_id FK`,       Relación
                             `subgroup_id FK`,            alimento/porción con
                             `equivalent_value`,          equivalentes del grupo
                             `reference_portion_id FK`,   correspondiente.
                             `rule_type`,                 
                             `source_reference`           

  `smae_unit_conversions`    `id PK`, `from_unit`,        Conversiones explícitas
                             `to_unit`,                   y dimensionalmente
                             `conversion_factor`,         válidas.
                             `dimension`, `source`,       
                             `is_global`                  

  `smae_import_batches`      `id PK`, `edition_id FK`,    Trazabilidad de cargas
                             `source_file_name`,          e importaciones.
                             `checksum`,                  
                             `imported_by FK`,            
                             `imported_at`, `row_count`,  
                             `status`, `error_summary`    
  -------------------------------------------------------------------------------

La estructura exacta de equivalentes debe validarse contra el formato de
la edición licenciada que se importe. No asumir que todos los alimentos
tienen una equivalencia directa o que todos los grupos comparten la
misma regla.

## 30.3 Catálogo de alimentos personalizados

Tabla `custom_foods`: - `id PK`. - `name`. - `brand` nullable. -
`description`. - `base_quantity` y `base_unit`. - `energy_kcal`. -
`protein_g`. - `carbohydrates_g`. - `lipids_g`. - `fiber_g` y otros
nutrientes opcionales. - `source_type` (etiqueta, fabricante, análisis,
captura manual u otro). - `source_reference`. - `created_by`. -
`validated_by` nullable. - `validated_at` nullable. - `status`. -
`created_at`, `updated_at`, `deleted_at`.

Los alimentos personalizados deben identificarse visualmente y en los
cálculos. Solo tendrán equivalencia SMAE si una nutrióloga la asigna
expresamente y el sistema registra quién, cuándo y con qué criterio lo
hizo.

## 30.4 Unidades y normalización

-   Definir unidades base para masa (g), volumen (ml) y unidades
    contables.
-   No convertir masa a volumen sin densidad o conversión específica del
    alimento.
-   Las medidas caseras deben relacionarse con un alimento/porción
    concreto cuando la conversión dependa del alimento.
-   Conservar la cantidad original capturada y la cantidad normalizada
    utilizada para el cálculo.
-   No asumir que una taza, cucharada o pieza tiene el mismo peso para
    todos los alimentos.
-   Toda conversión debe tener dimensión, factor, fuente y alcance
    definidos.
-   Evitar conversiones implícitas ambiguas.

## 30.5 Flujo de cálculo nutricional

1.  La nutrióloga selecciona un alimento del catálogo SMAE o un alimento
    personalizado.
2.  Captura cantidad y unidad.
3.  El motor identifica la porción/base nutricional aplicable.
4.  Convierte a unidad normalizada sin perder la cantidad original.
5.  Calcula nutrientes proporcionales a la cantidad utilizada.
6.  Calcula equivalentes conforme a la regla de la edición SMAE
    aplicable, cuando exista.
7.  Agrega nutrientes y equivalentes de los ingredientes.
8.  Ajusta por rendimiento/porciones de la receta.
9.  Genera el snapshot del platillo, incluyendo fuentes y versiones.
10. El calendario agrega snapshots de platillos para obtener totales por
    comida y día.

Cada resultado debe identificar: - Edición SMAE. - Versión del alimento
y porción. - Versión del motor de cálculo. - Cantidades originales y
normalizadas. - Unidades y conversiones aplicadas. - Regla de
equivalencia utilizada. - Fecha de cálculo.

## 30.6 Fórmulas generales

Cuando la composición nutricional está expresada por una base
cuantitativa conocida:

\[ N\_{`\text{cantidad}`{=tex}} = N\_{`\text{base}`{=tex}}
`\times`{=tex} `\frac{Q_{\text{normalizada}}}{Q_{\text{base}}}`{=tex} \]

Donde: - (N\_{`\text{base}`{=tex}}) es el nutriente declarado para la
base. - (Q\_{`\text{normalizada}`{=tex}}) es la cantidad normalizada del
ingrediente. - (Q\_{`\text{base}`{=tex}}) es la cantidad a la que
corresponde la composición.

Para una receta:

\[ N\_{`\text{receta}`{=tex}} = `\sum`{=tex}\_{i=1}\^{n} N_i \]

Para una porción:

\[ N\_{`\text{porción}`{=tex}} =
`\frac{N_{\text{receta}}}{\text{porciones producidas}}`{=tex} \]

La división usa precisión interna de 16 decimales y Round Half Even, de
acuerdo con la política numérica de la sección 7.3. No redondear sumas
ni multiplicaciones intermedias.

Estas fórmulas son generales; el tratamiento de porción comestible,
rendimiento, cocción, retención de nutrientes y equivalentes debe
ajustarse a los datos y reglas autorizados de la fuente SMAE.

## 30.7 Distribución y objetivos de equivalentes

El sistema deberá permitir: - Objetivos diarios de equivalentes por
grupo y subgrupo. - Distribución objetivo por tiempo de comida. -
Propuesta automática de distribución según objetivos diarios. - Ajuste
manual por la nutrióloga. - Comparación de equivalentes planeados contra
equivalentes calculados. - Visualización de diferencias por grupo,
tiempo y día. - Registro de la versión de objetivos usada en cada plan.

Las propuestas del sistema son orientativas y siempre editables por la
nutrióloga.

## 30.8 Sustituciones por equivalentes

-   Buscar candidatos dentro del grupo/subgrupo y reglas aplicables.
-   Comparar equivalentes y nutrientes.
-   Mostrar diferencias de energía, proteínas, carbohidratos y lípidos.
-   Considerar alergias, restricciones y preferencias del paciente.
-   Mostrar el motivo de la sugerencia.
-   Exigir revisión y autorización profesional.
-   Guardar el alimento/platillo original, sustituto, regla, cálculo y
    aprobación.
-   No modificar retroactivamente los seguimientos ni los snapshots
    históricos.

## 30.9 Actualización de ediciones y datos

-   Una edición SMAE nueva se incorpora como nueva edición, no
    sobrescribe la anterior.
-   Cada importación genera un lote trazable con checksum, fecha,
    responsable y resultado.
-   Validar duplicados, unidades, campos obligatorios y consistencia de
    nutrientes antes de activar.
-   Comparar cambios entre ediciones.
-   Detectar platillos afectados.
-   Calcular diferencias.
-   Requerir autorización de la nutrióloga para generar nuevas versiones
    de platillos.
-   Mantener disponibles las versiones anteriores para reproducir planes
    históricos.

## 30.10 Pruebas del motor nutricional

Casos mínimos: - Conversión de gramos y mililitros con unidades
compatibles. - Rechazo de conversiones dimensionalmente inválidas. -
Conversión de medidas caseras específicas de alimento. - Cálculo por
base de composición. - Cálculo de receta y porción. - Agregación de
nutrientes y equivalentes. - Precisión decimal, división y Round Half
Even. - Alimentos personalizados sin equivalencia oficial. - Comparación
entre ediciones SMAE. - Reproducción exacta de snapshots históricos. -
Sustituciones y restricciones por alergias. - Valores nulos, faltantes,
negativos o fuera de rango. - Redondeo exclusivo en la frontera definida
por la política numérica.

## 30.11 Decisiones técnicas SMAE pendientes

-   [ ] Confirmar la fuente de datos SMAE y su licencia de uso digital.
-   [ ] Obtener y revisar el formato real del catálogo autorizado antes
    de cerrar el esquema físico.
-   [ ] Definir nutrientes exactos que se importarán además de energía y
    macronutrientes.
-   [ ] Confirmar reglas oficiales para porciones, rendimiento, parte
    comestible y preparación.
-   [ ] Definir si se manejarán densidades específicas para conversiones
    de volumen a masa.
-   [ ] Definir catálogo de medidas caseras y su fuente.
-   [ ] Validar reglas de equivalencia por grupo/subgrupo con la
    nutrióloga.
-   [ ] Definir tolerancias de comparación nutricional y de
    equivalentes.
-   [ ] Crear fixtures de prueba con datos de ejemplo autorizados, sin
    copiar material protegido sin licencia.
