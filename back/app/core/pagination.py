"""Parámetros de paginación compartidos por los routers de listado.

Poner un tope máximo (100) evita que un cliente pida una página gigante y
fuerce una consulta cara — una protección barata contra abuso/DoS por
sobreconsulta, sin tener que repetir los mismos Query(...) en cada router.
"""

from typing import Annotated

from fastapi import Query

Skip = Annotated[int, Query(ge=0, description="Cantidad de resultados a saltear")]
Limit = Annotated[int, Query(ge=1, le=100, description="Cantidad máxima de resultados a devolver")]
