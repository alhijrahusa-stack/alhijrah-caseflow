from __future__ import annotations

from alembic import context
from sqlalchemy import create_engine, pool

from app import models  # noqa: F401  (register metadata)
from app.config import get_settings
from app.db import Base

target_metadata = Base.metadata


def run_migrations_online() -> None:
    url = context.config.get_main_option("sqlalchemy.url") or get_settings().database_url
    connectable = create_engine(url, poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
