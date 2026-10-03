from __future__ import annotations

import logging
import threading

from .jobs import worker_loop


def _preload_local_models() -> None:
    """Local mode: load the on-device ASR models once at startup instead of on the first job."""
    from .config import get_settings
    from .providers import local_whisper

    s = get_settings()
    log = logging.getLogger("murailex.worker")
    log.info("resource profile: %s", local_whisper.hardware_profile())
    for name in (s.local_asr_model, s.local_verify_model):
        try:
            local_whisper._model(name)
            log.info("local ASR model ready: %s", name)
        except Exception as exc:  # noqa: BLE001 - surfaced again, with context, by the first job
            log.error("local ASR model %s failed to load: %s: %s", name, type(exc).__name__, exc)
    try:
        from .local_canary import ensure_engine_self_tests

        ensure_engine_self_tests()
    except Exception:  # noqa: BLE001 - validation can still be requested from the UI
        log.exception("automatic engine self-test scheduling failed")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    from .providers.registry import local_mode

    if local_mode():
        threading.Thread(target=_preload_local_models, name="asr-preload", daemon=True).start()
    worker_loop()
