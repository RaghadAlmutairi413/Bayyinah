from datetime import date
from types import SimpleNamespace

from django.test import SimpleTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import Employee, Manager, Organization, Project, Task, User

from .permissions import PRIVATE, PUBLIC
from .views import employee_can_set_status, progress_of, review_error, task_data


class TaskDataTests(SimpleTestCase):
    def make_task(self, status='todo'):
        return SimpleNamespace(
            pk=1,
            title='Write report',
            description='',
            project_id=3,
            project=SimpleNamespace(title='Website'),
            employee_id=5,
            employee=SimpleNamespace(
                user=SimpleNamespace(first_name='Sara', last_name='Ali'),
            ),
            start_date=date(2026, 10, 1),
            due_date=date(2026, 10, 9),
            priority='high',
            privacy='public',
            status=status,
            feedback='Fix the totals',
            created_at=date(2026, 9, 30),
        )

    def test_task_comes_with_project_assignee_privacy_and_feedback(self):
        data = task_data(self.make_task(), SimpleNamespace(pk=5, role='Employee'))
        self.assertEqual(data['project'], {'id': 3, 'name': 'Website'})
        self.assertEqual(
            data['assignee'],
            {'id': 5, 'first_name': 'Sara', 'last_name': 'Ali'},
        )
        self.assertEqual(data['privacy'], 'public')
        self.assertEqual(data['feedback'], 'Fix the totals')
        self.assertEqual(data['status'], 'todo')

    def test_is_mine_only_for_the_assignee(self):
        task = self.make_task()
        self.assertTrue(task_data(task, SimpleNamespace(pk=5, role='Employee'))['is_mine'])
        self.assertFalse(task_data(task, SimpleNamespace(pk=6, role='Employee'))['is_mine'])

    def test_next_status_only_offered_to_the_assignee(self):
        assignee = SimpleNamespace(pk=5, role='Employee')
        colleague = SimpleNamespace(pk=6, role='Employee')
        self.assertEqual(task_data(self.make_task(), assignee)['next_status'], 'in_progress')
        self.assertIsNone(task_data(self.make_task(), colleague)['next_status'])

    def test_next_status_follows_the_review_flow(self):
        assignee = SimpleNamespace(pk=5, role='Employee')
        expected = {
            'todo': 'in_progress',
            'in_progress': 'in_review',
            'in_review': None,
            'changes_requested': 'in_progress',
            'completed': None,
        }
        for current, next_status in expected.items():
            data = task_data(self.make_task(status=current), assignee)
            self.assertEqual(data['next_status'], next_status)

    def test_only_the_manager_can_review_a_submitted_task(self):
        manager = SimpleNamespace(pk=9, role='Manager')
        employee = SimpleNamespace(pk=5, role='Employee')
        submitted = self.make_task(status='in_review')
        self.assertTrue(task_data(submitted, manager)['can_review'])
        self.assertFalse(task_data(submitted, employee)['can_review'])
        self.assertFalse(task_data(self.make_task(status='todo'), manager)['can_review'])
class EmployeeStatusTests(SimpleTestCase):
    def test_employee_moves_one_step_forward_and_submits_for_review(self):
        self.assertTrue(employee_can_set_status('todo', 'in_progress'))
        self.assertTrue(employee_can_set_status('in_progress', 'in_review'))

    def test_employee_restarts_work_after_changes_are_requested(self):
        self.assertTrue(employee_can_set_status('changes_requested', 'in_progress'))

    def test_employee_cannot_skip_steps_or_go_back(self):
        self.assertFalse(employee_can_set_status('todo', 'in_review'))
        self.assertFalse(employee_can_set_status('in_progress', 'todo'))
        self.assertFalse(employee_can_set_status('changes_requested', 'in_review'))

    def test_employee_cannot_complete_a_task(self):
        self.assertFalse(employee_can_set_status('in_progress', 'completed'))
        self.assertFalse(employee_can_set_status('in_review', 'completed'))
        self.assertFalse(employee_can_set_status('in_review', 'changes_requested'))

    def test_nothing_moves_after_completion(self):
        self.assertFalse(employee_can_set_status('completed', 'todo'))
        self.assertFalse(employee_can_set_status('completed', 'in_progress'))


class ManagerReviewTests(SimpleTestCase):
    def test_manager_can_approve_a_submitted_task(self):
        self.assertIsNone(review_error('in_review', 'completed', ''))

    def test_manager_can_request_changes_with_feedback(self):
        self.assertIsNone(review_error('in_review', 'changes_requested', 'Fix the totals'))

    def test_requesting_changes_needs_feedback(self):
        self.assertIn('feedback', review_error('in_review', 'changes_requested', ''))

    def test_only_submitted_tasks_can_be_reviewed(self):
        for current in ('todo', 'in_progress', 'changes_requested', 'completed'):
            self.assertIn('status', review_error(current, 'completed', ''))

    def test_review_only_accepts_the_two_decisions(self):
        self.assertIn('status', review_error('in_review', 'in_progress', 'x'))
        self.assertIn('status', review_error('in_review', 'todo', 'x'))


class ProgressTests(SimpleTestCase):
    def test_progress_percent(self):
        tasks = [SimpleNamespace(status='completed'), SimpleNamespace(status='todo')]
        self.assertEqual(progress_of(tasks)['percent'], 50)
        self.assertEqual(progress_of([])['percent'], 0)

    def test_only_completed_tasks_count_as_done(self):
        tasks = [SimpleNamespace(status='completed'), SimpleNamespace(status='in_review')]
        self.assertEqual(progress_of(tasks)['completed_tasks'], 1)

def make_user(org, email, role=None, manager=False):
    """role=None gives a user without an employee record, which is how HR is told apart."""
    user = User.objects.create_user(
        email=email,
        password='pass12345',
        org=org,
        first_name=email.split('@')[0].title(),
        last_name='Test',
    )
    if role:
        Employee.objects.create(user=user, system_role=role)
    if manager:
        Manager.objects.create(user=user)
    return user


def ids(response):
    return {item['id'] for item in response.data}


@override_settings(ROOT_URLCONF='workspace.urls')
class WorkspaceApiTestCase(APITestCase):
    """Shared data.

    Project 'Website' (manager1):
        emp1: pub1 (public), priv1 (private)
        emp2: pub2 (public), priv2 (private), legacy (privacy not set)
    Project 'Mobile' (manager2):
        emp3: other (public)
    idle has no tasks at all. outsider works for another organization.
    """

    @classmethod
    def setUpTestData(cls):
        org = Organization.objects.create(name='Acme')
        other_org = Organization.objects.create(name='Other Co')

        cls.hr = make_user(org, 'hr@acme.test')
        cls.hr_with_record = make_user(org, 'hr2@acme.test', role='HR')
        cls.manager1 = make_user(org, 'manager1@acme.test', role='Manager', manager=True)
        cls.manager2 = make_user(org, 'manager2@acme.test', role='Manager', manager=True)
        cls.emp1 = make_user(org, 'emp1@acme.test', role='Employee')
        cls.emp2 = make_user(org, 'emp2@acme.test', role='Employee')
        cls.emp3 = make_user(org, 'emp3@acme.test', role='Employee')
        cls.idle = make_user(org, 'idle@acme.test', role='Employee')
        cls.outsider = make_user(other_org, 'outsider@other.test', role='Employee')

        cls.website = Project.objects.create(title='Website', manager=cls.manager1.manager_record)
        cls.mobile = Project.objects.create(title='Mobile', manager=cls.manager2.manager_record)

        def add(project, user, privacy, title):
            return Task.objects.create(
                title=title,
                project=project,
                employee=user.employee_record,
                privacy=privacy,
                created_at=timezone.now(),
            )

        cls.pub1 = add(cls.website, cls.emp1, PUBLIC, 'pub1')
        cls.priv1 = add(cls.website, cls.emp1, PRIVATE, 'priv1')
        cls.pub2 = add(cls.website, cls.emp2, PUBLIC, 'pub2')
        cls.priv2 = add(cls.website, cls.emp2, PRIVATE, 'priv2')
        cls.legacy = add(cls.website, cls.emp2, None, 'legacy')
        cls.other = add(cls.mobile, cls.emp3, PUBLIC, 'other')

    def login(self, user):
        self.client.force_authenticate(user=user)

    def task_url(self, task):
        return reverse('task-detail', args=[task.pk])

    def project_url(self, project):
        return reverse('project-detail', args=[project.pk])


class TaskVisibilityTests(WorkspaceApiTestCase):
    def list_ids(self, user):
        self.login(user)
        response = self.client.get(reverse('task-list'))
        self.assertEqual(response.status_code, 200)
        return ids(response)

    def test_employee_sees_own_tasks_and_public_tasks_of_their_projects(self):
        # emp1 is assigned in Website: own pub1 and priv1, plus emp2's public task.
        self.assertEqual(
            self.list_ids(self.emp1),
            {self.pub1.pk, self.priv1.pk, self.pub2.pk},
        )

    def test_employee_never_sees_other_peoples_private_or_unmarked_tasks(self):
        seen = self.list_ids(self.emp1)
        for task in (self.priv2, self.legacy):
            self.assertNotIn(task.pk, seen)
        # And the other way round.
        seen = self.list_ids(self.emp2)
        self.assertIn(self.priv2.pk, seen)
        self.assertIn(self.legacy.pk, seen)
        self.assertNotIn(self.priv1.pk, seen)

    def test_employee_does_not_see_projects_they_have_no_task_in(self):
        self.assertEqual(self.list_ids(self.emp3), {self.other.pk})
        self.assertEqual(self.list_ids(self.idle), set())
        self.assertEqual(self.list_ids(self.outsider), set())

    def test_manager_sees_every_task_of_their_own_projects_only(self):
        self.assertEqual(
            self.list_ids(self.manager1),
            {self.pub1.pk, self.priv1.pk, self.pub2.pk, self.priv2.pk, self.legacy.pk},
        )
        self.assertEqual(self.list_ids(self.manager2), {self.other.pk})

    def test_direct_url_follows_the_same_rules(self):
        cases = [
            (self.emp1, self.pub2, 200),
            (self.emp1, self.priv1, 200),
            (self.emp1, self.priv2, 404),
            (self.emp1, self.legacy, 404),
            (self.emp3, self.pub1, 404),
            (self.idle, self.pub1, 404),
            (self.manager1, self.priv2, 200),
            (self.manager2, self.pub1, 404),
        ]
        for user, task, expected in cases:
            self.login(user)
            response = self.client.get(self.task_url(task))
            self.assertEqual(response.status_code, expected, f'{user.email} -> {task.title}')

    def test_task_response_carries_privacy_and_project(self):
        self.login(self.emp1)
        data = self.client.get(self.task_url(self.pub1)).data
        self.assertEqual(data['privacy'], PUBLIC)
        self.assertEqual(data['project'], {'id': self.website.pk, 'name': 'Website'})
        self.assertTrue(data['is_mine'])


class EmployeeCannotWriteTests(WorkspaceApiTestCase):
    def test_employee_cannot_create_a_task(self):
        self.login(self.emp1)
        before = Task.objects.count()
        response = self.client.post(
            reverse('task-list'),
            {'title': 'Sneaky', 'project': self.website.pk, 'assignee': self.emp1.pk},
            format='json',
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(Task.objects.count(), before)

    def test_employee_cannot_edit_any_task_even_their_own(self):
        self.login(self.emp1)
        # 403 for tasks the employee can see, 404 for tasks they cannot see.
        expected = {self.pub1: 403, self.pub2: 403, self.priv2: 404, self.other: 404}
        for task, code in expected.items():
            response = self.client.patch(self.task_url(task), {'title': 'Hacked'}, format='json')
            self.assertEqual(response.status_code, code, task.title)
            task.refresh_from_db()
            self.assertNotEqual(task.title, 'Hacked')

    def test_employee_cannot_delete_any_task_even_their_own(self):
        self.login(self.emp1)
        before = Task.objects.count()
        for task in (self.pub1, self.priv2, self.other):
            response = self.client.delete(self.task_url(task))
            self.assertEqual(response.status_code, 403, task.title)
        missing = reverse('task-detail', args=[999999])
        self.assertEqual(self.client.delete(missing).status_code, 403)
        self.assertEqual(Task.objects.count(), before)

    def test_employee_moves_only_their_own_task_one_step(self):
        self.login(self.emp1)
        url = self.task_url(self.pub1)
        response = self.client.patch(url, {'status': 'in_review'}, format='json')
        self.assertEqual(response.status_code, 400)  # cannot skip a step
        response = self.client.patch(url, {'status': 'in_progress'}, format='json')
        self.assertEqual(response.status_code, 200)
        response = self.client.patch(url, {'status': 'completed'}, format='json')
        self.assertEqual(response.status_code, 400)  # only the manager completes
        # emp2's public task is visible to emp1, but it is not theirs
        response = self.client.patch(
            self.task_url(self.pub2), {'status': 'in_progress'}, format='json'
        )
        self.assertEqual(response.status_code, 403)

    def test_employee_cannot_create_or_edit_projects_or_manage_members(self):
        self.login(self.emp1)
        response = self.client.post(reverse('project-list'), {'name': 'Mine'}, format='json')
        self.assertEqual(response.status_code, 403)
        response = self.client.patch(self.project_url(self.website), {'name': 'Mine'}, format='json')
        self.assertEqual(response.status_code, 403)
        response = self.client.get(reverse('project-members', args=[self.website.pk]))
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Project.objects.filter(title='Mine').exists())

    def test_employee_writes_are_refused_on_every_endpoint(self):
        # Including methods the views do not implement: 403, never a 405 or a 2xx.
        self.login(self.emp1)
        members = reverse('project-members', args=[self.website.pk])
        calls = [
            self.client.put(self.task_url(self.pub1), {}, format='json'),
            self.client.put(reverse('task-list'), {}, format='json'),
            self.client.delete(reverse('task-list')),
            self.client.delete(self.project_url(self.website)),
            self.client.put(self.project_url(self.website), {}, format='json'),
            self.client.put(members, {'employee_id': self.idle.pk, 'is_member': True}, format='json'),
            self.client.delete(members),
        ]
        for response in calls:
            self.assertEqual(response.status_code, 403)
        self.assertTrue(Project.objects.filter(pk=self.website.pk).exists())

    def test_anonymous_requests_are_refused(self):
        for url in (reverse('task-list'), self.task_url(self.pub1), reverse('project-list')):
            self.assertIn(self.client.get(url).status_code, (401, 403))


class HrIsSeparateTests(WorkspaceApiTestCase):
    def test_hr_is_refused_everywhere(self):
        for hr in (self.hr, self.hr_with_record):
            self.login(hr)
            task_url = self.task_url(self.pub1)
            project_url = self.project_url(self.website)
            members_url = reverse('project-members', args=[self.website.pk])
            calls = [
                self.client.get(reverse('task-list')),
                self.client.get(task_url),
                self.client.post(reverse('task-list'), {'title': 'x'}, format='json'),
                self.client.patch(task_url, {'title': 'x'}, format='json'),
                self.client.delete(task_url),
                self.client.get(reverse('project-list')),
                self.client.get(project_url),
                self.client.post(reverse('project-list'), {'name': 'x'}, format='json'),
                self.client.patch(project_url, {'name': 'x'}, format='json'),
                self.client.get(members_url),
            ]
            for response in calls:
                self.assertEqual(response.status_code, 403, hr.email)
        self.assertTrue(Task.objects.filter(pk=self.pub1.pk, title='pub1').exists())


class ManagerTaskTests(WorkspaceApiTestCase):
    def post_task(self, user, **overrides):
        self.login(user)
        payload = {'title': 'New task', 'project': self.website.pk, 'assignee': self.emp1.pk}
        payload.update(overrides)
        return self.client.post(reverse('task-list'), payload, format='json')

    def test_manager_creates_a_task_in_their_own_project(self):
        response = self.post_task(self.manager1, privacy=PUBLIC, priority='high')
        self.assertEqual(response.status_code, 201)
        task = Task.objects.get(pk=response.data['id'])
        self.assertEqual(task.project_id, self.website.pk)
        self.assertEqual(task.employee_id, self.emp1.pk)
        self.assertEqual(task.privacy, PUBLIC)
        self.assertIsNotNone(task.created_at)

    def test_new_task_is_private_unless_marked_public(self):
        response = self.post_task(self.manager1)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Task.objects.get(pk=response.data['id']).privacy, PRIVATE)

    def test_manager_cannot_create_a_task_in_someone_elses_project(self):
        response = self.post_task(self.manager1, project=self.mobile.pk)
        self.assertEqual(response.status_code, 400)
        self.assertIn('project', response.data)

    def test_assignee_must_be_an_employee_of_the_managers_organization(self):
        for person in (self.outsider, self.manager2, self.hr):
            response = self.post_task(self.manager1, assignee=person.pk)
            self.assertEqual(response.status_code, 400, person.email)
        self.assertFalse(Task.objects.filter(title='New task').exists())

    def test_bad_privacy_and_bad_dates_are_rejected(self):
        self.assertEqual(self.post_task(self.manager1, privacy='secret').status_code, 400)
        response = self.post_task(
            self.manager1, start_date='2026-10-10', due_date='2026-10-01'
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('due_date', response.data)

    def test_manager_edits_their_own_task(self):
        self.login(self.manager1)
        response = self.client.patch(
            self.task_url(self.priv1), {'title': 'Renamed', 'privacy': PUBLIC}, format='json'
        )
        self.assertEqual(response.status_code, 200)
        self.priv1.refresh_from_db()
        self.assertEqual(self.priv1.title, 'Renamed')
        self.assertEqual(self.priv1.privacy, PUBLIC)

    def test_making_a_task_public_shares_it_with_the_project_team(self):
        self.login(self.manager1)
        self.client.patch(self.task_url(self.priv2), {'privacy': PUBLIC}, format='json')
        self.login(self.emp1)
        self.assertEqual(self.client.get(self.task_url(self.priv2)).status_code, 200)

    def test_manager_cannot_move_a_task_into_someone_elses_project(self):
        self.login(self.manager1)
        response = self.client.patch(
            self.task_url(self.pub1), {'project': self.mobile.pk}, format='json'
        )
        self.assertEqual(response.status_code, 400)

    def test_manager_cannot_edit_or_delete_another_managers_task(self):
        self.login(self.manager1)
        response = self.client.patch(self.task_url(self.other), {'title': 'Mine now'}, format='json')
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.client.delete(self.task_url(self.other)).status_code, 404)
        self.other.refresh_from_db()
        self.assertEqual(self.other.title, 'other')

    def test_manager_deletes_their_own_task(self):
        self.login(self.manager1)
        response = self.client.delete(self.task_url(self.priv1))
        self.assertEqual(response.status_code, 204)
        self.assertFalse(Task.objects.filter(pk=self.priv1.pk).exists())

    def test_manager_reviews_a_submitted_task(self):
        Task.objects.filter(pk=self.pub1.pk).update(status='in_review')
        self.login(self.manager1)
        url = self.task_url(self.pub1)
        response = self.client.patch(url, {'status': 'changes_requested'}, format='json')
        self.assertEqual(response.status_code, 400)  # feedback is required
        response = self.client.patch(
            url, {'status': 'changes_requested', 'feedback': 'Fix totals'}, format='json'
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['feedback'], 'Fix totals')
        # a manager cannot review another manager's task
        response = self.client.patch(
            self.task_url(self.other), {'status': 'completed'}, format='json'
        )
        self.assertEqual(response.status_code, 404)


class ProjectTests(WorkspaceApiTestCase):
    def test_project_lists_follow_participation(self):
        self.login(self.emp1)
        self.assertEqual(ids(self.client.get(reverse('project-list'))), {self.website.pk})
        self.login(self.emp3)
        self.assertEqual(ids(self.client.get(reverse('project-list'))), {self.mobile.pk})
        self.login(self.idle)
        self.assertEqual(ids(self.client.get(reverse('project-list'))), set())
        self.login(self.manager1)
        self.assertEqual(ids(self.client.get(reverse('project-list'))), {self.website.pk})

    def test_project_detail_only_lists_tasks_the_user_may_see(self):
        self.login(self.emp1)
        response = self.client.get(self.project_url(self.website))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            {task['id'] for task in response.data['tasks']},
            {self.pub1.pk, self.priv1.pk, self.pub2.pk},
        )

    def test_manager_sees_every_task_in_their_project_detail(self):
        self.login(self.manager1)
        response = self.client.get(self.project_url(self.website))
        self.assertEqual(len(response.data['tasks']), 5)
        self.assertEqual(response.data['name'], 'Website')

    def test_project_detail_by_direct_url_is_limited(self):
        for user in (self.emp3, self.idle, self.manager2):
            self.login(user)
            response = self.client.get(self.project_url(self.website))
            self.assertEqual(response.status_code, 404, user.email)

    def test_manager_creates_and_edits_their_project(self):
        self.login(self.manager1)
        response = self.client.post(reverse('project-list'), {'name': 'Fresh'}, format='json')
        self.assertEqual(response.status_code, 201)
        project = Project.objects.get(pk=response.data['id'])
        self.assertEqual(project.title, 'Fresh')
        self.assertEqual(project.manager_id, self.manager1.pk)
        response = self.client.patch(self.project_url(project), {'name': 'Fresher'}, format='json')
        self.assertEqual(response.status_code, 200)
        project.refresh_from_db()
        self.assertEqual(project.title, 'Fresher')

    def test_project_needs_a_name(self):
        self.login(self.manager1)
        response = self.client.post(reverse('project-list'), {'name': ''}, format='json')
        self.assertEqual(response.status_code, 400)

    def test_manager_cannot_edit_another_managers_project(self):
        self.login(self.manager2)
        response = self.client.patch(self.project_url(self.website), {'name': 'Mine'}, format='json')
        self.assertEqual(response.status_code, 404)
        self.website.refresh_from_db()
        self.assertEqual(self.website.title, 'Website')


class ProjectMembersTests(WorkspaceApiTestCase):
    def test_members_are_the_employees_with_a_task_in_the_project(self):
        self.login(self.manager1)
        response = self.client.get(reverse('project-members', args=[self.website.pk]))
        self.assertEqual(response.status_code, 200)
        members = {row['employee_id']: row['is_member'] for row in response.data}
        self.assertEqual(
            members,
            {
                self.emp1.pk: True,
                self.emp2.pk: True,
                self.emp3.pk: False,
                self.idle.pk: False,
            },
        )  # no managers, no HR, nobody from another organization

    def test_manager_cannot_list_members_of_another_managers_project(self):
        self.login(self.manager2)
        response = self.client.get(reverse('project-members', args=[self.website.pk]))
        self.assertEqual(response.status_code, 404)

    def test_membership_cannot_be_edited_directly(self):
        self.login(self.manager1)
        response = self.client.put(
            reverse('project-members', args=[self.website.pk]),
            {'employee_id': self.idle.pk, 'is_member': True},
            format='json',
        )
        self.assertEqual(response.status_code, 405)