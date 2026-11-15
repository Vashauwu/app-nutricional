# Design system: Nutrición Integral

Registro del sistema visual tal como está implementado (frontend Angular + Taiga UI). Las fuentes de verdad son
`frontend/src/styles/_tokens.scss` y `_components.scss`. Producto y audiencia: ver `PRODUCT.md`.

## Principio rector: calma clínica con calidez

El color es **significado**, no decoración. Una superficie con fondo de color siempre quiere decir algo
(alerta, éxito, aviso, estado). Todo lo demás va sobre marfil y blanco, con el ciruela como tinta.

## Color

| Rol | Token | Valor (claro) | Uso |
|---|---|---|---|
| Fondo | `--nutri-marfil` | `#FAF7F2` | Fondo de página |
| Superficie | `--surface` | `#FFFFFF` | Tarjetas, tablas, formularios |
| Texto | `--nutri-texto` | `#514653` (8.4 : 1 sobre marfil) | Texto principal |
| Tinta de marca | `--brand-ink` | `#4E344C` (10.2 : 1) | Botón principal, foco, acentos. Cada consulta puede reemplazarla en Configuración |
| Información | `--nutri-cielo` | `#D8E8F2` | Solo avisos informativos |
| Éxito | `--nutri-salvia` | `#D7E8D5` | Solo completado / correcto |
| Advertencia | `--nutri-mantequilla` | `#F8E8B8` | Solo advertencia |
| Crítico | `--nutri-rosa` | `#F4C9D6` | Solo crítico |
| Selección | `--nutri-lavanda` | `#DDD6F2` | Elemento activo de navegación y selección |

Modo oscuro: `:root[data-theme='dark']` redefine toda la paleta; los pasteles pasan a superficies profundas y
`--brand-ink` a un tono claro. Todo componente se adapta solo.

## Tipografía

- **Playfair Display** (600/700): solo títulos de página (`h1`), el saludo del Inicio y el login.
- **Inter** (400/500/600): todo lo demás. Cifras y tablas con `font-variant-numeric: tabular-nums`.
- Fuentes alojadas localmente (`@fontsource`), sin peticiones a terceros.

## Medidas

- `--page-max` (78rem) y `--field-h` (2.75rem): una sola medida de página y de campo para todas las pantallas.
- Espacio en escala de 4 px: `--space-1` … `--space-7`. Radios: `--radius-s/m/l`.
- Objetivo táctil mínimo `--tap` (2.75rem).

## Componentes compartidos (`src/app/shared/components`)

| Componente | Para qué |
|---|---|
| `PageHeader` | Título, apoyo y acciones. **Una** acción primaria; el resto, secundarias o en menú |
| `ActionMenu` | Menú «Más», tema, cuenta y acciones destructivas apartadas (teclado completo) |
| `ThemeToggle` | Claro · Oscuro · Igual que el sistema, con nombre |
| `CommandPalette` | Búsqueda global Ctrl/Cmd + K: pacientes, planes, platillos y acciones |
| `Combobox` | Selector con búsqueda para listas largas (pacientes) |
| `FileDrop` | Elegir o arrastrar una imagen (sustituye al selector nativo) |
| `AlertRow` / `AlertItem` | Alerta compacta (tablero) / completa (plan) |
| `Skeleton`, `EmptyState`, `Badge`, `Pagination` | Estados de carga, vacío, etiquetas y paginación |

Tablas: clase `table--cards` + `data-label` en cada celda hacen que la tabla pase a tarjetas por debajo de 48 rem;
`tr.clickable` estira el enlace principal sobre toda la fila. Densidad Cómoda/Compacta desde el menú de la cuenta.

## Reglas que se mantienen

- El color nunca es el único portador de significado: toda alerta, estado o diferencia lleva icono y texto.
- Sin franjas de color laterales en alertas, sin kicker sobre un título, sin degradados en texto.
- Acciones destructivas apartadas y con confirmación; lo reversible con «Deshacer».
- Movimiento solo con significado (avisos, barras de avance, menús) y siempre bajo `prefers-reduced-motion`.
- Objetivo WCAG 2.2 AA; se verifica con axe-core sobre las pantallas principales (claro, oscuro, móvil).
- Sin estilos en línea nuevos: usar las utilidades de `_components.scss` (`t-md`, `m-0`, `maxw-*`, …).
