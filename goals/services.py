"""KPI calculations on top of the database."""
from django.db import transaction
from django.utils import timezone

from accounts.models import Employee, Evaluation, Goal

from . import rules


def team_of(manager_user):
    """A manager's team: the employees whose manager is this manager."""
    return Employee.objects.filter(manager_id=manager_user.pk).select_related('user')


def goals_of(employee, year):
    return (
        Goal.objects.filter(employee_id=employee.pk, evaluation_year=year)
        .prefetch_related('task_records__task')
        .order_by('period_start', 'goal_id')
    )


def _linked_tasks(goal):
    return [record.task for record in goal.task_records.all()]


def goal_result(goal, today, frozen=False):
    """Progress, rating and flags of one goal. When the evaluation is
    frozen the stored rating is shown instead of a recalculated one."""
    if goal.type == rules.TASK_BASED:
        done = rules.count_done_tasks(_linked_tasks(goal), goal.period_start, goal.period_end)
        percent = rules.progress_percent(goal.target_value, done)
        achieved = done
        no_value = False
    else:
        achieved = goal.actual_value
        no_value = goal.actual_value is None
        percent = rules.progress_percent(goal.target_value, achieved)
    shown_percent = percent if percent is not None else rules.progress_percent(goal.target_value, 0)
    rating = goal.rating if (frozen and goal.rating is not None) else rules.rating_for(shown_percent)
    return {
        'achieved': achieved,
        'progress': shown_percent,
        'rating': int(rating),
        'no_value': no_value,
        'overdue': goal.period_end < today and shown_percent < 100,
    }


def goal_data(goal, today, frozen=False):
    result = goal_result(goal, today, frozen)
    return {
        'id': goal.pk,
        'name': goal.name,
        'description': goal.description,
        'type': goal.type,
        'period': goal.time_period,
        'period_start': goal.period_start,
        'period_end': goal.period_end,
        'target': float(goal.target_value),
        'achieved': None if result['achieved'] is None else float(result['achieved']),
        'weight': float(goal.weight),
        'progress': float(result['progress']),
        'rating': result['rating'],
        'no_value': result['no_value'],
        'overdue': result['overdue'],
        'locked': goal.period_start <= today,
        'task_ids': [r.task_id for r in goal.task_records.all()],
    }


def performance(employee, year, today=None):
    """Everything the employee view needs for one evaluation year.

    The score is calculated live. Once the year has ended it is saved on
    the Evaluation row (is_final=True) and the goal ratings are saved on
    the goals, so later task changes cannot alter it.
    """
    today = today or timezone.localdate()
    goals = list(goals_of(employee, year))
    ended = rules.year_ended(year, today)
    evaluation = Evaluation.objects.filter(employee_id=employee.pk, evaluation_year=year).first()
    final = bool(evaluation and evaluation.is_final)

    rows = [goal_data(g, today, frozen=final) for g in goals]
    if final:
        score = evaluation.overall_score
    else:
        score = rules.overall_score([(r['rating'], r['weight']) for r in rows])
        if ended and goals:
            score = _freeze(employee, year, goals, rows, score)
            final = True
    return {
        'year': year,
        'goals': rows,
        'overall_score': None if score is None else float(score),
        'is_final': final,
    }


@transaction.atomic
def _freeze(employee, year, goals, rows, score):
    for goal, row in zip(goals, rows):
        goal.rating = row['rating']
        goal.save(update_fields=['rating'])
    Evaluation.objects.update_or_create(
        employee_id=employee.pk,
        evaluation_year=year,
        defaults={'overall_score': score, 'is_final': True},
    )
    return score


def is_frozen(employee, year):
    return Evaluation.objects.filter(
        employee_id=employee.pk, evaluation_year=year, is_final=True,
    ).exists()
