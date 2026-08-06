# Claunde

Clone local do Claude Chat: FastAPI + SQLite + Ollama, front-end estático sem build.

## Rodando local (sem Docker)

```bash
./run.sh          # http://localhost:8000 — precisa de `ollama serve` no host
```

## Rodando com Docker Compose (nginx + backend + ollama)

```bash
cp .env.example .env      # opcional: ajuste HTTP_PORT, DEFAULT_MODEL, etc.
docker compose up -d --build
```

Acesse `http://localhost:8080` (ou o `HTTP_PORT` do `.env`).

Baixe um modelo na primeira execução:

```bash
docker compose exec ollama ollama pull llama3.2:1b
```

### Como está montado

| Serviço   | Papel                                                                   |
|-----------|-------------------------------------------------------------------------|
| `nginx`   | Única porta publicada. Serve `frontend/` e faz proxy de `/api` → backend |
| `backend` | uvicorn na 8000, só na rede interna. Banco em `./data` (bind mount)      |
| `ollama`  | Modelos no volume `ollama-models`. Porta 11434 **não** é publicada       |

Detalhes do nginx (`deploy/nginx.conf`):

- `proxy_buffering off` em `/api/` — o chat responde via SSE, token a token;
  com buffer a resposta só apareceria no fim.
- `proxy_read_timeout 1h` — cobre o `OLLAMA_TIMEOUT` e o `pull` de modelos grandes.
- `css`/`js` vão com `Cache-Control: no-cache`: os arquivos não têm hash no
  nome, então o browser precisa revalidar depois de cada deploy.

`frontend/` e `deploy/nginx.conf` são bind mounts read-only — editar o
front-end não exige rebuild, basta recarregar a página. Ao mexer no nginx.conf:

```bash
docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload
```

### Usar um Ollama que já roda no host

Em vez do serviço `ollama`, aponte o backend para a máquina hospedeira:

```yaml
# docker-compose.override.yml
services:
  backend:
    environment:
      OLLAMA_HOST: http://host.docker.internal:11434
    extra_hosts:
      - "host.docker.internal:host-gateway"
    depends_on: !reset []
```

Depois: `docker compose up -d backend` (o serviço `ollama` pode ficar parado
com `docker compose stop ollama`).
