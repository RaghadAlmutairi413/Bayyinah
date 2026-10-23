"""KPI rules as plain functions (no database), so they are easy to test.

Rating scale (adapted from the performance guide):
    more than 100%      -> 5
    90% up to 100%      -> 4
    80% up to below 90% -> 3
    60% up to below 80% -> 2
    below 60%           -> 1
"""
import calendar
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

MANUAL = 'Manual'
TASK_BASED = 'Task-based'
GOAL_TYPES = (MANUAL, TASK_BASED)

ANNUAL = 'annual'
QUARTERS = ('Q1', 'Q2', 'Q3', 'Q4')
MONTHS = tuple(f'M{m}' for m in range(1, 13))
PERIODS = (ANNUAL,) + QUARTERS + MONTHS

DONE_STATUS = 'completed'  # Task.status value for "Done"


def period_dates(period, year):
    """Start and end date of a period inside an evaluation year."""
    if period == ANNUAL:
        return date(year, 1, 1), date(year, 12, 31)
    if period in QUARTERS:
        q = QUARTERS.index(period)
        first, last = q * 3 + 1, q * 3 + 3
    elif period in MONTHS:
        first = last = MONTHS.index(period) + 1
    else:
        raise ValueError(f'Unknown period: {period}')
    return date(year, first, 1), date(year, last, calendar.monthrange(year, last)[1])


def year_end(year):
    return date(year, 12, 31)


def year_ended(year, today):
    return today > year_end(year)


def progress_percent(target, achieved):
    """achieved / target as a percentage, not capped. None if no value yet."""
    if achieved is None:
        return None
    return (Decimal(achieved) * 100 / Decimal(target)).quantize(Decimal('0.01'), ROUND_HALF_UP)


def count_done_tasks(tasks, start, end):
    """Tasks that are Done and due inside [start, end]."""
    return sum(
        1 for t in tasks
        if t.status == DONE_STATUS and t.due_date is not None and start <= t.due_date <= end
    )


def rating_for(percent):
    p = Decimal(percent or 0)
    if p > 100:
        return 5
    if p >= 90:
        return 4
    if p >= 80:
        return 3
    if p >= 60:
        return 2
    return 1


def overall_score(rated_goals):
    """Sum of rating x weight/100, on a 1-5 scale. rated_goals = [(rating, weight)]."""
    if not rated_goals:
        return None
    total = sum(Decimal(r) * Decimal(w) / 100 for r, w in rated_goals)
    return total.quantize(Decimal('0.01'), ROUND_HALF_UP)


def weights_total(weights):
    return sum((Decimal(w) for w in weights), Decimal('0'))


CHART_BUCKETS = ('Q1', 'Q2', 'Q3', 'Q4', ANNUAL)


def chart_bucket(period):
    """Where a goal's period sits on the quarter chart: months fall in their quarter."""
    if period in MONTHS:
        return QUARTERS[(MONTHS.index(period)) // 3]
    return period


def bucket_averages(ratings_by_period):
    """{period: [ratings]} -> average rating for Q1..Q4 and the full year (None if none)."""
    buckets = {key: [] for key in CHART_BUCKETS}
    for period, ratings in ratings_by_period.items():
        buckets[chart_bucket(period)].extend(ratings)
    return [
        float((Decimal(sum(values)) / len(values)).quantize(Decimal('0.01'), ROUND_HALF_UP))
        if values else None
        for values in buckets.values()
    ]
