"""Cliente HTTP assíncrono para a API do Ollama."""
import json
from typing import AsyncIterator, Optional

import httpx

from . import config


class OllamaError(RuntimeError):
    pass


def _client(timeout: Optional[float] = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=config.OLLAMA_HOST,
        timeout=httpx.Timeout(timeout or config.OLLAMA_TIMEOUT, connect=10.0),
    )


async def health() -> dict:
    """Verifica se o Ollama está no ar e devolve a versão."""
    try:
        async with _client(timeout=5) as client:
            resp = await client.get("/api/version")
            resp.raise_for_status()
            return {"online": True, "host": config.OLLAMA_HOST, **resp.json()}
    except Exception as exc:  # noqa: BLE001 — qualquer falha significa offline
        return {"online": False, "host": config.OLLAMA_HOST, "error": str(exc)}


async def list_models() -> list[dict]:
    try:
        async with _client(timeout=15) as client:
            resp = await client.get("/api/tags")
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:  # noqa: BLE001
        raise OllamaError(f"Não foi possível listar os modelos: {exc}") from exc

    models = []
    for item in data.get("models", []):
        details = item.get("details") or {}
        models.append(
            {
                "name": item.get("name") or item.get("model"),
                "size": item.get("size"),
                "modified_at": item.get("modified_at"),
                "family": details.get("family"),
                "parameter_size": details.get("parameter_size"),
                "quantization": details.get("quantization_level"),
            }
        )
    models.sort(key=lambda m: m["name"] or "")
    return models


async def show_model(name: str) -> dict:
    async with _client(timeout=30) as client:
        resp = await client.post("/api/show", json={"name": name})
        if resp.status_code >= 400:
            raise OllamaError(f"Modelo '{name}' não encontrado no Ollama.")
        return resp.json()


async def pull_model(name: str) -> AsyncIterator[dict]:
    """Baixa um modelo, transmitindo o progresso. Exige rede na primeira vez."""
    async with _client(timeout=None) as client:
        async with client.stream("POST", "/api/pull", json={"name": name, "stream": True}) as resp:
            if resp.status_code >= 400:
                raise OllamaError(f"Falha ao baixar '{name}' (HTTP {resp.status_code}).")
            async for line in resp.aiter_lines():
                if line.strip():
                    try:
                        yield json.loads(line)
                    except json.JSONDecodeError:
                        continue


async def delete_model(name: str) -> None:
    async with _client(timeout=60) as client:
        resp = await client.request("DELETE", "/api/delete", json={"name": name})
        if resp.status_code >= 400:
            raise OllamaError(f"Falha ao remover '{name}' (HTTP {resp.status_code}).")


async def chat_stream(
    model: str,
    messages: list[dict],
    options: Optional[dict] = None,
) -> AsyncIterator[dict]:
    """Transmite a resposta de /api/chat, um objeto JSON por linha."""
    payload: dict = {"model": model, "messages": messages, "stream": True}
    if options:
        payload["options"] = {k: v for k, v in options.items() if v is not None}

    async with _client() as client:
        try:
            async with client.stream("POST", "/api/chat", json=payload) as resp:
                if resp.status_code >= 400:
                    body = (await resp.aread()).decode("utf-8", "replace")
                    raise OllamaError(_friendly_error(resp.status_code, body, model))
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if chunk.get("error"):
                        raise OllamaError(str(chunk["error"]))
                    yield chunk
        except httpx.ConnectError as exc:
            raise OllamaError(
                f"Não foi possível conectar ao Ollama em {config.OLLAMA_HOST}. "
                "Verifique se o serviço está rodando."
            ) from exc
        except httpx.ReadTimeout as exc:
            raise OllamaError("O modelo demorou demais para responder (timeout).") from exc


def _friendly_error(status: int, body: str, model: str) -> str:
    try:
        detail = json.loads(body).get("error", body)
    except json.JSONDecodeError:
        detail = body
    if status == 404:
        return f"Modelo '{model}' não está instalado. Rode: ollama pull {model}"
    return f"Erro do Ollama (HTTP {status}): {detail}"


async def generate_title(model: str, conversation: str) -> Optional[str]:
    """Pede ao modelo um título curto para a conversa."""
    payload = {
        "model": model,
        "prompt": config.TITLE_PROMPT + conversation,
        "stream": False,
        "options": {"temperature": 0.2, "num_predict": 24},
    }
    try:
        async with _client(timeout=60) as client:
            resp = await client.post("/api/generate", json=payload)
            resp.raise_for_status()
            raw = (resp.json().get("response") or "").strip()
    except Exception:  # noqa: BLE001 — título é opcional, nunca quebra o fluxo
        return None

    title = raw.splitlines()[0].strip().strip('"\'`').rstrip(".")
    # Modelos com raciocínio às vezes devolvem <think>...</think>; descarta.
    if "<think>" in title.lower() or not title:
        return None
    return title[:60] or None
