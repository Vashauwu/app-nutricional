# Análisis del flujo de consulta (referencia de otra plataforma) y qué construimos

Se revisaron 17 capturas de otra aplicación de nutrición: perfil profesional, alta de paciente, consulta guiada de cinco pasos,
documento para el paciente y envío. Este documento compara **qué hace** (funciones y flujo, no su marca ni sus textos) contra
lo que ya tenemos y decide qué se construye, qué se pospone y qué no se copia.

## Qué no se copia
- Su nombre, mascota, textos, íconos ni «marca de agua». Los estilos del documento y los textos son propios.
- Su modelo comercial (planes Gratis/Estándar/Pro, prueba de 14 días): **no está definido para nosotros**; no se construyen bloqueos por plan.
- La «IA» como promesa: nuestro diferenciador es un cálculo **explicable y reproducible** (ver «Dónde nos diferenciamos»).

## Comparativa

| Pantalla / función de la referencia | Estado nuestro | Decisión |
|---|---|---|
| **Perfil:** nombre, cédula, teléfono, clínica | Tenemos (Configuración → Marca: nombre comercial, credenciales, cédula, teléfono, correo, dirección) | — |
| Perfil: «sobre ti», especialidad, tipo de profesional | Falta | Fase B |
| Perfil: dónde atiende (presencial/en línea/ambas), dirección estructurada, mapa, ocultar dirección exacta | Falta | Fase B |
| Logotipo y color de marca | Tenemos (logotipo + paquete de 10 colores con variante oscura) | — |
| **Estilos del PDF** con color de acento | **Nuevo (esta entrega):** 4 estilos propios + 10 acentos, con vista previa en vivo | Hecho |
| Tarjeta digital pública del profesional | Falta | Fase B (requiere página pública por profesional; ver `docs/interno/crm-landing.md`) |
| Planes Gratis/Estándar/Pro, prueba gratis | No existe | **No construir** hasta definir el modelo comercial |
| **Alta de paciente:** esenciales (nombre, sexo, nacimiento, teléfono, correo, motivo) | Tenemos (más invitación por correo y objetivo inicial) | — |
| Condiciones, alergias, medicamentos, gustos | Tenemos en el expediente; el alta rápida no los pide | Fase C (alta en una sola pantalla) |
| Salud reproductiva | Tenemos | — |
| Estilo de vida (tabaco, alcohol), salud intestinal con escala de Bristol, heredofamiliares, contacto de emergencia | Falta | Fase D (migración y pantallas) |
| Amputaciones | Tenemos (en Dietocálculo, con el cálculo de IMC y gasto) | — |
| **Consulta guiada** (Datos → Antropometría → Cálculo → Menú → Indicaciones) | Tenemos las piezas, en pestañas separadas; ahora termina con «Entrega» | Fase C: asistente que las encadena |
| Antropometría: Durnin-Womersley | Tenemos | — |
| Antropometría: Jackson-Pollock 4, guía «cómo medir» con diagrama | Falta | Fase E |
| Cargar análisis de composición (InBody) | Tenemos carga de documentos en el expediente; no hay lectura automática | Después |
| Cálculo: fórmulas, actividad, objetivo, macros con deslizadores | Tenemos, con más fórmulas (8), reparto editable y comparación de ecuaciones | — |
| Gráfica de dona de macros | Tenemos barra y tabla con color; la dona es estética | Opcional |
| Tipo de dieta (cambia qué equivalentes son posibles) | Falta | Fase F |
| Cuadro de equivalentes SMAE | Tenemos (17 grupos, deslizadores, distribución editable, auditoría por objetivo) | — |
| **Menú semanal generado** por IA respetando alergias y gustos | Parcial: «Sugerir platillos» por tiempo de comida | Fase A: **generador determinista y explicable** |
| **Indicaciones y suplementación** (tabla) | **Nuevo:** pestaña «Entrega» | Hecho |
| **Documento para el paciente** + descargar | **Nuevo:** vista previa en vivo, 4 estilos, imprime solo el documento (PDF) | Hecho |
| **Enviar por WhatsApp / correo** | **Nuevo:** abre la conversación con el mensaje listo (no adjunta solo: el navegador no puede) | Hecho |
| **Próxima consulta** (2/4/6 semanas, hora) | **Nuevo:** agenda la consulta de seguimiento en la agenda existente | Hecho |
| Cerrar la consulta («Finalizar») y registrar | Parcial (se guarda la dieta) | Fase C |

## Qué se construyó en esta entrega
Pestaña **Entrega** en el Dietocálculo (`dc-entrega.ts`) y documento imprimible (`handout.ts`):
1. **Indicaciones** (hasta 1200 caracteres) y **suplementación** (hasta 12; nombre, cuánto, cuándo, cómo). Son parte de la dieta guardada: el backend (`Inputs.Indications/Supplements`) las valida igual que el cliente. No intervienen en ningún cálculo, así que los vectores de paridad Go/TS no cambian.
2. **Documento del paciente:** marca de la consulta (logotipo, credenciales, cédula), energía y macros, porciones por tiempo de comida con sus platillos, indicaciones y tabla de suplementos. Cuatro estilos (Clásico, Minimalista, Editorial, Amigable) y diez acentos; la elección se recuerda en el navegador.
3. **Envío:** descargar PDF (imprime solo el documento), WhatsApp (`wa.me` con el teléfono del expediente, 10 dígitos → +52) y correo (`mailto`).
4. **Próxima consulta:** 2, 4 o 6 semanas, fecha y hora de media en media hora, presencial o en línea; usa la agenda existente y avisa si hay empalme.

## Dónde nos diferenciamos (y cómo reforzarlo)
- **Reproducible y auditable:** precisión decimal, planes y platillos versionados, alertas que explican su origen. La referencia vende «IA»; nosotros vendemos que **cada número se puede explicar**.
- **Sin enviar datos clínicos a terceros:** el menú se genera en el propio sistema (Fase A) con reglas visibles: alergias y gustos del expediente, equivalentes por tiempo y variedad.
- **Seguimiento de la paciente** (app, fotos, comentarios, cumplimiento) y **reportes**: la referencia termina en el PDF.
- **Auditoría empírica por objetivo clínico** y comparación de ecuaciones de gasto energético.

## Hoja de ruta (cada fase se libera sola)
- **A. Generador de menú explicable:** 7 días a partir del reparto por tiempo, platillos activos, alergias/gustos del expediente, variedad y complejidad; muestra por qué eligió cada platillo; la nutrióloga ajusta antes de entregar.
- **B. Perfil profesional ampliado:** «sobre ti», especialidad, modalidad, dirección estructurada y su visibilidad; base para una tarjeta pública.
- **C. Consulta guiada:** asistente de cinco pasos que une alta/selección de paciente, antropometría, cálculo, menú y entrega, con «Finalizar consulta».
- **D. Expediente ampliado:** estilo de vida, salud intestinal (escala de Bristol), heredofamiliares y contacto de emergencia (migración + pantallas + pruebas).
- **E. Antropometría:** Jackson-Pollock 4 y guía ilustrada de medición.
- **F. Tipos de dieta:** perfiles que restringen los grupos de equivalentes posibles.

## Límites conocidos de esta entrega
- WhatsApp y correo **no adjuntan** el PDF: se descarga y se adjunta a mano. Adjuntarlo automáticamente exigiría un servicio de mensajería (WhatsApp Business API) o correo desde el servidor; se evaluará aparte.
- Las preferencias del documento (estilo y acento) viven en el navegador, no en la cuenta.
- El documento no incluye aún tablas de platillos con receta; solo nombre y cantidad.
