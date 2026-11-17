# M1 · Cuentas aisladas (consultas)

> Interno. Primer bloque del modelo de negocio (planes, registro abierto y cobro): cada consulta (nutrióloga y sus
> pacientes) tiene su propio espacio de datos. **Es lo que permite abrir el registro**: sin esto, todas las cuentas
> compartirían pacientes.

## Cómo funciona

El aislamiento lo impone **PostgreSQL con seguridad por filas (RLS)**, no el código de cada módulo:

1. Cada tabla con datos de una consulta tiene `practice_id` (NOT NULL, con índice) y una política `tenant_isolation`:
   solo se ven y se escriben las filas cuya `practice_id` es la de la sesión (`app.practice_id`).
2. `practice_id` **se llena solo** (`DEFAULT app_practice_id()`): ninguna consulta SQL ni módulo tuvo que cambiar.
3. La consulta sale del usuario autenticado (columna `users.practice_id`, leída de la base en cada petición; nunca del
   token ni de la petición). El middleware `Authenticate` la pone en el contexto (`tenant.With`) y el pool la fija en cada
   conexión al tomarla (`tenant.ConfigurePool`, gancho `BeforeAcquire`).
4. **Falla cerrado:** sin consulta en el contexto la base no devuelve ni acepta ninguna fila. Un olvido produce «no hay
   datos», no una fuga.
5. Las operaciones que cruzan consultas por diseño usan `tenant.Bypass(ctx)` (buscar un enlace de calendario público,
   crear una consulta, trabajos en segundo plano que recorren consultas). Nunca se construye a partir de datos del usuario.

Tablas globales (sin RLS): `users`, `roles`, `permissions`, asignaciones, sesiones, tokens de recuperación y el
**catálogo SMAE** (compartido y de solo lectura para las consultas). `practices` y `audit_logs` tienen políticas propias
(las filas de auditoría sin consulta —intentos de ingreso de cuentas inexistentes— solo las ve la plataforma).

## Requisito de despliegue: la API NO puede ser superusuario

Un superusuario o un rol con `BYPASSRLS` **ignora** las políticas. Por eso:

- La migración `000013` crea el rol `nutri_app` (sin superusuario, sin BYPASSRLS) con permisos de datos.
- Variable nueva **`APP_DB_PASSWORD`** (por ambiente). `deploy.sh` la genera; `release.sh` la agrega si el ambiente es
  anterior. Al arrancar, la API migra con `DATABASE_URL` (propietario), le da contraseña a `nutri_app` y **se conecta como
  ese rol**. Alternativa: `APP_DATABASE_URL` con una conexión completa.
- **En producción la API se niega a arrancar** si su rol puede saltarse RLS (`tenant.VerifyRole`). En desarrollo solo avisa.

## Esta liberación NO tiene reversa por imagen

Las migraciones normalmente son compatibles hacia atrás; **esta no**. La versión anterior del código inserta sin
`practice_id` y fallaría. Por eso:

- `release.sh` ya hace **respaldo previo** en producción. Si algo falla, la reversa es **restaurar ese respaldo**, no
  volver a la imagen anterior.
- **Ensayo obligatorio antes de producción:** cargar una copia reciente de producción en staging, liberar ahí y comparar
  conteos (pacientes, planes, platillos, citas, archivos, mediciones) antes y después. La prueba
  `TestMigrationKeepsExistingData` cubre el mecanismo; el ensayo cubre los datos reales.
- Existe `000013…down.sql` (solo para desarrollo).

## Qué pasa con la cuenta actual

Todo lo existente queda en la **consulta #1** (con el nombre comercial guardado). No se mueve ni borra nada: la migración
solo agrega columnas y asigna la consulta. Si ya tenía marca guardada, **no repite el inicio guiado**.

## Para quien programa

- **Tabla nueva con datos de una consulta:** añade `practice_id uuid NOT NULL DEFAULT app_practice_id()` + FK + índice +
  `ENABLE`/`FORCE ROW LEVEL SECURITY` + política (copiar de la migración `000013`). La prueba
  `TestEveryTenantTableIsProtected` **falla** si falta, y si de verdad es global hay que listarla en `globalTables`.
- **Contexto:** en una petición ya viene limitado. En trabajos o pruebas: `tenant.With(ctx, id)`; para recorrer consultas,
  `forEachPractice` en `cmd/api/main.go`.
- **Cuentas:** `auth.CreateUser` con consulta en el contexto se une a ella; sin consulta, una nutrióloga abre la suya y
  cualquier otro rol da `ErrNoPractice`. CLI: `admin create-user … [-practice <id>]` (pacientes: obligatorio).
- **Pruebas:** `testsupport.NewPool` conecta como `nutri_app`; `NewPractice` crea una consulta y devuelve su contexto;
  `NewPools` da además un pool de administración para preparar o comprobar por encima del aislamiento.
- **Las unicidades** ahora son por consulta (correo de paciente, textos legales, claves de configuración).

## Cambios visibles

- La pantalla de ingreso muestra la marca **de la plataforma** («Nutrición Integral»): antes de iniciar sesión no se sabe de
  qué consulta es la persona. Cada consulta ve su marca al entrar.
- El mismo correo de paciente puede existir en dos consultas (las **cuentas de acceso** siguen siendo únicas por correo).

## Verificación hecha

- Toda la suite de Go corre bajo RLS real (rol sin superusuario): sin cambios de comportamiento.
- `TestRowLevelIsolation`: cada consulta ve lo suyo; falla cerrado; no se escribe en otra consulta ni se «regala» un registro; el rol de la API no se salta las políticas.
- `TestTwoPracticesCannotSeeEachOther`: dos consultas con la API completa; B intenta leer y escribir lo de A en pacientes, platillos, planes, agenda, calendario público, dietocálculo, configuración, auditoría y rutas de paciente.
- `TestEveryTenantTableIsProtected`: guarda contra tablas nuevas sin aislamiento.
- `TestMigrationKeepsExistingData`: la migración conserva y asigna todo (incluidas tablas de solo inserción).
- `TestStartupRoleSetup`: el arranque real (propietario → rol de la API con contraseña escapada).

## Lo que M1 NO hace (y bloquea el registro abierto, M3)

1. **Permiso `smae:manage` de las nutriólogas:** hoy puede importar/activar ediciones del catálogo, que es **global**. Con
   varias consultas, solo la plataforma debe poder hacerlo. Hay que quitarlo del rol y moverlo a la CLI/CRM antes de M3.
2. **Archivos:** las llaves de almacenamiento aún no llevan prefijo de consulta (el acceso sí está protegido por las
   filas de `file_objects`); se resuelve con M7.
3. **Varias profesionales por consulta:** la base ya lo permite (varios usuarios con la misma `practice_id`); falta el rol
   `owner/member` y las invitaciones de equipo.
4. **Límites de plan, registro y cobro:** M2, M3 y M4.
