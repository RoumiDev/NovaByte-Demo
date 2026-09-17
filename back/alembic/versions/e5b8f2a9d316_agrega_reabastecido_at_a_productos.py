"""agrega reabastecido_at a productos

Nueva columna nullable, arranca vacía para los productos que ya existen
(no hay forma de reconstruir cuándo se reabastecieron en el pasado). Se
completa a partir de ahora, en update_product, cada vez que el stock de un
producto pasa de 0 a positivo -- el Home de la tienda ordena por el más
reciente entre created_at y reabastecido_at, así que un producto que se
agotó y se volvió a cargar aparece de nuevo como "recién ingresado".

Revision ID: e5b8f2a9d316
Revises: c4a7e1f39d02
Create Date: 2026-08-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5b8f2a9d316'
down_revision: Union[str, Sequence[str], None] = 'c4a7e1f39d02'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('productos', sa.Column('reabastecido_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('productos', 'reabastecido_at')
