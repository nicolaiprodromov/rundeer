from rundeer.core.rate_limit import RateLimiter


def test_rate_limiter_waits_for_second_window():
    now = [1000.0]
    sleeps = []

    def clock():
        return now[0]

    def sleeper(seconds):
        sleeps.append(seconds)
        now[0] += seconds

    limiter = RateLimiter(
        {"enabled": True, "per_second": 1},
        clock=clock,
        sleeper=sleeper,
    )

    limiter.acquire()
    limiter.acquire()

    assert len(sleeps) == 1
    assert sleeps[0] >= 1.25


def test_rate_limiter_persists_between_instances(tmp_path):
    now = [1000.0]

    def clock():
        return now[0]

    limiter_one = RateLimiter(
        {"enabled": True, "per_minute": 1},
        state_path=tmp_path / "rate_limits.json",
        clock=clock,
        sleeper=lambda seconds: None,
    )
    limiter_two = RateLimiter(
        {"enabled": True, "per_minute": 1},
        state_path=tmp_path / "rate_limits.json",
        clock=clock,
        sleeper=lambda seconds: None,
    )

    limiter_one.acquire()
    wait = limiter_two._try_acquire_one()

    assert wait >= 60.0