"""Modelos Pydantic de entrada/saída da API."""
from typing import Any, Optional

from pydantic import BaseModel, Field


class ChatCreate(BaseModel):
    title: str = "Nova conversa"
    model: Optional[str] = None
    system_prompt: Optional[str] = None


class ChatUpdate(BaseModel):
    title: Optional[str] = None
    model: Optional[str] = None
    system_prompt: Optional[str] = None
    pinned: Optional[bool] = None
    archived: Optional[bool] = None


class GenerationOptions(BaseModel):
    temperature: Optional[float] = Field(default=None, ge=0, le=2)
    top_p: Optional[float] = Field(default=None, ge=0, le=1)
    top_k: Optional[int] = Field(default=None, ge=0)
    num_predict: Optional[int] = Field(default=None, ge=-1, le=32768)
    repeat_penalty: Optional[float] = Field(default=None, ge=0, le=4)
    seed: Optional[int] = None
    num_ctx: Optional[int] = Field(default=None, ge=256, le=131072)


class SendMessage(BaseModel):
    content: str
    model: Optional[str] = None
    system_prompt: Optional[str] = None
    options: Optional[GenerationOptions] = None
    history_limit: int = Field(default=40, ge=1, le=500)


class Regenerate(BaseModel):
    message_id: Optional[str] = None
    model: Optional[str] = None
    options: Optional[GenerationOptions] = None
    history_limit: int = Field(default=40, ge=1, le=500)


class EditMessage(BaseModel):
    content: str
    resend: bool = True


class SettingsUpdate(BaseModel):
    values: dict[str, Any]


class PullRequest(BaseModel):
    name: str
