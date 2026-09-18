from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import NullPool
from app.core.config import DATABASE_URL

# Motor de conexión a PostgreSQL.
#
# FIX (17/09/2026, deploy en Vercel): antes esto era create_engine(DATABASE_URL)
# a secas -- SQLAlchemy arma por default un pool de conexiones (QueuePool)
# que mantiene conexiones abiertas y las reutiliza ENTRE requests, dentro
# del mismo proceso. Eso funciona bien en un servidor de siempre (uvicorn
# corriendo sin parar), pero en una función serverless de Vercel cada
# invocación puede arrancar en una instancia nueva -- un pool "caliente" ahí
# no aporta nada (nadie reutiliza esas conexiones entre invocaciones
# distintas) y, peor, puede dejar conexiones abiertas colgadas si la
# instancia se recicla de golpe. NullPool: no mantiene NINGUNA conexión
# entre usos, abre una nueva por cada checkout y la cierra al terminar --
# el costo de esa apertura constante lo absorbe el pooler propio de Neon
# (ver DEPLOY.md, connection string en modo "pooled"), que es justamente
# para esto. pool_pre_ping=True: descarta y reabre una conexión que
# resulte estar muerta (ej. cerrada por el otro lado tras estar inactiva)
# en vez de fallar el request con un error de conexión -- barato con
# NullPool porque no hay conexiones reales quedando abiertas para
# chequear. En desarrollo local esto es un poquito menos eficiente que el
# pool de siempre, pero para una demo no es un costo que se note.
engine = create_engine(DATABASE_URL, poolclass=NullPool, pool_pre_ping=True)

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