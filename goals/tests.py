from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIRequestFactory, APITestCase, force_authenticate

from accounts.models import (
    Employee, Evaluation, Goal, Manager, Organization, Project, Task, TaskGoal, User,
)

from . import rules
from .views import TeamPerformanceView

TODAY = date(2026, 3, 15)


class RulesTests(SimpleTestCase):
    def test_period_dates(self):
        self.assertEqual(rules.period_dates('annual', 2026), (date(2026, 1, 1), date(2026, 12, 31)))
        self.assertEqual(rules.period_dates('Q2', 2026), (date(2026, 4, 1), date(2026, 6, 30)))
        self.assertEqual(rules.period_dates('M2', 2028), (date(2028, 2, 1), date(2028, 2, 29)))

    def test_rating_scale_boundaries(self):
        cases = [(101, 5), (100, 4), (90, 4), (89.99, 3), (80, 3), (79.99, 2), (60, 2), (59.99, 1), (0, 1)]
        for percent, rating in cases:
            self.assertEqual(rules.rating_for(Decimal(str(percent))), rating, percent)

    def test_progress_is_not_capped_and_empty_manual_value_is_none(self):
        self.assertEqual(rules.progress_percent(4, 5), Decimal('125.00'))
        self.assertIsNone(rules.progress_percent(4, None))

    def test_only_done_tasks_due_inside_the_period_count(self):
        start, end = date(2026, 1, 1), date(2026, 3, 31)
        tasks = [
            SimpleNamespace(status='completed', due_date=date(2026, 2, 1)),
            SimpleNamespace(status='completed', due_date=date(2026, 4, 1)),
            SimpleNamespace(status='in_review', due_date=date(2026, 2, 1)),
            SimpleNamespace(status='completed', due_date=None),
        ]
        self.assertEqual(rules.count_done_tasks(tasks, start, end), 1)

    def test_overall_score_is_weighted_sum(self):
        self.assertEqual(rules.overall_score([(4, 30), (3, 70)]), Decimal('3.30'))
        self.assertIsNone(rules.overall_score([]))

    def test_months_fall_in_their_quarter_on_the_chart(self):
        self.assertEqual(rules.chart_bucket('M5'), 'Q2')
        self.assertEqual(rules.chart_bucket('M12'), 'Q4')
        self.assertEqual(rules.chart_bucket('annual'), 'annual')
        averages = rules.bucket_averages({'Q1': [4, 2], 'M2': [5], 'annual': [3]})
        self.assertEqual(averages, [3.67, None, None, None, 3.0])

    def test_year_ended(self):
        self.assertFalse(rules.year_ended(2026, date(2026, 12, 31)))
        self.assertTrue(rules.year_ended(2026, date(2027, 1, 1)))


class TeamPerformanceViewTests(SimpleTestCase):
    def test_team_response_contains_separate_employee_names(self):
        request = APIRequestFactory().get('/team/?year=2026')
        force_authenticate(
            request,
            user=SimpleNamespace(is_authenticated=True, role='Manager'),
        )
        employee = SimpleNamespace(
            pk=17,
            user=SimpleNamespace(first_name='Sara', last_name='Ali'),
        )
        with (
            patch('goals.permissions.is_manager', return_value=True),
            patch('goals.views.services.team_of', return_value=[employee]),
            patch(
                'goals.views.services.performance',
                return_value={
                    'goals': [],
                    'overall_score': None,
                    'is_final': False,
                },
            ),
        ):
            response = TeamPerformanceView.as_view()(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data[0]['first_name'], 'Sara')
        self.assertEqual(response.data[0]['last_name'], 'Ali')
        self.assertNotIn('name', response.data[0])


def make_user(org, email, role=None, manager=None, is_manager_row=False):
    user = User.objects.create_user(
        email=email,
        password='pass12345',
        org=org,
        first_name=email.split('@')[0].title(),
        last_name='Test',
    )
    if role:
        Employee.objects.create(user=user, system_role=role, manager=manager)
    if is_manager_row:
        Manager.objects.create(user=user)
    return user


def goal_input(name, period, weight, kind='Manual', target='4', **extra):
    return {'name': name, 'type': kind, 'period': period, 'target': target,
            'weight': weight, **extra}


@override_settings(ROOT_URLCONF='goals.urls')
class GoalsApiTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        org = Organization.objects.create(name='Acme')
        cls.hr = make_user(org, 'hr@acme.test')
        cls.boss = make_user(org, 'boss@acme.test', role='Manager', is_manager_row=True)
        cls.boss2 = make_user(org, 'boss2@acme.test', role='Manager', is_manager_row=True)
        boss_row = Manager.objects.get(pk=cls.boss.pk)
        cls.sara = make_user(org, 'sara@acme.test', role='Employee', manager=boss_row)
        cls.other = make_user(org, 'other@acme.test', role='Employee',
                              manager=Manager.objects.get(pk=cls.boss2.pk))
        cls.project = Project.objects.create(title='Site', manager=boss_row)

    def setUp(self):
        patcher = patch('django.utils.timezone.localdate', return_value=TODAY)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.url = f'/employees/{self.sara.pk}/goals/'

    def save_goals(self, goals, user=None):
        self.client.force_authenticate(user or self.boss)
        return self.client.put(self.url, {'year': 2026, 'goals': goals}, format='json')

    def two_goals(self):
        return [goal_input('Sales', 'Q4', '60'), goal_input('Quality', 'Q4', '40', kind='Task-based', target='2')]

    def test_manager_team_returns_separate_name_fields(self):
        self.client.force_authenticate(self.boss)

        response = self.client.get('/team/?year=2026')

        self.assertEqual(response.status_code, 200)
        sara = next(person for person in response.data if person['id'] == self.sara.pk)
        self.assertEqual(sara['first_name'], self.sara.first_name)
        self.assertEqual(sara['last_name'], self.sara.last_name)
        self.assertNotIn('name', sara)

    def test_manager_saves_goals_and_dates_come_from_the_period(self):
        response = self.save_goals(self.two_goals())
        self.assertEqual(response.status_code, 200, response.data)
        goal = Goal.objects.get(name='Sales')
        self.assertEqual((goal.period_start, goal.period_end), (date(2026, 10, 1), date(2026, 12, 31)))
        self.assertEqual(goal.employee_id, self.sara.pk)
        self.assertEqual(goal.manager_id, self.boss.pk)

    def test_weights_must_total_100_and_nothing_is_saved(self):
        response = self.save_goals([goal_input('A', 'Q4', '60'), goal_input('B', 'Q4', '30')])
        self.assertEqual(response.status_code, 400)
        self.assertIn('90', str(response.data))
        self.assertEqual(Goal.objects.count(), 0)

    def test_manager_cannot_set_goals_for_someone_outside_the_team(self):
        self.client.force_authenticate(self.boss)
        response = self.client.put(
            f'/employees/{self.other.pk}/goals/',
            {'year': 2026, 'goals': [goal_input('A', 'Q4', '100')]}, format='json',
        )
        self.assertEqual(response.status_code, 404)

    def test_employee_and_hr_cannot_set_goals(self):
        for user in (self.sara, self.hr):
            self.assertEqual(self.save_goals(self.two_goals(), user).status_code, 403)

    def test_goal_set_for_a_period_that_already_ended_is_refused(self):
        response = self.save_goals([goal_input('Old', 'M1', '100')])
        self.assertEqual(response.status_code, 400)

    def test_started_goal_is_locked_but_future_goal_can_be_replaced(self):
        self.save_goals([goal_input('Year', 'annual', '50'), goal_input('Later', 'Q4', '50')])
        year_goal = Goal.objects.get(name='Year')
        later = Goal.objects.get(name='Later')
        # change weights of the started goal -> refused
        response = self.save_goals([
            {**goal_input('Year', 'annual', '70'), 'id': year_goal.pk},
            {**goal_input('Later', 'Q4', '30'), 'id': later.pk},
        ])
        self.assertEqual(response.status_code, 400)
        # remove the started goal -> refused
        self.assertEqual(self.save_goals([goal_input('New', 'Q4', '100')]).status_code, 400)
        # replace only the not-yet-started goal -> allowed
        response = self.save_goals([
            {**goal_input('Year', 'annual', '50'), 'id': year_goal.pk},
            goal_input('Replacement', 'Q3', '50'),
        ])
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(Goal.objects.filter(name='Later').exists())

    def test_measurement_type_cannot_change(self):
        self.save_goals([goal_input('G', 'Q4', '100')])
        goal = Goal.objects.get(name='G')
        response = self.save_goals([{**goal_input('G', 'Q4', '100', kind='Task-based'), 'id': goal.pk}])
        self.assertEqual(response.status_code, 400)

    def test_manual_value_gives_progress_rating_and_score(self):
        self.save_goals([goal_input('A', 'Q4', '100', target='4')])
        goal = Goal.objects.get(name='A')
        self.client.force_authenticate(self.boss)
        response = self.client.patch(f'/goals/{goal.pk}/actual/', {'actual_value': '5'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['progress'], 125.0)
        self.assertEqual(response.data['rating'], 5)
        self.client.force_authenticate(self.sara)
        view = self.client.get('/performance/?year=2026')
        self.assertEqual(view.data['overall_score'], 5.0)
        self.assertFalse(view.data['is_final'])

    def test_manual_goal_without_value_is_zero_percent_and_flagged(self):
        self.save_goals([goal_input('A', 'Q4', '100')])
        self.client.force_authenticate(self.sara)
        goal = self.client.get('/performance/?year=2026').data['goals'][0]
        self.assertEqual((goal['progress'], goal['rating'], goal['no_value']), (0.0, 1, True))

    def test_task_based_progress_counts_done_tasks_inside_the_period_only(self):
        self.save_goals([goal_input('T', 'Q1', '100', kind='Task-based', target='2')])
        goal = Goal.objects.get(name='T')

        def task(status, due):
            return Task.objects.create(
                title='t', status=status, due_date=due, project=self.project,
                employee=Employee.objects.get(pk=self.sara.pk),
            )

        counted = task('completed', date(2026, 2, 1))
        late = task('completed', date(2026, 5, 1))
        not_done = task('in_review', date(2026, 2, 2))
        self.client.force_authenticate(self.boss)
        response = self.client.put(
            f'/goals/{goal.pk}/tasks/',
            {'task_ids': [counted.pk, late.pk, not_done.pk]}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['progress'], 50.0)
        self.assertEqual(response.data['rating'], 1)

    def test_manager_lists_team_member_tasks_before_a_goal_exists(self):
        Task.objects.create(title='t', project=self.project, employee=Employee.objects.get(pk=self.sara.pk))
        self.client.force_authenticate(self.boss)
        response = self.client.get(f'/employees/{self.sara.pk}/tasks/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([t['title'] for t in response.data], ['t'])
        self.client.force_authenticate(self.boss2)
        self.assertEqual(self.client.get(f'/employees/{self.sara.pk}/tasks/').status_code, 404)

    def test_cannot_link_tasks_of_another_employee(self):
        self.save_goals([goal_input('T', 'Q4', '100', kind='Task-based')])
        goal = Goal.objects.get(name='T')
        foreign = Task.objects.create(
            title='x', project=self.project, employee=Employee.objects.get(pk=self.other.pk),
        )
        self.client.force_authenticate(self.boss)
        response = self.client.put(f'/goals/{goal.pk}/tasks/', {'task_ids': [foreign.pk]}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_a_task_can_count_toward_two_goals(self):
        self.save_goals([
            goal_input('A', 'Q1', '50', kind='Task-based', target='1'),
            goal_input('B', 'annual', '50', kind='Task-based', target='1'),
        ])
        task = Task.objects.create(
            title='t', status='completed', due_date=date(2026, 2, 1),
            project=self.project, employee=Employee.objects.get(pk=self.sara.pk),
        )
        for goal in Goal.objects.all():
            TaskGoal.objects.create(task=task, goal=goal)
        self.client.force_authenticate(self.sara)
        goals = self.client.get('/performance/?year=2026').data['goals']
        self.assertEqual([g['progress'] for g in goals], [100.0, 100.0])

    def test_score_is_frozen_when_the_year_ends(self):
        self.save_goals([goal_input('A', 'Q4', '100', target='4')])
        goal = Goal.objects.get(name='A')
        goal.actual_value = Decimal('4')
        goal.save()
        self.client.force_authenticate(self.sara)
        with patch('django.utils.timezone.localdate', return_value=date(2027, 1, 5)):
            data = self.client.get('/performance/?year=2026').data
        self.assertTrue(data['is_final'])
        self.assertEqual(data['overall_score'], 4.0)
        goal.refresh_from_db()
        goal.actual_value = Decimal('0')   # a late change must not alter the final score
        goal.save()
        with patch('django.utils.timezone.localdate', return_value=date(2027, 1, 6)):
            data = self.client.get('/performance/?year=2026').data
        self.assertEqual(data['overall_score'], 4.0)
        self.assertEqual(Evaluation.objects.filter(is_final=True).count(), 1)

    def test_employee_sees_only_own_performance_and_manager_needs_employee_param(self):
        self.client.force_authenticate(self.boss)
        self.assertEqual(self.client.get('/performance/').status_code, 400)
        self.assertEqual(self.client.get(f'/performance/?employee={self.other.pk}').status_code, 404)
        self.assertEqual(self.client.get(f'/performance/?employee={self.sara.pk}').status_code, 200)
        self.client.force_authenticate(self.hr)
        self.assertEqual(self.client.get('/performance/').status_code, 403)

    def test_hr_dashboard_averages_by_period(self):
        self.save_goals([goal_input('A', 'Q4', '100', target='4')])
        Goal.objects.filter(name='A').update(actual_value=Decimal('4'))
        self.client.force_authenticate(self.hr)
        data = self.client.get('/dashboard/?year=2026').data
        self.assertEqual(data['employees_count'], 1)
        self.assertEqual(data['periods'], [{'period': 'Q4', 'goals_count': 1, 'average_rating': 4.0}])
        self.client.force_authenticate(self.boss)
        self.assertEqual(self.client.get('/dashboard/').status_code, 403)

    def add_last_year(self, actual):
        """One finished goal in 2025 for sara, with its frozen evaluation."""
        Goal.objects.create(
            name='Old', type='Manual', time_period='annual', weight=Decimal('100'),
            target_value=Decimal('10'), actual_value=Decimal(actual),
            period_start=date(2025, 1, 1), period_end=date(2025, 12, 31),
            evaluation_year=2025, manager_id=self.boss.pk,
            employee=Employee.objects.get(pk=self.sara.pk),
        )

    def test_compare_shows_this_year_and_last_year(self):
        self.add_last_year('8')   # 80% -> rating 3
        self.save_goals([goal_input('A', 'Q4', '100', target='4')])
        Goal.objects.filter(name='A').update(actual_value=Decimal('5'))   # 125% -> 5
        self.client.force_authenticate(self.sara)
        data = self.client.get('/performance/compare/?year=2026').data
        self.assertEqual((data['previous_year'], data['previous_score'], data['current_score']), (2025, 3.0, 5.0))
        self.assertEqual(data['quarters']['previous'], [None, None, None, None, 3.0])
        self.assertEqual(data['quarters']['current'], [None, None, None, 5.0, None])
        self.assertEqual([h['year'] for h in data['history']], [2023, 2024, 2025, 2026])
        self.assertEqual(data['history'][-1]['score'], 5.0)

    def test_compare_without_last_year_has_no_previous_score(self):
        self.save_goals([goal_input('A', 'Q4', '100')])
        self.client.force_authenticate(self.sara)
        data = self.client.get('/performance/compare/?year=2026').data
        self.assertIsNone(data['previous_score'])

    def test_hr_dashboard_includes_previous_year_average(self):
        self.add_last_year('10')   # 100% -> rating 4
        self.save_goals([goal_input('A', 'Q4', '100', target='4')])
        self.client.force_authenticate(self.hr)
        data = self.client.get('/dashboard/?year=2026').data
        self.assertEqual((data['previous_year'], data['previous_average_overall_score']), (2025, 4.0))
        self.assertEqual(data['quarters']['previous'], [None, None, None, None, 4.0])
        self.assertEqual([h['year'] for h in data['history']], [2023, 2024, 2025, 2026])

    def test_hr_years_lists_every_year_with_goals(self):
        self.add_last_year('10')   # 2025: rating 4
        self.save_goals([goal_input('A', 'Q4', '100', target='4')])   # 2026
        self.client.force_authenticate(self.hr)
        data = self.client.get('/dashboard/years/').data
        self.assertEqual([item['year'] for item in data['years']], [2025, 2026])
        self.assertEqual(data['years'][0]['average_overall_score'], 4.0)
        self.assertEqual(data['years'][0]['employees_count'], 1)
        self.client.force_authenticate(self.boss)
        self.assertEqual(self.client.get('/dashboard/years/').status_code, 403)
