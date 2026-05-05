from pathlib import Path
from rundeer.cli.tui import PlainReporter, pick_reporter
from rundeer.core.batch import Job, JobEvent, JobState


def test_plain_reporter_prints(capsys):
    r = PlainReporter("test")
    with r:
        r(JobEvent(1, JobState.DONE, "ok"))
    out = capsys.readouterr().out
    assert "ok" in out
    assert "done" in out


def test_plain_reporter_summary(capsys, tmp_path):
    r = PlainReporter("test")
    jobs = [Job(id=1, kind="image", params={}, output_path=tmp_path/"x.png", state=JobState.DONE),
            Job(id=2, kind="image", params={}, output_path=tmp_path/"y.png", state=JobState.FAILED, error="boom")]
    with r:
        pass
    r.summary(jobs, tmp_path)
    out = capsys.readouterr().out
    assert "1 done" in out
    assert "FAIL [02]" in out


def test_pick_reporter_fallback(monkeypatch):
    """When stdout is not a TTY, pick_reporter returns PlainReporter."""
    import sys
    monkeypatch.setattr(sys.stdout, "isatty", lambda: False)
    r = pick_reporter("t", [], no_tui=False)
    assert isinstance(r, PlainReporter)


def test_pick_reporter_no_tui_flag():
    r = pick_reporter("t", [], no_tui=True)
    assert isinstance(r, PlainReporter)
