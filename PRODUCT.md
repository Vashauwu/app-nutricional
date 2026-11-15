# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Nutrióloga (administradora).** Profesional de la nutrición clínica que atiende a pacientes adultos. Trabaja en escritorio durante la consulta y entre consultas, y también desde el celular. Su trabajo: dar de alta pacientes, llevar el expediente clínico y antropométrico, armar platillos y planes alimentarios con equivalentes SMAE, publicarlos, revisar el seguimiento y las alertas, y generar reportes. Hoy es una sola persona por instalación (MVP_SPEC §1, §2.1).

**Paciente.** Persona adulta (el MVP no atiende menores de 18 años) que consulta el plan que su nutrióloga le publicó. Usa la app en el celular, casi siempre con WiFi, en una mezcla de iPhone y Android. El uso diario es breve: ver qué le toca comer, marcar la comida como realizada u omitida, subir una foto o dejar un comentario, y consultar su progreso. Solo ve su propia información y lo que su nutrióloga autorizó.

## Product Purpose

Plataforma web (con PWA para la paciente) que centraliza el ciclo de atención nutricional: expediente, biblioteca de platillos con cálculo nutricional y equivalentes SMAE, planes alimentarios con calendario, publicación a la paciente, seguimiento (comidas, fotos, comentarios), alertas y reportes. Existe para que la nutrióloga dedique su tiempo al criterio profesional y no a armar y reenviar planes a mano, y para que la paciente tenga un plan claro que pueda seguir y registrar sin fricción. El éxito es un plan publicado que la paciente sigue y que la nutrióloga puede revisar y ajustar con datos.

## Positioning

Es una herramienta de **apoyo al criterio profesional**, no un sustituto: calcula con precisión decimal y versiona cada platillo y cada plan, de modo que lo que la paciente vio y registró siempre se puede reconstruir exactamente. Las alertas nutricionales explican su motivo y el dato que las originó, y nunca bloquean la publicación. El cumplimiento (cuántas comidas se marcaron) se reporta por separado de la evolución antropométrica.

Alcance a mediano plazo (confirmado): el producto se ofrecerá a **varias nutriólogas**, cada una con su propia marca. El MVP sigue siendo una sola nutrióloga y no implementa multi-tenant; la arquitectura debe permitir evolucionar a ello.

## Operating Context

- Idioma y región: español de México. Fecha DD/MM/AAAA, peso en kg, estatura y perímetros en cm, ingredientes en g, ml y medidas caseras, moneda MXN, zona horaria `America/Mexico_City` por defecto.
- La nutrióloga trabaja con equivalentes SMAE (Sistema Mexicano de Alimentos Equivalentes) y sus siglas (`CER-SG`, `AOA-MB`, `VER`, `GRA`…).
- Ambientes: producción (`app.nutrintegral.mx`) y staging (`staging.nutrintegral.mx`) en un VPS; staging muestra cuentas de demostración y producción no.
- Un plan pasa por borrador, publicado, finalizado y archivado; la paciente solo ve planes publicados y solo si completó el aviso de privacidad y el consentimiento.
- La paciente puede consultar offline los menús ya cargados; registrar seguimiento y comentarios requiere conexión.
- Aunque el uso es casi siempre con WiFi, se pidió explícitamente que la app funcione bien en redes 3G.

## Capabilities and Constraints

- Roles: nutrióloga y paciente, con autorización validada en el backend (ocultar controles no es seguridad).
- Datos personales y clínicos **sensibles**: aviso de privacidad y consentimiento antes de dar acceso a la paciente; archivos clínicos siempre privados; auditoría de cambios; baja lógica.
- Comunicación limitada a comentarios asociados a cada tiempo de comida (no hay chat independiente en el MVP).
- Fuera de alcance del MVP: multi-tenant, menores de edad, notificaciones por correo/push, MFA obligatorio, administración visual de permisos.
- Marca configurable por la nutrióloga (nombre comercial, logotipo, colores, fotografía y datos para PDF), sin cambios de código.
- Pendientes de producto abiertos (MVP_SPEC §25.2): campos obligatorios del platillo, granularidad de plantillas, reglas de visibilidad de mediciones y documentos, criterio de cumplimiento, estados de conflicto de edición y de sincronización offline.
- Catálogo SMAE: la edición oficial depende de una licencia aún no confirmada; hoy se usa un catálogo sintético de muestra.

## Brand Commitments

- Nombre de la consulta actual: **Nutrición Integral** (dominio `nutrintegral.mx`).
- **El logotipo nuevo es la identidad definitiva de Nutrición Integral** (confirmado): plato con tenedor, zanahoria, fresa y hoja verde, con la variante ciruela `#4E344C` y la variante pastel. Originales en `design/branding/`; derivados en `frontend/public/icons/`.
- Voz: español de México, tuteo cálido y claro; el texto avisa su límite («herramienta de apoyo profesional: no sustituye el criterio clínico»).
- Por ser un producto para varias nutriólogas, esta identidad es la de Nutrición Integral y el valor por defecto de la plataforma, que cada consulta puede reemplazar con la suya.

## Evidence on Hand

- Datos de demostración en el navegador (cuentas `nutri@demo.mx`, `ana@demo.mx`, `daniela@demo.mx`; contraseña de ejemplo). Son de ejemplo, no pacientes reales.
- Catálogo SMAE sintético y fe de erratas de muestra (`backend/internal/smae/sample/`).
- Evaluación de pantallas con 17 capturas reales: `docs/propuesta-rediseno-ui.md` y `docs/ui-audit/`.
- No hay fotografías reales de platillos, testimonios, casos de estudio ni métricas de uso. Ninguno de esos elementos debe inventarse.

## Product Principles

1. **Apoyo, no sustitución.** Todo cálculo y toda alerta muestran su origen y dejan la decisión a la nutrióloga.
2. **Reconstruible.** Cada plan, platillo y registro conserva la versión exacta que se vio; nada se pierde ni se reescribe en silencio.
3. **Cuidado con datos sensibles.** La privacidad, el consentimiento y la separación entre pacientes son parte de la experiencia, no un trámite.
4. **Una acción clara para la paciente.** La app de la paciente se resuelve en menos de un minuto y sin culpa: registrar es fácil y el tono nunca castiga.
5. **Ligera y confiable donde se usa.** Rápida en un celular cualquiera, útil sin conexión para consultar, y honesta sobre cuándo requiere red.

## Accessibility & Inclusion

Objetivo WCAG 2.2 AA (MVP_SPEC §20.1): contraste suficiente, navegación por teclado, foco visible, compatibilidad con lectores de pantalla, etiquetas en formularios, texto alternativo, objetivos táctiles adecuados y no depender solo del color. Las pacientes son adultas de edades diversas: el texto de la app debe ser legible sin acercarlo y respetar la preferencia del sistema de tamaño de letra y de movimiento reducido.
