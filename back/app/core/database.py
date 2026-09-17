from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.core.config import DATABASE_URL

# Motor de conexión a PostgreSQL
engine = create_engine(DATABASE_URL)

# Fábrica de sesiones para interactuar con la DB en cada request
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Clase base de la que van a heredar todos los modelos de tablas (SQLAlchemy 2.0 style)
Base = declarative_base()

# Dependencia de FastAPI para abrir y cerrar sesiones de DB limpiamente
def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception:
        # Si algo falla a mitad de un request, revertir cualquier cambio
        # pendiente en vez de dejarlo en manos del close() implícito.
        db.rollback()
        raise
    finally:
        db.close()