import time
from pathlib import Path

from rundeer.core.batch import BatchRunner, Job, JobState, _HardError


def _mk_job(i):
    return Job(id=i, kind="image", params={}, output_path=Path(f"/tmp/{i}.png"))


def test_batch_success():
    jobs = [_mk_job(i) for i in range(1, 4)]

    def worker(job, progress):
        progress(JobState.SUBMITTED, "x")

    BatchRunner(jobs, worker, concurrency=2).run()
    assert all(j.state == JobState.DONE for j in jobs)


def test_batch_retry_then_succeed():
    jobs = [_mk_job(1)]
    counter = {"n": 0}

    def worker(job, progress):
        counter["n"] += 1
        if counter["n"] < 2:
            raise RuntimeError("flaky")

    # Patch time.sleep to avoid waiting real backoff
    import rundeer.core.batch as batch_mod
    orig_sleep = batch_mod.time.sleep
    batch_mod.time.sleep = lambda *_: None
    try:
        BatchRunner(jobs, worker, concurrency=1, max_retries=2).run()
    finally:
        batch_mod.time.sleep = orig_sleep
    assert jobs[0].state == JobState.DONE
    assert counter["n"] == 2


def test_batch_hard_fail_no_retry():
    jobs = [_mk_job(1)]
    counter = {"n": 0}

    def worker(job, progress):
        counter["n"] += 1
        raise _HardError("bad input")

    BatchRunner(jobs, worker, concurrency=1, max_retries=3).run()
    assert jobs[0].state == JobState.FAILED
    assert counter["n"] == 1


def test_batch_exhausts_retries():
    jobs = [_mk_job(1)]

    def worker(job, progress):
        raise RuntimeError("always")

    import rundeer.core.batch as batch_mod
    batch_mod.time.sleep = lambda *_: None
    BatchRunner(jobs, worker, concurrency=1, max_retries=1).run()
    assert jobs[0].state == JobState.FAILED
