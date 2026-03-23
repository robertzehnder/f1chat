from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine


load_dotenv()


@dataclass(frozen=True)
class DbConfig:
    host: str
    port: int
    name: str
    user: str
    password: str

    def to_sqlalchemy_url(self) -> str:
        return (
            f"postgresql+psycopg://{self.user}:{self.password}@"
            f"{self.host}:{self.port}/{self.name}"
        )


def get_db_config(prefix: str) -> DbConfig:
    return DbConfig(
        host=os.environ[f"{prefix}_DB_HOST"],
        port=int(os.environ[f"{prefix}_DB_PORT"]),
        name=os.environ[f"{prefix}_DB_NAME"],
        user=os.environ[f"{prefix}_DB_USER"],
        password=os.environ[f"{prefix}_DB_PASSWORD"],
    )


def get_engine(prefix: str) -> Engine:
    cfg = get_db_config(prefix)
    return create_engine(cfg.to_sqlalchemy_url(), future=True)


def fetch_scalar(engine: Engine, sql: str, params: dict | None = None):
    with engine.begin() as conn:
        return conn.execute(text(sql), params or {}).scalar()


def execute(engine: Engine, sql: str, params: dict | None = None) -> None:
    with engine.begin() as conn:
        conn.execute(text(sql), params or {})
