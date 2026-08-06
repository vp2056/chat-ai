"""Camada de acesso ao SQLite3 (stdlib, sem ORM)."""
import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from typing import Any, Iterator, Optional

from . import config

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS chats (
    id            TEXT PRIMARY KEY,
    title         TEXT    NOT NULL DEFAULT 'Nova conversa',
    model         TEXT    NOT NULL,
    system_prompt TEXT,
    pinned        INTEGER NOT NULL DEFAULT 0,
    archived      INTEGER NOT NULL DEFAULT 0,
    created_at    REAL    NOT NULL,
    updated_at    REAL    NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    chat_id    TEXT    NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role       TEXT    NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content    TEXT    NOT NULL DEFAULT '',
    model      TEXT,
    thinking   TEXT,
    error      TEXT,
    stats      TEXT,
    created_at REAL    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats(updated_at DESC);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def new_id() -> str:
    return uuid.uuid4().hex


def now() -> float:
    return time.time()


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    """Abre uma conexão por operação — barato no SQLite e seguro entre threads."""
    conn = sqlite3.connect(config.DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_conn() as conn:
        conn.executescript(SCHEMA)


# --------------------------------------------------------------------------- #
# Configurações persistidas
# --------------------------------------------------------------------------- #
def get_setting(key: str, default: Any = None) -> Any:
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    if row is None:
        return default
    try:
        return json.loads(row["value"])
    except json.JSONDecodeError:
        return row["value"]


def set_setting(key: str, value: Any) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, json.dumps(value)),
        )


def all_settings() -> dict[str, Any]:
    with get_conn() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    out: dict[str, Any] = {}
    for row in rows:
        try:
            out[row["key"]] = json.loads(row["value"])
        except json.JSONDecodeError:
            out[row["key"]] = row["value"]
    return out


# --------------------------------------------------------------------------- #
# Conversas
# --------------------------------------------------------------------------- #
def _chat_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "model": row["model"],
        "system_prompt": row["system_prompt"],
        "pinned": bool(row["pinned"]),
        "archived": bool(row["archived"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "message_count": row["message_count"] if "message_count" in row.keys() else None,
        "preview": row["preview"] if "preview" in row.keys() else None,
    }


def create_chat(title: str, model: str, system_prompt: Optional[str]) -> dict:
    chat_id, ts = new_id(), now()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO chats (id, title, model, system_prompt, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (chat_id, title, model, system_prompt, ts, ts),
        )
    return get_chat(chat_id)  # type: ignore[return-value]


def list_chats(archived: bool = False, query: Optional[str] = None) -> list[dict]:
    sql = """
        SELECT c.*,
               (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS message_count,
               (SELECT m.content FROM messages m
                 WHERE m.chat_id = c.id AND m.role = 'user'
                 ORDER BY m.created_at LIMIT 1) AS preview
          FROM chats c
         WHERE c.archived = ?
    """
    params: list[Any] = [1 if archived else 0]
    if query:
        sql += """ AND (c.title LIKE ? OR EXISTS (
                     SELECT 1 FROM messages m
                      WHERE m.chat_id = c.id AND m.content LIKE ?))"""
        like = f"%{query}%"
        params += [like, like]
    sql += " ORDER BY c.pinned DESC, c.updated_at DESC"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_chat_row(r) for r in rows]


def get_chat(chat_id: str) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute(
            """SELECT c.*,
                      (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id) AS message_count,
                      (SELECT m.content FROM messages m
                        WHERE m.chat_id = c.id AND m.role = 'user'
                        ORDER BY m.created_at LIMIT 1) AS preview
                 FROM chats c WHERE c.id = ?""",
            (chat_id,),
        ).fetchone()
    return _chat_row(row) if row else None


def update_chat(chat_id: str, **fields: Any) -> Optional[dict]:
    allowed = {"title", "model", "system_prompt", "pinned", "archived"}
    sets, params = [], []
    for key, value in fields.items():
        if key in allowed and value is not None:
            sets.append(f"{key} = ?")
            params.append(int(value) if key in {"pinned", "archived"} else value)
    if not sets:
        return get_chat(chat_id)
    sets.append("updated_at = ?")
    params += [now(), chat_id]
    with get_conn() as conn:
        conn.execute(f"UPDATE chats SET {', '.join(sets)} WHERE id = ?", params)
    return get_chat(chat_id)


def touch_chat(chat_id: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE chats SET updated_at = ? WHERE id = ?", (now(), chat_id))


def delete_chat(chat_id: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM chats WHERE id = ?", (chat_id,))
    return cur.rowcount > 0


def delete_all_chats() -> int:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM chats")
    return cur.rowcount


# --------------------------------------------------------------------------- #
# Mensagens
# --------------------------------------------------------------------------- #
def _message_row(row: sqlite3.Row) -> dict:
    stats = None
    if row["stats"]:
        try:
            stats = json.loads(row["stats"])
        except json.JSONDecodeError:
            stats = None
    return {
        "id": row["id"],
        "chat_id": row["chat_id"],
        "role": row["role"],
        "content": row["content"],
        "model": row["model"],
        "thinking": row["thinking"],
        "error": row["error"],
        "stats": stats,
        "created_at": row["created_at"],
    }


def add_message(
    chat_id: str,
    role: str,
    content: str = "",
    model: Optional[str] = None,
    thinking: Optional[str] = None,
    error: Optional[str] = None,
    stats: Optional[dict] = None,
) -> dict:
    msg_id, ts = new_id(), now()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO messages (id, chat_id, role, content, model, thinking, error, stats, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (msg_id, chat_id, role, content, model, thinking, error,
             json.dumps(stats) if stats else None, ts),
        )
        conn.execute("UPDATE chats SET updated_at = ? WHERE id = ?", (ts, chat_id))
    return get_message(msg_id)  # type: ignore[return-value]


def update_message(msg_id: str, **fields: Any) -> Optional[dict]:
    allowed = {"content", "thinking", "error", "stats", "model"}
    sets, params = [], []
    for key, value in fields.items():
        if key not in allowed:
            continue
        sets.append(f"{key} = ?")
        params.append(json.dumps(value) if key == "stats" and value is not None else value)
    if not sets:
        return get_message(msg_id)
    params.append(msg_id)
    with get_conn() as conn:
        conn.execute(f"UPDATE messages SET {', '.join(sets)} WHERE id = ?", params)
    return get_message(msg_id)


def get_message(msg_id: str) -> Optional[dict]:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM messages WHERE id = ?", (msg_id,)).fetchone()
    return _message_row(row) if row else None


def list_messages(chat_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at, rowid",
            (chat_id,),
        ).fetchall()
    return [_message_row(r) for r in rows]


def delete_message(msg_id: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM messages WHERE id = ?", (msg_id,))
    return cur.rowcount > 0


def delete_messages_from(chat_id: str, msg_id: str) -> int:
    """Remove a mensagem indicada e todas as posteriores (usado por editar/regenerar)."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT created_at, rowid FROM messages WHERE id = ? AND chat_id = ?",
            (msg_id, chat_id),
        ).fetchone()
        if row is None:
            return 0
        cur = conn.execute(
            "DELETE FROM messages WHERE chat_id = ? AND "
            "(created_at > ? OR (created_at = ? AND rowid >= ?))",
            (chat_id, row["created_at"], row["created_at"], row["rowid"]),
        )
    return cur.rowcount


def search_messages(query: str, limit: int = 50) -> list[dict]:
    like = f"%{query}%"
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT m.id, m.chat_id, m.role, m.content, m.created_at, c.title
                 FROM messages m JOIN chats c ON c.id = m.chat_id
                WHERE m.content LIKE ?
                ORDER BY m.created_at DESC LIMIT ?""",
            (like, limit),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "chat_id": r["chat_id"],
            "chat_title": r["title"],
            "role": r["role"],
            "content": r["content"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


def stats() -> dict:
    with get_conn() as conn:
        chats = conn.execute("SELECT COUNT(*) AS n FROM chats").fetchone()["n"]
        msgs = conn.execute("SELECT COUNT(*) AS n FROM messages").fetchone()["n"]
    size = config.DB_PATH.stat().st_size if config.DB_PATH.exists() else 0
    return {"chats": chats, "messages": msgs, "db_bytes": size, "db_path": str(config.DB_PATH)}
