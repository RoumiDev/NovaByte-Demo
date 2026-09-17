import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from alembic import context

# 1. Permite a Alembic encontrar la carpeta 'app'
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# 2. Importar la URL de la base de datos, la Base y los Modelos
from app.core.config import DATABASE_URL
from app.core.database import Base
import app.models  # Registra Usuario, Categoria, Producto, Pedido, etc.

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# 3. Asignar los metadatos de SQLAlchemy a Alembic
target_metadata = Base.metadata

# 4. Inyectar la URL de conexión desde la configuración
config.set_main_option("sqlalchemy.url", str(DATABASE_URL))


def run_migrations_offline() -> None:
    """Ejecutar migraciones en modo offline."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Ejecutar migraciones en modo online (conectado a PostgreSQL)."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()