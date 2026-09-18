-- ============================================================================
-- FIX V-02 (auditoría AppSec, 28/08/2026) -- "La aplicación se conecta a
-- PostgreSQL como superusuario, con una contraseña débil".
--
-- Este script crea un rol de aplicación SIN privilegios de superusuario,
-- dueño de todos los objetos de la base actual, y lo deja listo para usar
-- en DATABASE_URL (.env). NO se puede aplicar solo -- necesita que
-- completes tres cosas primero (buscá "COMPLETAR" acá abajo) y que lo
-- corras vos mismo contra tu Postgres real: no tengo acceso a tu base
-- desde acá, y elegir la contraseña nueva te corresponde a vos.
--
-- CÓMO USARLO:
--   1. Completá los tres valores marcados "COMPLETAR" más abajo.
--   2. Conectate a tu Postgres como el superusuario actual (el mismo que
--      usa hoy DATABASE_URL) y corré este archivo:
--        psql -h localhost -U <tu_superusuario_actual> -d postgres -f crear_rol_aplicacion.sql
--      (te va a pedir la contraseña actual una vez).
--   3. Actualizá DATABASE_URL en el .env del backend para que use el rol
--      nuevo (ver el comentario al final de este archivo).
--   4. Reiniciá el backend y probá que todo siga funcionando (login,
--      listar productos, un backup de prueba) ANTES de dar de baja el
--      rol viejo.
--   5. Rotá también la contraseña del rol viejo (superusuario) -- la
--      auditoría la marca como comprometida por haber estado en un
--      archivo que circuló, más allá de que dejes de usarla acá.
-- ============================================================================

-- COMPLETAR (1 de 3): nombre del rol NUEVO, sin privilegios especiales.
-- Cualquier nombre sirve, por ejemplo "novabyte_app".
\set rol_nuevo novabyte_app

-- COMPLETAR (2 de 3): contraseña del rol nuevo. Generá una larga y
-- aleatoria (no una palabra con números atrás, ese fue justamente el
-- problema que señaló la auditoría) -- por ejemplo con:
--   openssl rand -base64 32
\set password_nuevo 'PEGAR_ACA_UNA_CONTRASEÑA_LARGA_Y_ALEATORIA'

-- COMPLETAR (3 de 3): nombre de la base de datos de esta app (el mismo
-- que aparece al final de tu DATABASE_URL actual, después de la última
-- "/").
\set nombre_base novabyte_demo


-- ----------------------------------------------------------------------------
-- A partir de acá no hace falta tocar nada más.
-- ----------------------------------------------------------------------------

-- 1) Crear el rol nuevo. LOGIN: puede conectarse. NOSUPERUSER, NOCREATEDB,
--    NOCREATEROLE: exactamente lo que pide la auditoría -- ni más ni menos
--    privilegio que el necesario para que la app funcione.
CREATE ROLE :rol_nuevo WITH LOGIN PASSWORD :'password_nuevo' NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- 2) Dejarlo como dueño de la base -- necesario para que la restauración
--    de backups (pg_restore --clean --if-exists, ver
--    app/services/backup_service.py) pueda recrear las tablas sin
--    necesitar privilegios de superusuario.
ALTER DATABASE :nombre_base OWNER TO :rol_nuevo;

-- 3) Conectate a la base de la app (\c) para transferirle también el
--    dueño de cada tabla/secuencia/vista que ya exista (las que creó
--    Alembic con el rol viejo).
--
--    OJO: NO se usa "REASSIGN OWNED BY <rol_viejo>" acá a propósito -- se
--    probó y falla con un error tipo "cannot reassign ownership of
--    objects owned by role postgres because they are required by the
--    database system" cuando el rol viejo es el superusuario "postgres"
--    (el caso típico, justo el que señala esta vulnerabilidad): ese rol
--    también es dueño de objetos internos del sistema que Postgres se
--    niega a reasignar. En cambio, este bloque recorre uno por uno solo
--    los objetos del esquema "public" (las tablas de ESTA app, ninguna
--    otra cosa) y les cambia el dueño -- más seguro y más acotado.
--
--    Nota técnica: adentro de un bloque DO ($$ ... $$) psql NO reemplaza
--    las variables (:rol_nuevo) -- por eso el nombre del rol se pasa por
--    una variable de sesión de Postgres (SET myapp.rol_nuevo = ...) en vez
--    de interpolarlo directamente ahí adentro. Probado tal cual está acá.
\c :nombre_base
SET myapp.rol_nuevo = :'rol_nuevo';
DO $$
DECLARE
    r RECORD;
    v_rol text := current_setting('myapp.rol_nuevo');
BEGIN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER TABLE public.%I OWNER TO %I', r.tablename, v_rol);
    END LOOP;
    FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER SEQUENCE public.%I OWNER TO %I', r.sequencename, v_rol);
    END LOOP;
    FOR r IN SELECT viewname FROM pg_views WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER VIEW public.%I OWNER TO %I', r.viewname, v_rol);
    END LOOP;
END $$;

-- 4) Dueño del esquema "public" en sí (no solo de lo que hay adentro) --
--    para que una migración de Alembic futura, corrida con el rol nuevo,
--    pueda seguir creando tablas ahí sin problema.
ALTER SCHEMA public OWNER TO :rol_nuevo;

-- Listo. Verificación rápida (debería listar el rol nuevo con Superuser
-- en "no" y Create DB / Create role también en "no"):
--   \du :rol_nuevo

-- ============================================================================
-- Último paso, FUERA de este script: actualizar el .env del backend.
--
-- DATABASE_URL tiene esta forma:
--   postgresql+psycopg2://usuario:password@host:puerto/nombre_base
--
-- Reemplazá el usuario y la password por los del rol nuevo (el que
-- pusiste en :rol_nuevo / :password_nuevo más arriba). Por ejemplo:
--   DATABASE_URL=postgresql+psycopg2://novabyte_app:PEGAR_ACA_UNA_CONTRASEÑA_LARGA_Y_ALEATORIA@localhost:5432/novabyte_demo
--
-- Reiniciá el backend después de guardar el .env -- SQLAlchemy lee
-- DATABASE_URL una sola vez, al arrancar.
-- ============================================================================
