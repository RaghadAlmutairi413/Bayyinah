from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Employee, Evaluation, Goal, Task, TaskGoal
from workspace.permissions import is_manager

from . import rules, services
from .permissions import IsHR, IsManager, IsManagerOrEmployee
from .serializers import (
    ActualValueSerializer,
    GoalSetSerializer,
    LinkedTasksSerializer,
)


def bad_request(errors):
    return Response(errors, status=status.HTTP_400_BAD_REQUEST)


def not_found(message):
    return Response({'detail': message}, status=status.HTTP_404_NOT_FOUND)


def year_from(request):
    """?year=2026 (defaults to the current year). None if it is not a number."""
    raw = request.query_params.get('year')
    if raw is None:
        return timezone.localdate().year
    try:
        return int(raw)
    except ValueError:
        return None


def team_goal(request, goal_id):
    """A goal that belongs to someone in this manager's team, or None."""
    team_ids = services.team_of(request.user).values('pk')
    return (
        Goal.objects.filter(pk=goal_id, employee_id__in=team_ids)
        .prefetch_related('task_records__task')
        .first()
    )


class EmployeeGoalsView(APIView):
    """GET: the employee's goals and score. PUT: replace the whole set of
    goals for the current year (weights must total 100%)."""

    permission_classes = [IsManager]

    def employee(self, request, employee_id):
        return services.team_of(request.user).filter(pk=employee_id).first()

    def get(self, request, employee_id):
        employee = self.employee(request, employee_id)
        year = year_from(request)
        if employee is None:
            return not_found('This employee is not in your team.')
        if year is None:
            return bad_request({'year': 'Enter a valid year.'})
        return Response(services.performance(employee, year))

    def put(self, request, employee_id):
        employee = self.employee(request, employee_id)
        if employee is None:
            return not_found('This employee is not in your team.')
        serializer = GoalSetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        today = timezone.localdate()
        year = serializer.validated_data['year']
        items = serializer.validated_data['goals']
        if year != today.year:
            return bad_request({'year': 'Goals can only be set for the current year.'})

        existing = {
            g.pk: g for g in Goal.objects.filter(employee_id=employee.pk, evaluation_year=year)
        }
        errors = self.check(items, existing, year, today)
        if errors:
            return bad_request({'goals': errors})

        with transaction.atomic():
            self.save_set(request.user, employee, year, items, existing, today)
        return Response(services.performance(employee, year, today))

    def check(self, items, existing, year, today):
        errors, seen = [], set()
        for number, item in enumerate(items, start=1):
            start, end = rules.period_dates(item['period'], year)
            goal = existing.get(item.get('id')) if item.get('id') is not None else None
            if item.get('id') is not None:
                if goal is None or item['id'] in seen:
                    errors.append(f'Goal {number}: it is not one of this employee\'s goals.')
                    continue
                seen.add(item['id'])
                if goal.type != item['type']:
                    errors.append(f'Goal {number}: the measurement type cannot be changed.')
                if goal.period_start <= today and (
                    goal.time_period != item['period']
                    or goal.target_value != item['target']
                    or goal.weight != item['weight']
                ):
                    errors.append(
                        f'Goal {number}: its period has started, so its target, '
                        'weight and period can no longer change.'
                    )
            elif end < today:
                errors.append(f'Goal {number}: its period has already ended.')
        for goal in existing.values():
            if goal.pk not in seen and goal.period_start <= today:
                errors.append(
                    f'"{goal.name}" cannot be removed because its period has started.'
                )
        return errors

    def save_set(self, manager_user, employee, year, items, existing, today):
        kept = set()
        for item in items:
            start, end = rules.period_dates(item['period'], year)
            values = {
                'name': item['name'],
                'description': item.get('description'),
                'type': item['type'],
                'time_period': item['period'],
                'period_start': start,
                'period_end': end,
                'target_value': item['target'],
                'weight': item['weight'],
            }
            goal = existing.get(item.get('id')) if item.get('id') is not None else None
            if goal is None:
                Goal.objects.create(
                    manager_id=manager_user.pk,
                    employee=employee,
                    evaluation_year=year,
                    **values,
                )
            else:
                for field, value in values.items():
                    setattr(goal, field, value)
                goal.save()
                kept.add(goal.pk)
        for goal in existing.values():
            if goal.pk not in kept:
                goal.delete()


class GoalActualView(APIView):
    """A manager enters the achieved value of a Manual goal."""

    permission_classes = [IsManager]

    def patch(self, request, goal_id):
        goal = team_goal(request, goal_id)
        if goal is None:
            return not_found('Goal not found in your team.')
        if goal.type != rules.MANUAL:
            return bad_request({'detail': 'Only Manual goals take an achieved value.'})
        if services.is_frozen(goal.employee, goal.evaluation_year):
            return bad_request({'detail': 'This evaluation is final and cannot change.'})
        serializer = ActualValueSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        goal.actual_value = serializer.validated_data['actual_value']
        goal.save(update_fields=['actual_value'])
        return Response(services.goal_data(goal, timezone.localdate()))


class GoalTasksView(APIView):
    """GET: the employee's tasks and which are linked. PUT: set the linked tasks
    of a Task-based goal."""

    permission_classes = [IsManager]

    def get(self, request, goal_id):
        goal = team_goal(request, goal_id)
        if goal is None:
            return not_found('Goal not found in your team.')
        linked = {r.task_id for r in goal.task_records.all()}
        tasks = Task.objects.filter(employee_id=goal.employee_id).order_by('due_date', 'task_id')
        return Response([
            {
                'id': t.pk,
                'title': t.title,
                'status': t.status,
                'due_date': t.due_date,
                'linked': t.pk in linked,
                'counts': (
                    t.status == rules.DONE_STATUS
                    and t.due_date is not None
                    and goal.period_start <= t.due_date <= goal.period_end
                ),
            }
            for t in tasks
        ])

    def put(self, request, goal_id):
        goal = team_goal(request, goal_id)
        if goal is None:
            return not_found('Goal not found in your team.')
        if goal.type != rules.TASK_BASED:
            return bad_request({'detail': 'Only Task-based goals have linked tasks.'})
        if services.is_frozen(goal.employee, goal.evaluation_year):
            return bad_request({'detail': 'This evaluation is final and cannot change.'})
        serializer = LinkedTasksSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ids = set(serializer.validated_data['task_ids'])
        tasks = list(Task.objects.filter(pk__in=ids, employee_id=goal.employee_id))
        if len(tasks) != len(ids):
            return bad_request({'task_ids': 'Link only tasks assigned to this employee.'})
        with transaction.atomic():
            TaskGoal.objects.filter(goal_id=goal.pk).delete()
            TaskGoal.objects.bulk_create([TaskGoal(task=t, goal=goal) for t in tasks])
        goal = team_goal(request, goal_id)
        return Response(services.goal_data(goal, timezone.localdate()))


class EmployeeTasksView(APIView):
    """GET: the tasks of a team member, so tasks can be picked while a new
    Task-based goal is still being set (before it is saved)."""

    permission_classes = [IsManager]

    def get(self, request, employee_id):
        employee = services.team_of(request.user).filter(pk=employee_id).first()
        if employee is None:
            return not_found('This employee is not in your team.')
        tasks = Task.objects.filter(employee_id=employee.pk).order_by('due_date', 'task_id')
        return Response([
            {'id': t.pk, 'title': t.title, 'status': t.status, 'due_date': t.due_date}
            for t in tasks
        ])


def resolve_employee(request):
    """The employee a performance request is about: yourself, or for a manager
    someone in the team (?employee=<id>). Returns (employee, error_response)."""
    user = request.user
    if is_manager(user):
        target = request.query_params.get('employee')
        if not (target or '').isdigit():
            return None, bad_request({'employee': 'Choose an employee from your team.'})
        employee = services.team_of(user).filter(pk=int(target)).first()
        if employee is None:
            return None, not_found('This employee is not in your team.')
        return employee, None
    employee = Employee.objects.filter(pk=user.pk).first()
    if employee is None:
        return None, not_found('No employee record.')
    return employee, None


class MyPerformanceView(APIView):
    """An employee sees their own goals, ratings and overall score. A manager
    can see the same for someone in their team with ?employee=<id>."""

    permission_classes = [IsManagerOrEmployee]

    def get(self, request):
        year = year_from(request)
        if year is None:
            return bad_request({'year': 'Enter a valid year.'})
        employee, error = resolve_employee(request)
        if error:
            return error
        return Response(services.performance(employee, year))


class PerformanceCompareView(APIView):
    """Overall score of the selected year next to the previous year."""

    permission_classes = [IsManagerOrEmployee]

    def get(self, request):
        year = year_from(request)
        if year is None:
            return bad_request({'year': 'Enter a valid year.'})
        employee, error = resolve_employee(request)
        if error:
            return error
        by_year = {y: services.performance(employee, y) for y in range(year - 3, year + 1)}
        current, previous = by_year[year], by_year[year - 1]

        def quarters(data):
            grouped = {}
            for goal in data['goals']:
                grouped.setdefault(goal['period'], []).append(goal['rating'])
            return rules.bucket_averages(grouped)

        return Response({
            'year': year,
            'previous_year': year - 1,
            'current_score': current['overall_score'],
            'previous_score': previous['overall_score'],
            'current_final': current['is_final'],
            'previous_final': previous['is_final'],
            'quarters': {'current': quarters(current), 'previous': quarters(previous)},
            'history': [{'year': y, 'score': by_year[y]['overall_score']} for y in sorted(by_year)],
        })


class TeamPerformanceView(APIView):
    """A manager's team with each person's overall score for a year."""

    permission_classes = [IsManager]

    def get(self, request):
        year = year_from(request)
        if year is None:
            return bad_request({'year': 'Enter a valid year.'})
        rows = []
        for employee in services.team_of(request.user):
            data = services.performance(employee, year)
            rows.append({
                'id': employee.pk,
                'first_name': employee.user.first_name or '',
                'last_name': employee.user.last_name or '',
                'goal_count': len(data['goals']),
                'overall_score': data['overall_score'],
                'is_final': data['is_final'],
            })
        return Response(rows)


def org_summary(org_id, year, today):
    """Average overall score and average rating per period for an organization."""
    goals = (
        Goal.objects.filter(evaluation_year=year, employee__user__org_id=org_id)
        .prefetch_related('task_records__task')
    )
    frozen = set(
        Evaluation.objects.filter(
            evaluation_year=year, is_final=True, employee__user__org_id=org_id,
        ).values_list('employee_id', flat=True)
    )
    by_period, by_employee = {}, {}
    for goal in goals:
        result = services.goal_result(goal, today, frozen=goal.employee_id in frozen)
        by_period.setdefault(goal.time_period, []).append(result['rating'])
        by_employee.setdefault(goal.employee_id, []).append((result['rating'], goal.weight))

    def average(values):
        if not values:
            return None
        mean = Decimal(sum(values)) / len(values)
        return float(mean.quantize(Decimal('0.01'), ROUND_HALF_UP))

    scores = [rules.overall_score(pairs) for pairs in by_employee.values()]
    return {
        'quarters': rules.bucket_averages(by_period),
        'employees_count': len(by_employee),
        'average_overall_score': average(scores),
        'periods': [
            {
                'period': period,
                'goals_count': len(by_period[period]),
                'average_rating': average(by_period[period]),
            }
            for period in rules.PERIODS
            if period in by_period
        ],
    }


class HRDashboardView(APIView):
    """Average performance of the organization, per period, for a year,
    with the previous year's average for comparison."""

    permission_classes = [IsHR]

    def get(self, request):
        year = year_from(request)
        if year is None:
            return bad_request({'year': 'Enter a valid year.'})
        today = timezone.localdate()
        org_id = request.user.org_id
        current = org_summary(org_id, year, today)
        by_year = {year: current, year - 1: org_summary(org_id, year - 1, today)}
        for earlier in (year - 2, year - 3):
            by_year[earlier] = org_summary(org_id, earlier, today)
        previous = by_year[year - 1]
        return Response({
            'year': year,
            'previous_year': year - 1,
            'previous_average_overall_score': previous['average_overall_score'],
            'quarters': {'current': current['quarters'], 'previous': previous['quarters']},
            'history': [
                {'year': y, 'score': by_year[y]['average_overall_score']} for y in sorted(by_year)
            ],
            **{k: v for k, v in current.items() if k != 'quarters'},
        })


class HRYearsView(APIView):
    """Every year that has goals in the organization, side by side."""

    permission_classes = [IsHR]

    def get(self, request):
        today = timezone.localdate()
        org_id = request.user.org_id
        years = sorted(
            set(
                Goal.objects.filter(employee__user__org_id=org_id, evaluation_year__isnull=False)
                .values_list('evaluation_year', flat=True)
            )
        )
        return Response({
            'years': [
                {'year': year, **org_summary(org_id, year, today)} for year in years
            ],
        })
