"""Base for every request body: strict types (no silent coercion such as "5" -> 5 or
1 -> True) and unknown fields rejected instead of ignored."""
from pydantic import BaseModel, ConfigDict


class StrictIn(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", str_strip_whitespace=False)
