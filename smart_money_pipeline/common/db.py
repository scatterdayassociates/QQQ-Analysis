"""
Postgres connection and session management for Smart Money Pipeline.
Handles connection pooling and transaction management.
"""

import os
import logging
from contextlib import contextmanager
from typing import Generator, Optional

import psycopg2
from psycopg2 import pool, sql, extras
from psycopg2.extensions import connection as psycopg2_connection
from psycopg2.extensions import cursor as psycopg2_cursor

logger = logging.getLogger(__name__)

# Connection pool (module-level singleton)
_connection_pool: Optional[pool.SimpleConnectionPool] = None


def initialize_pool(
    minconn: int = 1,
    maxconn: int = 10,
    host: Optional[str] = None,
    port: Optional[int] = None,
    database: Optional[str] = None,
    user: Optional[str] = None,
    password: Optional[str] = None,
    sslmode: str = "require",
) -> None:
    """
    Initialize the connection pool. Called once at application startup.

    Args:
        minconn: Minimum number of connections in pool
        maxconn: Maximum number of connections in pool
        host: Database host (defaults to DATABASE_HOST env var)
        port: Database port (defaults to DATABASE_PORT env var)
        database: Database name (defaults to DATABASE_NAME env var)
        user: Database user (defaults to DATABASE_USER env var)
        password: Database password (defaults to DATABASE_PASSWORD env var)
        sslmode: SSL mode for connection (default: require)
    """
    global _connection_pool

    # Use provided values or fall back to environment variables
    host = host or os.getenv("DATABASE_HOST")
    port = port or int(os.getenv("DATABASE_PORT", "5432"))
    database = database or os.getenv("DATABASE_NAME")
    user = user or os.getenv("DATABASE_USER")
    password = password or os.getenv("DATABASE_PASSWORD")

    if not all([host, database, user, password]):
        raise ValueError(
            "Missing database configuration. Set DATABASE_HOST, DATABASE_NAME, "
            "DATABASE_USER, and DATABASE_PASSWORD environment variables."
        )

    try:
        _connection_pool = pool.SimpleConnectionPool(
            minconn,
            maxconn,
            host=host,
            port=port,
            database=database,
            user=user,
            password=password,
            sslmode=sslmode,
        )
        logger.info(
            f"Connection pool initialized: {user}@{host}:{port}/{database} "
            f"(min={minconn}, max={maxconn})"
        )
    except Exception as e:
        logger.error(f"Failed to initialize connection pool: {e}")
        raise


def get_connection() -> psycopg2_connection:
    """
    Get a connection from the pool.

    Returns:
        A psycopg2 connection object

    Raises:
        RuntimeError: If pool not initialized
        psycopg2.DatabaseError: If connection fails
    """
    global _connection_pool

    if _connection_pool is None:
        raise RuntimeError(
            "Connection pool not initialized. Call initialize_pool() first."
        )

    try:
        conn = _connection_pool.getconn()
        # Set autocommit to False by default (use explicit transactions)
        conn.autocommit = False
        return conn
    except Exception as e:
        logger.error(f"Failed to get connection from pool: {e}")
        raise


def return_connection(conn: psycopg2_connection) -> None:
    """Return a connection to the pool."""
    global _connection_pool

    if _connection_pool is None:
        return

    try:
        _connection_pool.putconn(conn)
    except Exception as e:
        logger.error(f"Failed to return connection to pool: {e}")


def close_pool() -> None:
    """Close all connections in the pool. Call at application shutdown."""
    global _connection_pool

    if _connection_pool is None:
        return

    try:
        _connection_pool.closeall()
        logger.info("Connection pool closed")
    except Exception as e:
        logger.error(f"Error closing connection pool: {e}")


@contextmanager
def get_cursor(
    connection: Optional[psycopg2_connection] = None,
    commit: bool = True,
) -> Generator[psycopg2_cursor, None, None]:
    """
    Context manager for database cursors with automatic transaction handling.

    Args:
        connection: Optional existing connection. If None, gets one from pool.
        commit: Whether to commit on success (default: True)

    Yields:
        A psycopg2 cursor with RealDictCursor factory for dict-like rows

    Example:
        with get_cursor() as cur:
            cur.execute("SELECT * FROM scores WHERE ticker = %s", ("AAPL",))
            row = cur.fetchone()
    """
    conn = connection or get_connection()
    owned_connection = connection is None

    try:
        # Use RealDictCursor for dict-like row access
        cur = conn.cursor(cursor_factory=extras.RealDictCursor)
        try:
            yield cur
            if commit:
                conn.commit()
                logger.debug("Transaction committed")
        except Exception as e:
            conn.rollback()
            logger.error(f"Transaction rolled back due to error: {e}")
            raise
        finally:
            cur.close()
    finally:
        if owned_connection:
            return_connection(conn)


def execute_query(
    query: str,
    params: tuple = (),
    fetch_one: bool = False,
    fetch_all: bool = False,
) -> Optional[dict] | list[dict]:
    """
    Execute a SELECT query and return results.

    Args:
        query: SQL query string
        params: Query parameters tuple
        fetch_one: Return single row (dict) instead of all rows
        fetch_all: Return all rows as list of dicts (default if not fetch_one)

    Returns:
        Single dict if fetch_one=True, list of dicts otherwise
    """
    with get_cursor() as cur:
        cur.execute(query, params)
        if fetch_one:
            return cur.fetchone()
        else:
            return cur.fetchall()


def execute_upsert(
    table: str,
    values: dict,
    unique_keys: tuple,
) -> None:
    """
    Upsert (insert or update) a row.

    Args:
        table: Table name
        values: Dict of column: value pairs
        unique_keys: Tuple of column names that form the natural key

    Example:
        execute_upsert(
            "scores",
            {"ticker": "AAPL", "as_of_date": "2026-08-07", "composite_score": 75},
            unique_keys=("ticker", "as_of_date")
        )
    """
    if not values or not unique_keys:
        raise ValueError("values and unique_keys are required")

    columns = list(values.keys())
    value_placeholders = ", ".join(["%s"] * len(columns))
    set_clause = ", ".join([f"{col} = EXCLUDED.{col}" for col in columns])
    unique_key_str = ", ".join(unique_keys)

    query = f"""
    INSERT INTO {table} ({", ".join(columns)})
    VALUES ({value_placeholders})
    ON CONFLICT ({unique_key_str}) DO UPDATE SET
    {set_clause}
    """

    with get_cursor() as cur:
        cur.execute(query, tuple(values.values()))


def table_exists(table_name: str) -> bool:
    """Check if a table exists in the database."""
    query = """
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = %s
    )
    """
    result = execute_query(query, (table_name,), fetch_one=True)
    return result["exists"] if result else False
