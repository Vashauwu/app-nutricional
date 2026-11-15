# Evaluación de pantallas y propuesta de rediseño UI/UX

Plataforma de gestión nutricional · Nutrición Integral
Fecha: 15 de noviembre de 2026 · Alcance: panel de la nutrióloga (administrativo) y app de la paciente (PWA)

> Este documento fue el punto de partida del rediseño. **Estado: implementado en la rama `feat/rediseno-ui`** (ver «Estado de la implementación» al final). Lo que quedó pendiente está marcado allí.

---

## 1. Cómo se hizo la evaluación

- Se levantó la app en modo demostración (datos de ejemplo) y se capturaron **17 pantallas reales** con Brave:
  escritorio 1440×900 y móvil 390×800, en tema claro y oscuro. Las capturas están en [`docs/ui-audit/`](ui-audit/).
- Se revisó el código de los layouts, tokens y componentes compartidos para ubicar la causa de cada hallazgo.
- Se evaluó con las 10 heurísticas de Nielsen, la carga cognitiva y tres personas de usuario.

**Límites, para ser honestos con el alcance:**
- No se ejecutó el detector automático de Impeccable (el lanzador no tiene permiso de ejecución en esta máquina) ni una revisión con sub-agentes aislados. Es una evaluación manual con evidencia visual.
- Faltan por capturar: modales, estados de error, formularios largos de expediente (antropometría, laboratorios, salud reproductiva) y el flujo de consentimiento de la paciente.
- Los valores de contraste marcados «estimado» se midieron a ojo sobre la captura; los demás se calcularon con los tokens.
- No existe `PRODUCT.md` ni `DESIGN.md` en el proyecto. Se recomienda crearlos al inicio de la Fase 0 (ver §7).

**Modo de cada superficie** (define cuánta expresión es apropiada):

| Superficie | Modo | Consecuencia de diseño |
|---|---|---|
| Panel de la nutrióloga | **Operar** | Escaneo rápido, densidad, consistencia, atajos. La marca vive en los detalles. |
| App de la paciente | **Operar** (uso móvil, diario, de 30 segundos) | Una acción clara por pantalla, calidez, pulgar, lectura al sol. |
| Login | **Persuadir** (leve) | Primera impresión de marca y confianza. |

---

## 2. Diagnóstico general

### Lo que ya funciona (conservar)
1. **Identidad cálida y coherente.** El ciruela con pasteles suaves y el serif en títulos distinguen el producto de un panel médico frío. Es una base propia, no un tema por defecto. El nuevo favicon la refuerza.
2. **Accesibilidad de base sólida.** Enlace «Saltar al contenido», objetivos táctiles de 44 px (`--tap`), `prefers-reduced-motion` respetado en modales y avisos, tema oscuro completo que redefine la paleta entera.
3. **La app de la paciente está bien enfocada.** La pantalla «Hoy» responde a la pregunta correcta (qué me toca comer ahora) con navegación inferior de 5 elementos con texto.
4. **Honestidad del contenido.** Avisos como «Las alertas apoyan tu revisión; no bloquean la publicación» y «Datos de ejemplo» generan confianza clínica.
5. **Tabla de pacientes y de planes** bien construidas: encabezados claros, estados con icono, paginación, estado vacío con salida.

### Puntuación heurística (honesta; 0–4)

| # | Heurística | Panel nutrióloga | App paciente | Hallazgo principal |
|---|---|:-:|:-:|---|
| 1 | Visibilidad del estado | 3 | 3 | Autoguardado y skeletons existen; falta estado «guardado» persistente en formularios. |
| 2 | Lenguaje del usuario | 3 | 3 | Buen español; siglas SMAE (`CER-SG`, `AOA-MB`) sin ayuda en contexto. |
| 3 | Control y libertad | 3 | 2 | Paciente: no hay «Deshacer» claro al marcar o desmarcar. |
| 4 | Consistencia | 2 | 3 | Anchos de página, alineación de campos y botones de acción inconsistentes (ver §4). |
| 5 | Prevención de errores | 3 | 3 | Guard de cambios sin guardar. «Desactivar» muy cerca de acciones primarias. |
| 6 | Reconocimiento vs memoria | 2 | 3 | 10 pestañas en expediente; 8 controles en el editor de plan. |
| 7 | Flexibilidad y eficiencia | 1 | 2 | Solo el editor de plan tiene atajos (deshacer/rehacer con Ctrl/Cmd+Z); no hay búsqueda global ni acciones en lote. |
| 8 | Estética y minimalismo | 2 | 3 | Dashboard con ruido: 4 colores de KPI, 25 alertas en bloques grandes. |
| 9 | Recuperación de errores | 3 | 3 | Mensajes claros; falta verlos en todos los estados. |
| 10 | Ayuda y documentación | 2 | 2 | Hay textos de apoyo; no hay ayuda contextual ni guía de primeros pasos para la paciente. |
| | **Total (sobre 40)** | **24** | **27** | Panel: aceptable; app paciente: aceptable alto. |

---

## 3. Dirección de estilo propuesta

### 3.1 Principio rector: «Calma clínica con calidez»
La marca ya es cálida; el problema no es el estilo base sino **el uso del color**. Hoy los pasteles se usan a la vez como decoración (tarjetas KPI de cuatro colores, miniaturas de platillos, tonos de la barra lateral) y como **significado** (rosa = crítico, mantequilla = advertencia, salvia = éxito). Cuando todo es color, el color deja de comunicar.

**Regla nueva:** *el pastel es significado; la decoración es neutra.* Una superficie con color de fondo siempre quiere decir algo (alerta, éxito, aviso, estado). El resto va sobre marfil y blanco con el ciruela como tinta.

### 3.2 Panel administrativo (nutrióloga): «Mesa de trabajo»
Más densa, más estructurada, más rápida. Menos «tarjetas de colores», más jerarquía tipográfica.

| Tema | Hoy | Propuesta |
|---|---|---|
| **Color** | 4 KPI en lavanda, salvia, cielo y rosa; alertas críticas en bloques rosa de ~120 px de alto | KPI neutros (blanco con filo), con un único acento semántico solo cuando hay algo que atender. Alertas en filas compactas con punto de severidad. |
| **Tipografía** | Playfair en H1, en cifras de KPI y en títulos de tarjetas de algunas pantallas (Configuración, Platillo). Las cifras serif («79 %») con numerales de estilo antiguo escanean mal | Playfair solo en el H1 de página y momentos de marca. **Cifras y datos en Inter con numerales tabulares.** Escala fija: 12 / 14 / 16 / 20 / 28. |
| **Navegación** | 8 elementos planos en una sola lista | Agrupar: **Clínica** (Pacientes, Consultas, Planes, Seguimiento) · **Biblioteca** (Platillos, Catálogo SMAE) · **Análisis** (Reportes) · Configuración abajo. Riel colapsable a solo iconos. |
| **Búsqueda** | Cada lista tiene su buscador local | **Búsqueda global (Cmd/Ctrl+K)**: paciente, plan, platillo, acción («Nuevo plan para…»). |
| **Densidad** | Una sola | Interruptor Cómoda / Compacta en tablas. |
| **Acciones de página** | Tres botones del mismo peso en el Inicio (Crear paciente / platillo / plan) | Un solo botón primario **«Nuevo»** con menú, o el más probable del día en primario y el resto en secundario. |
| **Tema** | Interruptor de 3 estados con icono de cuadrícula cuando es «Sistema» (ambiguo) | Menú con 3 opciones etiquetadas: Claro · Oscuro · Sistema. |

### 3.3 App de la paciente: «Un buen día de comida»
Más cálida, más fotográfica, con menos decisiones y mejor refuerzo positivo.

| Tema | Hoy | Propuesta |
|---|---|---|
| **Color y foto** | Miniaturas planas pastel con un icono genérico | **Fotografía real del platillo** cuando existe; si no, tinte suave con ilustración. Las comidas son lo más emocional de la app: deben apetecer. |
| **Foco** | Todas las comidas del día con el mismo peso | **«Siguiente comida»** arriba y grande; las ya realizadas se pliegan en una fila compacta con marca de verificación. |
| **Registro** | Dos botones por comida («Realizada» / «Omitida»); al estar marcada se ve igual que sin marcar | Un botón primario **«Marcar realizada»**; «No la comí» como acción secundaria. Tras marcar: estado con **«Deshacer»** visible 5 s. |
| **Tono** | «Omitida» suena a falta | «Saltada» o «No la comí». Sin racha ni culpa: es contexto clínico, no un juego. |
| **Gráficas** | Etiquetas de eje de ~7 px; barras sobre un fondo vacío | Etiquetas ≥ 12 px, 3 a 4 marcas por eje, estado vacío explicativo cuando faltan semanas. |
| **Semana** | Un punto de color (mantequilla / verde) como único indicador | Punto + texto/icono («3/5»); el color nunca es el único portador de significado. |
| **Tema** | Funciona bien en oscuro | Mantener; usar el ciruela como acento principal en ambos. |

---

## 4. Hallazgos por pantalla

Severidad: **P0** bloquea la tarea · **P1** dificultad importante · **P2** molestia con salida · **P3** pulido.
La columna «Evidencia» apunta a la captura en `docs/ui-audit/`.

### 4.1 Panel de la nutrióloga

#### Inicio · `02`, `03`, `16`
| Sev. | Hallazgo | Por qué importa | Propuesta |
|:-:|---|---|---|
| **P1** | **25 alertas activas, 6 críticas, y las primeras tres ocupan casi toda la pantalla** en bloques rosa de ~120 px. La misma alergia (frutos secos) se repite una vez por cada día del plan (17 nov, 18 nov…), con el mismo texto. | La información más importante de la página se vuelve ruido. Sin agrupar, no se sabe a quién atender primero. | Agrupar **por paciente** y por severidad; una fila por alerta con punto de color, título corto y «Revisar»; las demás plegadas bajo «Ver 19 advertencias». |
| **P1** | **«Seguimiento por revisar (6)» es solo una insignia** en el menú lateral y un enlace secundario al pie de «Actividad reciente»; no es un bloque propio del Inicio. | Es la tarea diaria recurrente de la nutrióloga. | Bloque «Hoy» con 3 colas ordenadas: **por revisar**, **consultas de hoy**, **planes que terminan**. |
| **P2** | **Cuatro KPI en cuatro colores** (lavanda, salvia, cielo, rosa) sin relación con su significado (los «pacientes activos» en lavanda no son «un tipo de dato»). | El color deja de significar algo. | KPI neutros; solo «Alertas activas» cambia de tono cuando hay críticas. |
| **P2** | Cifras en Playfair con numerales de estilo antiguo. | Escanear números en un panel debe ser inmediato. | Inter tabular para cifras (§3.2). |
| **P2** | **Tres acciones «Crear…» de igual peso** en el encabezado. | Sin jerarquía no hay una acción por defecto. | Un botón «Nuevo» con menú (§3.2). |
| **P3** | En móvil, los KPI apilados ocupan más de dos pantallas antes de llegar a algo accionable. | Móvil: el contenido accionable queda enterrado. | Grid 2×2 compacto en móvil. |

#### Pacientes (lista) · `04`, `05`
| Sev. | Hallazgo | Por qué importa | Propuesta |
|:-:|---|---|---|
| **P1** | **En móvil la tabla se corta horizontalmente** (se pierden las columnas de objetivo, estado y plan); no hay vista de tarjeta. | La nutrióloga consulta pacientes desde el celular entre consultas. | Por debajo de 48 rem, cada fila pasa a **tarjeta**: avatar, nombre, estado, cumplimiento y chip de plan. |
| **P2** | Las filas muestran «Alta 18/06/2026» bajo el chip de consentimiento: la fecha de alta compite con el estado en la misma celda. | Mezcla dos datos con prioridades distintas. | Separar columna «Alta» o quitarla de la vista por defecto. |
| **P2** | La fila no es clicable en todo su ancho (solo el nombre). | Objetivo pequeño, más esfuerzo. | Fila completa clicable con foco visible. |
| **P3** | Filtros como `select` nativos de aspecto distinto al resto. | Inconsistencia visual. | Componente de filtro con chips, uno por dimensión. |

#### Expediente del paciente · `06`
| Sev. | Hallazgo | Por qué importa | Propuesta |
|:-:|---|---|---|
| **P1** | **10 pestañas** (Resumen, Antropometría, Clínico, Laboratorios, Preferencias, Notas privadas, Documentos, Consentimientos, Planes, Seguimiento); la última se corta en el borde. | Supera el límite de ~7 ítems; obliga a recordar dónde vive cada dato. | Reagrupar en **5**: Resumen · Salud (antropometría, clínico, laboratorios, preferencias) · Plan y seguimiento · Documentos · Administración (notas privadas, consentimientos). Subniveles dentro de cada una. |
| **P1** | **«Desactivar» en rojo, al lado de «Nuevo plan», «Agendar consulta» y «Editar datos».** | Acción destructiva a un clic de las primarias. | Mover a un menú «Más» (⋯) al final del encabezado con confirmación. |
| **P2** | Cuatro botones de acción de igual peso en el encabezado. | Sin jerarquía. | 1 primario («Nuevo plan») + 1 secundario («Agendar») + menú «Más». |
| **P2** | La rejilla de tarjetas del Resumen deja huecos irregulares (tarjetas de alturas distintas). | Aspecto descuidado en la pantalla más usada. | Rejilla de 12 columnas con tarjetas de altura uniforme o masonry controlado. |

#### Editor de plan · `07` — la pantalla más importante del producto
| Sev. | Hallazgo | Por qué importa | Propuesta |
|:-:|---|---|---|
| **P1** | **El título del plan se corta** («Plan semanal — Mantenim…»). | Se pierde el nombre del plan que se edita. | Título editable en línea con elipsis y `title`; segunda línea para paciente/estado. |
| **P1** | **Ocho controles en la barra de encabezado** (estado, deshacer, rehacer, Alertas, Objetivos, Historial, Plantilla, Publicar). | Sobrecarga cognitiva (>7). | Agrupar: [Deshacer/Rehacer] · [Alertas · Objetivos] · menú «Más» (Historial, Plantilla) · **Publicar** (único primario). |
| **P1** | **Tres columnas laterales compiten por ancho**: barra lateral (248 px) + biblioteca (264 px) + calendario de 7 días con scroll horizontal. Cada día queda en ~190 px y los nombres de platillo se parten en 4 líneas. | Es la pantalla donde más se trabaja y la que menos aire tiene. | **Modo enfoque**: colapsar la barra lateral automáticamente en el editor. Vista **Día** por defecto por debajo de 1500 px; Semana como alternativa. |
| **P1** | **43 alertas** y marcado rojo/amarillo en las tarjetas de platillo. | Demasiado ruido para decidir. | Resumen de alertas en un solo panel con filtros; en la tarjeta, solo un punto de severidad. |
| **P2** | Dos barras de desplazamiento horizontal (calendario y página). | Interacción confusa. | Una sola; el contenedor del calendario contiene el scroll. |
| **P2** | Cabecera de día: «1,410 / 1,400 kcal» sin indicación de si está bien o mal más allá del color de la barra. | El color solo no basta (accesibilidad). | Texto «+10 kcal» o «−132 kcal» con icono. |
| **P3** | «Agregar a…» en cada tarjeta de la biblioteca como un botón gris más. | Duplica la función arrastrar. | Mantener solo al pasar el cursor o en el menú de la tarjeta. |

#### Platillos (biblioteca y editor) · `15`, `08`
| Sev. | Hallazgo | Por qué importa | Propuesta |
|:-:|---|---|---|
| **P2** | Tarjetas con **bloque de color liso de ~250 px** y un icono: el 55 % de la tarjeta no informa nada. | Espacio desperdiciado y aspecto genérico. | Foto real o, sin foto, un recuadro mucho más bajo; la información clínica sube. |
| **P2** | **Formulario con campos desalineados**: «Tiempo de preparación» tiene una caja más alta que «Etiquetas» y el texto de ayuda empuja el layout. | Parece un error y baja la confianza. | Rejilla con altura de fila uniforme; ayudas en el mismo espacio reservado. |
| **P2** | Siglas SMAE (`CER-SG 2.2`, `AOA-MB 4.0`) sin explicación al pasar el cursor. | Obliga a recordar. | `title` con el nombre completo y los equivalentes. |

#### Seguimiento · `09`
| Sev. | Hallazgo | Por qué importa | Propuesta |
|:-:|---|---|---|
| **P1** | **El ancho de la página es distinto al resto** (el contenido empieza más a la derecha que en Pacientes o Planes). | Rompe la consistencia: el contenido «salta» al cambiar de sección. | Un solo contenedor de página (`--page-max`). |
| **P1** | Cada registro muestra **un cuadro de respuesta vacío con el botón «Responder» deshabilitado en gris**. | 6 cuadros de texto idénticos por pantalla; el botón gris (contraste estimado ~3:1) parece roto. | Un enlace «Responder» que **despliega** el cuadro; botón activo solo con texto. |
| **P2** | No hay forma de marcar un registro como revisado en lote. | La insignia dice «6 por revisar», pero revisar cuesta seis acciones. | Acciones en lote: seleccionar, «Marcar revisados». |

#### Reportes · `17`
| Sev. | Hallazgo | Por qué importa | Propuesta |
|:-:|---|---|---|
| **P2** | Estado vacío correcto, pero los dos botones de exportar aparecen **deshabilitados en gris** de poco contraste. | Lo deshabilitado no se entiende. | Ocultarlos hasta tener datos, o explicar qué falta («Elige un paciente»). |
| **P2** | Selector de paciente como `select` nativo con lista larga. | A muchos pacientes no escala. | Selector con búsqueda (combobox). |

#### Configuración · `10`
| Sev. | Hallazgo | Por qué importa | Propuesta |
|:-:|---|---|---|
| **P1** | **Ocho pestañas** (Marca, Región, Almacenamiento, Alertas, Consentimientos, Sesiones, Auditoría, Demostración). | Excede el límite de memoria de trabajo (≈ 7). | Barra lateral interna con grupos: *Mi consulta* (Marca, Región) · *Clínica* (Alertas, Consentimientos) · *Cuenta y seguridad* (Sesiones, Auditoría) · *Sistema* (Almacenamiento, Demostración solo en staging). |
| **P1** | **Los selectores de archivo son los nativos del navegador** («Seleccionar archivo / Sin archi…cionados»), texto truncado. | Aspecto roto en la pantalla de marca. | Zona de arrastrar y soltar con vista previa, formato y tamaño. |
| **P2** | Campos de color desalineados: el campo «Color principal» y «Color secundario» no comparten línea base. | Inconsistencia. | Mismo componente `field` para ambos. |
| **P3** | La vista previa del encabezado/PDF es útil. | Es un acierto. | Conservar y convertir en el patrón para otras configuraciones. |

#### Catálogo SMAE · `11`
| Sev. | Hallazgo | Por qué importa | Propuesta |
|:-:|---|---|---|
| **P2** | **El campo de búsqueda es angosto** y trunca su texto («Buscar alimento o etic…») mientras hay mucho espacio libre. | La búsqueda es la acción principal. | Búsqueda de ancho flexible. |
| **P2** | Nueve chips de grupo en dos filas, el último huérfano. | Ruido visual. | Chips con scroll horizontal o selector «Grupo». |
| **P3** | Aviso de «Datos de ejemplo» con la referencia interna «§25.1». | Esa referencia no significa nada para la usuaria. | Quitar referencias a secciones de la especificación en textos visibles. |

### 4.2 App de la paciente

#### Hoy · `12`
| Sev. | Hallazgo | Por qué importa | Propuesta |
|:-:|---|---|---|
| **P1** | **Las comidas ya realizadas se ven igual que las pendientes** (ambos botones visibles; «Realizada» relleno). | No se distingue «ya terminé» de «me falta». | Plegar lo realizado; destacar **«Siguiente: Comida · 14:00»**. |
| **P1** | **Sin «Deshacer» claro**: tocar el botón activo lo desmarca, pero no se avisa. | Control y libertad (heurística 3). | Aviso «Marcada como realizada · Deshacer» durante 5 s. |
| **P2** | La tarjeta de consulta y la de avance compiten por la parte superior. | Cuatro bloques antes de la primera comida. | Consulta como franja delgada; el avance se integra en el encabezado. |
| **P2** | «Omitida» suena a falta. | Tono. | «No la comí». |
| **P3** | «100 %» dentro del anillo con la etiqueta «hoy» queda apretado. | Legibilidad. | Anillo más grande o el porcentaje al lado. |

#### Mi semana · `14`
| Sev. | Hallazgo | Por qué importa | Propuesta |
|:-:|---|---|---|
| **P1** | **El estado del día lo indica solo un punto de color** (mantequilla / verde); el texto «3/5 realizadas» es pequeño. | El color como único portador de significado (WCAG 1.4.1). | Punto + icono + texto con más peso. |
| **P2** | Cada día se despliega con un acordeón; para ver la semana hay que abrir siete. | Costoso. | Mostrar por defecto los 3 platillos principales de cada día, o una vista de calendario compacta. |

#### Mi progreso · `13`
| Sev. | Hallazgo | Por qué importa | Propuesta |
|:-:|---|---|---|
| **P1** | **Gráficas con etiquetas de eje de ~7 px** y la de barras con casi todo el ancho vacío. | Ilegibles en un celular. | Mínimo 12 px; 3 marcas por eje; una nota si faltan semanas. |
| **P2** | El anillo repite «79 %» y la leyenda «en 2 semanas» se solapa con su borde. | Descuido visual. | Ajustar el tamaño o mover el texto. |
| **P3** | Texto explicativo extenso antes de la gráfica. | Retrasa el dato. | Una línea y un «¿qué significa?» plegable. |

### 4.3 Transversales

| Sev. | Hallazgo | Propuesta |
|:-:|---|---|
| **P1** | **Interruptor de tema de tres estados con icono de cuadrícula** cuando es «Sistema» (aparece en el expediente, el editor y el formulario de platillo). | Menú con Claro · Oscuro · Sistema, con etiquetas. |
| **P1** | **Contraste de estados deshabilitados y placeholders** de bajo nivel (estimado 3 a 3.8 : 1, bajo el 4.5 : 1 de AA para texto). Los tokens principales sí cumplen: texto/marfil 8.36 : 1, texto/lavanda 6.37 : 1, texto/rosa 6.03 : 1. | Subir los grises de placeholder y de deshabilitado; no esconder la información detrás de lo deshabilitado. |
| **P2** | **111 atributos `style="…"` en línea** repartidos por los componentes de las pantallas. | Moverlos a clases de utilidad del sistema para que el rediseño sea mantenible. |
| **P2** | **Anchos de contenedor, alturas de campos y espaciados distintos entre pantallas** (Seguimiento, Formulario de platillo, Configuración). | Un `page` con ancho máximo único, un `field` con altura única y una escala de espaciado de 4 px. |
| **P2** | Referencias a la especificación en textos visibles («§25.1»). | Revisar el copy para que no aparezcan. |
| **P3** | Los pasteles se usan como superficie de gran tamaño (KPI, miniaturas); en oscuro quedan apagados. | Regla del §3.1. |

---

## 5. Sistema visual propuesto (tokens)

Se conserva la paleta existente; cambia su **uso** y se añade lo que falta.

### Color
| Rol | Token | Valor (claro) | Uso |
|---|---|---|---|
| Fondo | `--nutri-marfil` | `#FAF7F2` | Fondo de página |
| Superficie | `--surface` | `#FFFFFF` | Tarjetas, tablas, formularios |
| Tinta principal | `--nutri-texto` | `#514653` (8.36 : 1 sobre marfil) | Texto, botones primarios |
| Tinta de marca | *(nuevo)* `--brand-ink` | `#4E344C` (10.24 : 1) | Acento principal, coherente con el favicon |
| Información | `--nutri-cielo` | `#D8E8F2` | Solo avisos informativos |
| Éxito | `--nutri-salvia` | `#D7E8D5` | Solo completado / correcto |
| Advertencia | `--nutri-mantequilla` | `#F8E8B8` | Solo advertencia |
| Crítico | `--nutri-rosa` | `#F4C9D6` | Solo crítico / destructivo |
| Acento suave | `--nutri-lavanda` | `#DDD6F2` | Selección de navegación y foco, **no** decoración |

> **Pendiente de validar con la nutrióloga**: si `--brand-ink` sustituye a `--nutri-texto` como color principal, o conviven.

### Tipografía
- **Playfair Display** (600/700): solo H1 de página, saludo del Inicio y títulos del login.
- **Inter** (400/500/600): todo lo demás, con `font-variant-numeric: tabular-nums` en cifras y tablas.
- Escala: 12 · 14 · 16 · 20 · 28 · 36 px. Cuerpo mínimo 14 px en panel y 16 px en la app de la paciente.

### Espacio, forma y movimiento
- Escala de 4 px (4 / 8 / 12 / 16 / 24 / 32 / 48).
- Radios: 8 px (campos), 12 px (tarjetas), 999 px (chips).
- Un `--page-max` único (≈ 1200 px) y un `--field-h` único (44 px).
- Movimiento solo con significado (entrada de avisos, confirmación de registro) y siempre bajo `prefers-reduced-motion`.

### Componentes nuevos o a unificar
`PageHeader` (título, subtítulo, 1 primario + menú) · `ActionMenu` (⋯) · `FileDrop` · `Combobox` · `AlertRow` · `MealCard` (paciente) · `UndoToast` · `ThemeMenu` · `ResponsiveTable` (tabla → tarjetas).

---

## 6. Principios de UX aplicados (lista de verificación)

- [ ] Una acción primaria por pantalla; el resto, secundarias o en menú.
- [ ] Máximo 4 opciones visibles por decisión; máximo 7 elementos de navegación por nivel.
- [ ] Acciones destructivas apartadas y con confirmación; todo lo reversible con «Deshacer».
- [ ] El color nunca es el único portador de significado.
- [ ] Contraste AA mínimo en texto, placeholders y estados deshabilitados.
- [ ] Objetivos táctiles ≥ 44 px; acciones principales del móvil al alcance del pulgar.
- [ ] Estados cubiertos en cada pantalla: cargando, vacío, error, sin conexión, éxito.
- [ ] Tablas con alternativa móvil; sin desplazamiento horizontal que oculte datos.
- [ ] Teclado completo: foco visible, orden lógico, `Esc` cierra modales, atajos documentados.
- [ ] Textos sin jerga ni referencias a la especificación; siglas con ayuda contextual.

---

## 7. Plan de trabajo por fases

Tamaños: **S** ≈ medio día · **M** ≈ 1–2 días · **L** ≈ 3–5 días.

### Fase 0 · Cimientos *(M)*
1. Crear `PRODUCT.md` y `DESIGN.md` (qué es el producto, modos, principios, tokens) → `/impeccable init` y `/impeccable document`.
2. Añadir tokens faltantes (`--page-max`, `--field-h`, escala de espaciado, `--brand-ink`).
3. Componente `PageHeader` con 1 acción primaria + menú «Más».
4. Reemplazar los 111 estilos en línea por clases.
5. `ThemeMenu` con etiquetas.

**Aceptación:** todas las páginas usan el mismo ancho y alto de campo; no quedan `style=` en las pantallas listadas en §4; el interruptor de tema se entiende sin tooltip.

### Fase 1 · Alto impacto, bajo riesgo *(M)* → `/impeccable layout` · `/impeccable clarify`
1. **Inicio:** KPI neutros, alertas agrupadas por paciente, bloque «Hoy» con las tres colas.
2. **Seguimiento:** ancho de página consistente; «Responder» despliega el cuadro; acciones en lote.
3. **Platillos:** tarjetas más bajas, foto real, formulario alineado.
4. **Configuración:** agrupar pestañas; `FileDrop` para logo y foto.
5. **Catálogo:** búsqueda de ancho flexible.

### Fase 2 · Flujos centrales *(L)* → `/impeccable shape` · `/impeccable adapt`
1. **Expediente:** 10 → 5 pestañas, encabezado con 1 primario + «Más», «Desactivar» al menú.
2. **Editor de plan:** modo enfoque, vista Día por defecto, barra de 8 → 4 grupos, panel de alertas único.
3. **Tablas → tarjetas en móvil** (`ResponsiveTable`) en Pacientes, Planes y Seguimiento.

### Fase 3 · App de la paciente *(L)* → `/impeccable bolder` (calidez) · `/impeccable delight`
1. **Hoy:** «Siguiente comida», plegar lo realizado, `UndoToast`, copy «No la comí».
2. **Fotografía de platillos** en la app (y subida guiada en el editor).
3. **Semana:** estado con icono + texto; vista compacta.
4. **Progreso:** gráficas legibles (≥ 12 px), estados vacíos.
5. Revisión del tono de los textos (sin culpa).

### Fase 4 · Eficiencia y pulido *(M)* → `/impeccable polish` · `/impeccable animate`
1. Búsqueda global (Cmd/Ctrl+K).
2. Densidad de tablas, atajos de teclado, ayuda contextual en siglas SMAE.
3. Micro-movimiento con significado (registro de comida, publicar plan).
4. Revisión de accesibilidad completa y de contraste → `/impeccable audit`.

### Orden recomendado
Fase 0 → 1 → 3 → 2 → 4. La app de la paciente (Fase 3) va antes del editor (Fase 2) porque es lo que más ve el cliente final y tiene menos riesgo técnico que reestructurar el editor.

---

## 8. Decisiones abiertas (necesito la respuesta de la nutrióloga antes de empezar)

1. ~~¿Se conserva el ciruela `#514653` o se adopta el `#4E344C` del nuevo logo?~~ **Resuelto (15 nov 2026):** el logotipo nuevo es la identidad definitiva y su ciruela `#4E344C` pasa a ser el color de marca; ver `PRODUCT.md`. Falta fijar si sustituye a `#514653` en botones y foco (Fase 0).
2. **¿Hay fotografías de platillos reales?** Condiciona toda la Fase 3 (la app de la paciente).
3. **«Omitida» → «No la comí».** ¿Se aprueba el cambio de tono? Es un dato clínico: el cambio debe ser aprobado por la nutrióloga.
4. **¿Qué atajos y búsqueda global quiere?** Define el alcance de la Fase 4.
5. **¿Se aceptará un panel colapsable en el editor de plan?** Cambia cómo se trabaja el flujo principal.

---

## 9. Anexo: capturas

| # | Pantalla | Archivo |
|:-:|---|---|
| 01 | Login (claro) | [`01-login-claro.png`](ui-audit/01-login-claro.png) |
| 02 | Inicio (claro) | [`02-inicio-claro.png`](ui-audit/02-inicio-claro.png) |
| 03 | Inicio (oscuro) | [`03-inicio-oscuro.png`](ui-audit/03-inicio-oscuro.png) |
| 04 | Pacientes | [`04-pacientes.png`](ui-audit/04-pacientes.png) |
| 05 | Pacientes en móvil (oscuro) | [`05-pacientes-movil-oscuro.png`](ui-audit/05-pacientes-movil-oscuro.png) |
| 06 | Expediente (oscuro) | [`06-expediente-oscuro.png`](ui-audit/06-expediente-oscuro.png) |
| 07 | Editor de plan (oscuro) | [`07-editor-plan-oscuro.png`](ui-audit/07-editor-plan-oscuro.png) |
| 08 | Nuevo platillo (oscuro) | [`08-platillo-nuevo-oscuro.png`](ui-audit/08-platillo-nuevo-oscuro.png) |
| 09 | Seguimiento | [`09-seguimiento.png`](ui-audit/09-seguimiento.png) |
| 10 | Configuración | [`10-configuracion.png`](ui-audit/10-configuracion.png) |
| 11 | Catálogo SMAE | [`11-catalogo.png`](ui-audit/11-catalogo.png) |
| 12 | Paciente · Hoy | [`12-paciente-hoy.png`](ui-audit/12-paciente-hoy.png) |
| 13 | Paciente · Progreso | [`13-paciente-progreso.png`](ui-audit/13-paciente-progreso.png) |
| 14 | Paciente · Semana | [`14-paciente-semana.png`](ui-audit/14-paciente-semana.png) |
| 15 | Platillos | [`15-platillos.png`](ui-audit/15-platillos.png) |
| 16 | Inicio en móvil | [`16-inicio-movil.png`](ui-audit/16-inicio-movil.png) |
| 17 | Reportes | [`17-reportes.png`](ui-audit/17-reportes.png) |


---

## 10. Estado de la implementación (15 nov 2026)

Verificado con axe-core (WCAG 2.2 AA) sobre las pantallas principales en claro, oscuro y móvil, más 32 pruebas unitarias y el build de producción (inicial: 154 kB transferidos).

| Fase | Punto | Estado |
|---|---|---|
| 0 | `PRODUCT.md` y `DESIGN.md` | Hecho |
| 0 | Tokens (`--page-max`, `--field-h`, `--brand-ink`) | Hecho |
| 0 | `PageHeader` con 1 acción primaria + menú «Más» | Hecho (Inicio, Pacientes, Planes, Consultas, Seguimiento, Platillos, Catálogo, Configuración, Reportes, editor de platillo) |
| 0 | Reemplazar estilos en línea | Hecho: 0 estilos en línea estáticos (quedan solo enlaces dinámicos `[style.x]`) |
| 0 | `ThemeMenu` con etiquetas | Hecho |
| 1 | Inicio: indicadores neutros, alertas por paciente sin repeticiones, «Por revisar» | Hecho |
| 1 | Seguimiento: ancho consistente, «Responder» desplegable, acciones en lote | Hecho |
| 1 | Platillos: tarjetas bajas sin foto, formulario alineado, `FileDrop` | Hecho |
| 1 | Configuración: navegación agrupada, `FileDrop` para logo y foto | Hecho |
| 1 | Catálogo: búsqueda de ancho flexible, chips en una fila | Hecho |
| 2 | Expediente: 10 secciones → 5 grupos, «Más» con «Desactivar» apartada | Hecho |
| 2 | Editor de plan: modo enfoque, vista Día por defecto < 1500 px, barra en grupos, alertas con filtros, diferencia de kcal en texto | Hecho |
| 2 | Tablas → tarjetas en móvil | Hecho en todas: el servicio `TableCardsService` etiqueta las celdas desde el encabezado y aplica `table--cards` bajo 48 rem (`table--keep` lo omite) |
| 3 | App de la paciente: «Siguiente comida», lo registrado plegado, «Deshacer», «No la comí» | Hecho |
| 3 | Semana: estado con icono + texto y vista previa de platillos | Hecho |
| 3 | Progreso: gráficas al ancho real (texto de 12 px), estados vacíos | Hecho |
| 3 | Fotografía real de platillos | Hecho. Hay 15 fotos **sintéticas de prueba** en `frontend/public/seed/dishes/` (una por platillo de ejemplo, también usadas en el seguimiento). Sustitúyelas por fotos reales cuando las haya |
| 4 | Búsqueda global Ctrl/Cmd + K, densidad de tablas, avisos con acción | Hecho |
| 4 | Movimiento con significado (barras, menús, avisos) | Hecho |
| 4 | Auditoría de accesibilidad | Hecho; corrigió el calendario de Consultas y la lista vacía de ingredientes |

**Decisiones tomadas al cerrar**
- «No la comí» ahora también se lee así en el panel de la nutrióloga («No la comió» / filtro «No las comió»). Es solo texto: el estado interno sigue siendo `skipped`.
- Los filtros de estado, objetivo, categoría, grupo SMAE y origen usan el selector con búsqueda. Los `select` nativos se conservan en formularios con 2–6 opciones fijas (mejor experiencia en móvil).
- El color de marca por defecto cambió a `#4E344C` para instalaciones nuevas; las existentes conservan el que ya guardaron en Configuración.
