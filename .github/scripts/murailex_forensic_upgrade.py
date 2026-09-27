from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def p(rel: str) -> Path:
    return ROOT / rel


def replace_once(rel: str, old: str, new: str) -> None:
    path = p(rel)
    text = path.read_text()
    if old not in text:
        raise RuntimeError(f"expected block missing: {rel}")
    path.write_text(text.replace(old, new, 1))


# Critical risk classes: every one becomes a review gate.
replace_once(
    "murailex/backend/app/pipeline/text.py",
    'CRITICAL_RISKS = {"number", "money", "date", "name", "admission", "denial", "threat"}\n',
    'CRITICAL_RISKS = {"number", "money", "date", "name", "admission", "denial", "threat", "negation", "code_switch", "overlap"}\n',
)

# Confidence is provenance only; consensus is agreement + risk gates.
replace_once(
    "murailex/backend/app/pipeline/consensus.py",
    '''2. A token is accepted only when both engines produced the same comparison key within
   the time tolerance and neither reported confidence below the threshold.
3. Disagreements, one-engine-only tokens, and low-confidence tokens become disputes.
4. High-risk tokens (numbers, money, dates, names, admissions, denials, threats,
   negations, code-switching, overlap) are escalated. Critical categories need
   independent verification-engine agreement or human review; with only one primary
   engine every escalated token needs review.
5. Verification runs over each region ±context. A region is closed automatically only
   when every available candidate (≥2 engines, including ≥1 verification engine) has the
   identical comparison-key sequence. Otherwise it stays open for human review.
''',
    '''2. A token is accepted only when both engines produced the same comparison key within
   the existing deterministic time tolerance and the token is not a critical-risk token.
3. Disagreements and one-engine-only tokens become disputes.
4. High-risk tokens (numbers, money, dates, names, admissions, denials, threats,
   negations, code-switching, overlap) require human review.
5. Verification runs over each disputed region ±context. Verification candidates are
   evidence for the reviewer; primary disagreement and critical regions never auto-close.
''',
)
replace_once(
    "murailex/backend/app/pipeline/consensus.py",
    '''def _low(tok: Token | None, threshold: float) -> bool:
    return tok is not None and tok.get("confidence") is not None and float(tok["confidence"]) < threshold


''',
    '',
)
replace_once(
    "murailex/backend/app/pipeline/consensus.py",
    '''        if _low(a, threshold) or _low(b, threshold):
            reasons.add("low_confidence")
''',
    '',
)
replace_once(
    "murailex/backend/app/pipeline/consensus.py",
    '''def candidate(meta: dict[str, Any], tokens: list[Token], role: str) -> dict[str, Any]:
    confs = [float(t["confidence"]) for t in tokens if t.get("confidence") is not None]
    return {
        "provider": meta["provider"],
        "model": meta["model"],
        "run_id": meta["run_id"],
        "role": role,
        "text": " ".join(t["text"] for t in tokens),
        "tokens": tokens,
        "key": [match_key(t["text"]) for t in tokens],
        "mean_confidence": round(sum(confs) / len(confs), 4) if confs else None,
        "min_confidence": round(min(confs), 4) if confs else None,
    }
''',
    '''def candidate(
    meta: dict[str, Any],
    tokens: list[Token],
    role: str,
    *,
    region_text: str | None = None,
    region_start_ms: int | None = None,
    region_end_ms: int | None = None,
) -> dict[str, Any]:
    confs = [float(t["confidence"]) for t in tokens if t.get("confidence") is not None]
    text = " ".join(t["text"] for t in tokens) if tokens else (region_text or "").strip()
    key = [match_key(t["text"]) for t in tokens]
    if not key and text:
        key = [k for word in text.split() if (k := match_key(word))]
    return {
        "provider": meta["provider"],
        "model": meta["model"],
        "run_id": meta["run_id"],
        "role": role,
        "text": text,
        "tokens": tokens,
        "key": key,
        "region_start_ms": region_start_ms,
        "region_end_ms": region_end_ms,
        "mean_confidence": round(sum(confs) / len(confs), 4) if confs else None,
        "min_confidence": round(min(confs), 4) if confs else None,
    }
''',
)
replace_once(
    "murailex/backend/app/pipeline/consensus.py",
    '''def auto_resolution(region: dict[str, Any], cands: list[dict[str, Any]], threshold: float) -> dict[str, Any] | None:
    """Return the unanimous candidate when rule 5 permits automatic closure, else None."""
    if "overlap" in region["reasons"]:
        return None
    verifiers = [c for c in cands if c["role"] == "verification_asr"]
    if len(cands) < 2 or not verifiers:
        return None
    if any(not c["key"] for c in cands):
        return None
    first = cands[0]["key"]
    if any(c["key"] != first for c in cands):
        return None
    if any(c["min_confidence"] is not None and c["min_confidence"] < threshold for c in cands):
        return None
    return cands[0]
''',
    '''def auto_resolution(region: dict[str, Any], cands: list[dict[str, Any]], threshold: float) -> dict[str, Any] | None:
    """Auto-close only non-critical, non-hard regions with unanimous independent text."""
    del threshold  # provider confidence is provenance only; it never authorizes acceptance
    if region.get("critical") or region.get("hard") or "overlap" in region.get("reasons", []):
        return None
    verifiers = [c for c in cands if c["role"] == "verification_asr"]
    if len(cands) < 2 or not verifiers or any(not c["key"] for c in cands):
        return None
    first = cands[0]["key"]
    if any(c["key"] != first for c in cands):
        return None
    return cands[0]
''',
)

# Restrict locale syntax at upload; Production processing below requires one.
replace_once(
    "murailex/backend/app/api/uploads.py",
    '    language_hint: str | None = Field(default=None, max_length=20)\n',
    '    language_hint: str | None = Field(default=None, pattern=r"^(ar-YE|ar-EG|ar-SY|ar-LB|ar-IQ)$")\n',
)

# Expose the canonical locale name while retaining the existing DB column.
replace_once(
    "murailex/backend/app/api/common.py",
    '        "language_hint": r.language_hint, "expected_speakers": r.expected_speakers, "media_info": r.media_info,\n',
    '        "language_hint": r.language_hint, "language_locale": r.language_hint, "expected_speakers": r.expected_speakers, "media_info": r.media_info,\n',
)

# Route each recording to the exact provider matrix; all five providers are mandatory.
replace_once(
    "murailex/backend/app/pipeline/process.py",
    '''    ctx = {"recording_id": str(rec.id), "expected_speakers": rec.expected_speakers,
           "derived_sha256": derived["analysis_wav"]["sha256"], "input_sha256": derived["analysis_wav"]["sha256"]}

    primaries = registry.primary_asr()
    diarizers = registry.diarization()
    configured = [a for a in primaries if a.info().configured]
    if not configured:
        for a in primaries:
            drive_run(db, rec, a, "primary_asr", analysis, ctx)
        _set_status(db, rec, "provider_not_configured",
                    "No primary ASR engine is configured. Configure AssemblyAI and/or Google Chirp 3 under Settings → Advanced.")
        audit.record(db, "processing_blocked", actor_label="system", recording_id=rec.id, details={"reason": "no primary ASR configured"})
        db.commit()
        return
''',
    '''    locale = rec.language_hint
    if registry.fixtures_enabled() and locale not in registry.SUPPORTED_LOCALES:
        locale = "ar-YE"  # automated fixtures only; Production never receives this fallback
    if locale not in registry.SUPPORTED_LOCALES:
        _set_status(db, rec, "failed", "A supported recording locale is required before forensic processing.")
        audit.record(db, "processing_blocked", actor_label="system", recording_id=rec.id,
                     details={"reason": "missing_or_invalid_language_locale", "language_locale": locale})
        db.commit()
        return

    ctx = {"recording_id": str(rec.id), "expected_speakers": rec.expected_speakers,
           "language_locale": locale, "derived_sha256": derived["analysis_wav"]["sha256"],
           "input_sha256": derived["analysis_wav"]["sha256"]}

    primaries = registry.primary_asr(locale)
    diarizers = registry.diarization()
    verifiers = registry.verification_asr(locale)
    required = [(a, "primary_asr") for a in primaries] + [(d, "diarization") for d in diarizers] + [(v, "verification_asr") for v in verifiers]
    missing = [(a, role) for a, role in required if not a.info().configured]
    if missing:
        for a, role in missing:
            drive_run(db, rec, a, role, analysis, ctx, scope="configuration-check")
        names = [f"{a.name}:{a.info().model}" for a, _ in missing]
        _set_status(db, rec, "provider_not_configured", "Required forensic provider(s) not configured: " + ", ".join(names))
        audit.record(db, "processing_blocked", actor_label="system", recording_id=rec.id,
                     details={"reason": "mandatory_provider_not_configured", "language_locale": locale, "providers": names})
        db.commit()
        return
''',
)
replace_once(
    "murailex/backend/app/pipeline/process.py",
    '''    ok_primary = [runs[a.name] for a in primaries if runs.get(a.name) and runs[a.name].status == "succeeded"]  # type: ignore[union-attr]
    if not ok_primary:
        _set_status(db, rec, "failed", "Every configured primary ASR engine failed. See Settings → Advanced for provider errors.")
        audit.record(db, "processing_failed", actor_label="system", recording_id=rec.id, details={"reason": "all primary engines failed"})
        db.commit()
        return
    diar_run = next((runs[d.name] for d in diarizers if runs.get(d.name) and runs[d.name].status == "succeeded"), None)  # type: ignore[union-attr]
''',
    '''    ok_primary = [runs[a.name] for a in primaries if runs.get(a.name) and runs[a.name].status == "succeeded"]  # type: ignore[union-attr]
    if len(ok_primary) != len(primaries):
        _set_status(db, rec, "failed", "Mandatory primary ASR engine failed; forensic consensus was not produced.")
        audit.record(db, "processing_failed", actor_label="system", recording_id=rec.id,
                     details={"reason": "mandatory_primary_failed", "language_locale": locale,
                              "primary_status": {a.name: (runs.get(a.name).status if runs.get(a.name) else "missing") for a in primaries}})
        db.commit()
        return
    diar_run = next((runs[d.name] for d in diarizers if runs.get(d.name) and runs[d.name].status == "succeeded"), None)  # type: ignore[union-attr]
    if diarizers and diar_run is None:
        _set_status(db, rec, "failed", "Mandatory independent diarization failed.")
        audit.record(db, "processing_failed", actor_label="system", recording_id=rec.id,
                     details={"reason": "mandatory_diarization_failed", "language_locale": locale})
        db.commit()
        return
''',
)
replace_once(
    "murailex/backend/app/pipeline/process.py",
    '''    if diar_run is not None:
        turns = diar_run.normalized["turns"]  # type: ignore[index]
        diar_source = {"provider": diar_run.provider, "model": diar_run.model, "run_id": str(diar_run.id), "independent": True}
    else:
        base = primary_inputs[0][1]
        turns = [{"speaker": t["speaker"], "start_ms": t["start_ms"], "end_ms": t["end_ms"]} for t in base if t.get("speaker")]
        diar_source = {"provider": primary_inputs[0][0]["provider"], "run_id": primary_inputs[0][0]["run_id"], "independent": False,
                       "note": "Independent diarization unavailable; speaker turns taken from the primary ASR engine."}
''',
    '''    assert diar_run is not None
    turns = diar_run.normalized["turns"]  # type: ignore[index]
    diar_source = {"provider": diar_run.provider, "model": diar_run.model, "run_id": str(diar_run.id), "independent": True}
''',
)
replace_once(
    "murailex/backend/app/pipeline/process.py",
    '''    verifiers = [v for v in registry.verification_asr() if v.info().configured]
    if verifiers:
''',
    '''    if verifiers:
''',
)
replace_once(
    "murailex/backend/app/pipeline/process.py",
    '''    if waits:
        raise Wait(min(w.seconds for w in waits), "verification pending")

    _set_status(db, rec, "building", "Creating disputes and draft transcript")
''',
    '''    if waits:
        raise Wait(min(w.seconds for w in waits), "verification pending")

    verifier_failures: list[dict[str, str]] = []
    for r in regions:
        if not r["requires_independent_check"]:
            continue
        scope = f"region:{r['start_ms']}-{r['end_ms']}"
        for v in verifiers:
            vr = _get_run(db, rec, v, "verification_asr", scope)
            if vr is None or vr.status != "succeeded":
                verifier_failures.append({"provider": v.name, "scope": scope, "status": vr.status if vr else "missing"})
    if verifier_failures:
        _set_status(db, rec, "failed", "Mandatory verification engine failed; forensic transcript was not finalized.")
        audit.record(db, "processing_failed", actor_label="system", recording_id=rec.id,
                     details={"reason": "mandatory_verifier_failed", "language_locale": locale, "failures": verifier_failures})
        db.commit()
        return

    _set_status(db, rec, "building", "Creating disputes and draft transcript")
''',
)
replace_once(
    "murailex/backend/app/pipeline/process.py",
    '''                toks = (vr.normalized or {}).get("tokens", [])
                cands.append(cons.candidate({"provider": vr.provider, "model": vr.model, "run_id": str(vr.id)},
                                            cons.tokens_in_window(toks, r["start_ms"], r["end_ms"]), "verification_asr"))
''',
    '''                norm = vr.normalized or {}
                toks = norm.get("tokens", [])
                cands.append(cons.candidate(
                    {"provider": vr.provider, "model": vr.model, "run_id": str(vr.id)},
                    cons.tokens_in_window(toks, r["start_ms"], r["end_ms"]),
                    "verification_asr",
                    region_text=norm.get("text"),
                    region_start_ms=r["start_ms"],
                    region_end_ms=r["end_ms"],
                ))
''',
)
replace_once(
    "murailex/backend/app/pipeline/process.py",
    '''        "single_engine_mode": result["single_engine"],
        "low_confidence_threshold": s.low_confidence_threshold,
        "context_padding_ms": s.context_padding_ms,
''',
    '''        "single_engine_mode": result["single_engine"],
        "language_locale": locale,
        "confidence_policy": "provenance_only_no_acceptance_gate",
        "context_padding_ms": s.context_padding_ms,
''',
)

# Lock requires no open disputes, no unreviewed critical item, and re-verifies original bytes.
replace_once(
    "murailex/backend/app/api/recordings.py",
    'from ..pipeline.text import UNCLEAR_MARKERS\n',
    'from ..pipeline.text import CRITICAL_RISKS, UNCLEAR_MARKERS\n',
)
replace_once(
    "murailex/backend/app/api/recordings.py",
    '''    if open_ids or open_rows:
        raise HTTPException(409, f"{max(len(open_ids), open_rows)} disputed region(s) must be resolved before locking.")
    parent_sha = None
''',
    '''    if open_ids or open_rows:
        raise HTTPException(409, f"{max(len(open_ids), open_rows)} disputed region(s) must be resolved before locking.")
    pending_critical = []
    reviewed_sources = {"human", "reviewer_accepted_candidate"}
    for seg in rev.content.get("segments", []):
        for item in seg.get("items", []):
            risks = set(item.get("risks") or [])
            if risks & CRITICAL_RISKS and item.get("source") not in reviewed_sources:
                pending_critical.append({"segment_id": seg.get("id"), "risks": sorted(risks & CRITICAL_RISKS)})
    if pending_critical:
        raise HTTPException(409, {"message": "Critical item(s) require human review before locking.", "items": pending_critical[:100]})
    observed_sha, observed_size = storage.sha256_of_object(rec.storage_key, rec.storage_version_id)
    if observed_sha != rec.sha256 or observed_size != rec.byte_size:
        audit.record(db, "integrity_failure", actor=p.user, recording_id=rec.id,
                     details={"stage": "pre_lock", "expected_sha256": rec.sha256, "observed_sha256": observed_sha,
                              "expected_bytes": rec.byte_size, "observed_bytes": observed_size})
        db.commit()
        raise HTTPException(409, "Original evidence integrity check failed; transcript cannot be locked.")
    audit.record(db, "pre_lock_integrity_verified", actor=p.user, recording_id=rec.id,
                 details={"sha256_before": rec.sha256, "sha256_after": observed_sha, "byte_size": observed_size})
    parent_sha = None
''',
)

print("forensic consensus, locale routing, and lock gates applied")
