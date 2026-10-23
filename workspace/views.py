from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Project, Task, User

from .permissions import PUBLIC, IsManagerOrEmployee, is_employee, is_manager
from .serializers import ProjectWriteSerializer, TaskWriteSerializer

NEXT_STATUS = {
    'todo': 'in_progress',
    'in_progress': 'in_review',
    'changes_requested': 'in_progress',
}
REVIEW_RESULTS = ('completed', 'changes_requested')


def employee_can_set_status(current_status, new_status):
    return NEXT_STATUS.get(current_status) == new_status


def review_error(current_status, new_status, feedback):
    if current_status != 'in_review':
        return {'status': 'Only tasks submitted for review can be reviewed.'}
    if new_status not in REVIEW_RESULTS:
        return {'status': 'Choose completed or changes_requested.'}
    if new_status == 'changes_requested' and not feedback:
        return {'feedback': 'Write feedback explaining the changes you need.'}
    return None


def progress_of(tasks):
    total = len(tasks)
    done = len([task for task in tasks if task.status == 'completed'])
    percent = round(done * 100 / total) if total else 0
    return {'total_tasks': total, 'completed_tasks': done, 'percent': percent}

def not_found(message):
    return Response({'detail': message}, status=status.HTTP_404_NOT_FOUND)


def only_managers():
    return Response(
        {'detail': 'Only managers can do this.'},
        status=status.HTTP_403_FORBIDDEN,
    )


# ---------- Who can see what (the visibility rules live here) ----------
#
# Manager:  every task of their own projects, public or private.
# Employee: their own tasks, plus the public tasks of every project where
#           they are assigned at least one task. Private tasks of other
#           people are never visible to them.
# HR:       none (blocked by IsManagerOrEmployee, and empty here as well).

def participant_project_ids(user):
    """Projects where this employee has at least one assigned task."""
    return Task.objects.filter(employee_id=user.pk).values('project_id')


def projects_for(user):
    if is_manager(user):
        return Project.objects.filter(manager_id=user.pk)
    if is_employee(user):
        return Project.objects.filter(pk__in=participant_project_ids(user))
    return Project.objects.none()


def tasks_for(user):
    tasks = Task.objects.select_related('project__manager__user', 'employee__user')
    if is_manager(user):
        return tasks.filter(Q(project__manager_id=user.pk) |
        Q(project__isnull=True))
    if is_employee(user):
        return tasks.filter(
            Q(employee_id=user.pk)
            | Q(privacy__iexact=PUBLIC, project_id__in=participant_project_ids(user))
        )
    return tasks.none()


def in_display_order(tasks):
    return tasks.order_by('due_date', '-created_at', '-pk')


# ---------- Turning models into JSON ----------

def task_data(task, user):
    return {
        'id': task.pk,
        'title': task.title,
        'description': task.description,
        'project':(
             {'id': task.project_id, 'name': task.project.title}
                if task.project else None
        ),
        'assignee': {
            'id': task.employee_id,
            'first_name': task.employee.user.first_name or '',
            'last_name': task.employee.user.last_name or '',
        },
        'start_date': task.start_date,
        'due_date': task.due_date,
        'priority': task.priority,
        'privacy': task.privacy,
        'feedback': task.feedback,
        'created_at': task.created_at,
        'is_mine': task.employee_id == user.pk,
        'status': task.status,
        'next_status': NEXT_STATUS.get(task.status) if task.employee_id == user.pk else None,
        'can_review': user.role == 'Manager' and task.status == 'in_review',
    }


def project_data(project, user, with_tasks=False):
    tasks = list(in_display_order(tasks_for(user).filter(project=project)))
    data = {
        'id': project.pk,
        'name': project.title,
        'description': project.description,
        'manager': {
            'first_name': project.manager.user.first_name or '',
            'last_name': project.manager.user.last_name or '',
        },
        'progress': progress_of(tasks),
    }
    if with_tasks:
        data['tasks'] = [task_data(task, user) for task in tasks]
    return data


# ---------- Projects ----------

class ProjectListView(APIView):
    permission_classes = [IsManagerOrEmployee]

    def get(self, request):
        projects = projects_for(request.user).select_related('manager__user').order_by('-pk')
        return Response([project_data(project, request.user) for project in projects])

    def post(self, request):
        if not is_manager(request.user):
            return only_managers()
        serializer = ProjectWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        project = serializer.save(manager=request.user.manager_record)
        return Response(project_data(project, request.user), status=status.HTTP_201_CREATED)


class ProjectDetailView(APIView):
    permission_classes = [IsManagerOrEmployee]

    def get_project(self, request, project_id):
        return (
            projects_for(request.user)
            .select_related('manager__user')
            .filter(pk=project_id)
            .first()
        )

    def get(self, request, project_id):
        project = self.get_project(request, project_id)
        if project is None:
            return not_found('Project not found.')
        return Response(project_data(project, request.user, with_tasks=True))

    def patch(self, request, project_id):
        if not is_manager(request.user):
            return only_managers()
        project = self.get_project(request, project_id)
        if project is None:
            return not_found('Project not found.')
        serializer = ProjectWriteSerializer(project, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(project_data(project, request.user, with_tasks=True))


class ProjectMembersView(APIView):
    """Shows the manager who takes part in one of their projects.

    There is no stored member list any more: an employee takes part in a
    project when they are assigned at least one task in it. To add someone,
    assign them a task. Managers only.
    """

    permission_classes = [IsManagerOrEmployee]

    def get(self, request, project_id):
        if not is_manager(request.user):
            return only_managers()
        project = Project.objects.filter(pk=project_id, manager_id=request.user.pk).first()
        if project is None:
            return not_found('Project not found.')
        member_ids = set(
            Task.objects.filter(project=project).values_list('employee_id', flat=True)
        )
        employees = User.objects.filter(
            org_id=request.user.org_id,
            employee_record__system_role='Employee',
        ).order_by('first_name', 'last_name')
        return Response([
            {
                'employee_id': employee.pk,
                'first_name': employee.first_name or '',
                'last_name': employee.last_name or '',
                'is_member': employee.pk in member_ids,
            }
            for employee in employees
        ])


# ---------- Tasks ----------

class TaskListView(APIView):
    permission_classes = [IsManagerOrEmployee]

    def get(self, request):
        tasks = in_display_order(tasks_for(request.user))
        return Response([task_data(task, request.user) for task in tasks])

    def post(self, request):
        if not is_manager(request.user):
            return only_managers()
        serializer = TaskWriteSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        task = serializer.save(created_at=timezone.now())
        return Response(task_data(task, request.user), status=status.HTTP_201_CREATED)


class TaskDetailView(APIView):
    permission_classes = [IsManagerOrEmployee]
    employee_write_methods = ('PATCH',)

    def get_task(self, request, task_id):
        return tasks_for(request.user).filter(pk=task_id).first()

    def get(self, request, task_id):
        task = self.get_task(request, task_id)
        if task is None:
            return not_found('Task not found.')
        return Response(task_data(task, request.user))

        employee_write_methods = ('PATCH',)   # status steps only, enforced in patch()

    def patch(self, request, task_id):
        task = self.get_task(request, task_id)
        if task is None:
            return not_found('Task not found.')

        if is_manager(request.user):
            if 'status' in request.data:
                return self.review(request, task)
            serializer = TaskWriteSerializer(
                task, data=request.data, partial=True, context={'request': request}
            )
            serializer.is_valid(raise_exception=True)
            task = serializer.save()
            return Response(task_data(task, request.user))

        # Employees: only their own task, only the status field, one step forward.
        if task.employee_id != request.user.pk:
            return Response(
                {'detail': 'You can only update your own tasks.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        if set(request.data) != {'status'}:
            return Response(
                {'detail': 'Employees can only update the task status.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        new_status = request.data['status']
        if not employee_can_set_status(task.status, new_status):
            return Response(
                {'status': 'You can move a task from To Do to In Progress, then submit it '
                           'for review. Only your manager can complete it.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        task.status = new_status
        task.save(update_fields=['status'])
        return Response(task_data(task, request.user))

    def review(self, request, task):
        """Manager approves a submitted task, or requests changes with feedback."""
        if not set(request.data) <= {'status', 'feedback'}:
            return Response(
                {'detail': 'To review a task, send only status and feedback.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        feedback = request.data.get('feedback') or ''
        if not isinstance(feedback, str):
            return Response(
                {'feedback': 'Feedback must be text.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        feedback = feedback.strip()
        new_status = request.data['status']

        error = review_error(task.status, new_status, feedback)
        if error:
            return Response(error, status=status.HTTP_400_BAD_REQUEST)

        task.status = new_status
        fields = ['status']
        if feedback:
            task.feedback = feedback
            fields.append('feedback')
        task.save(update_fields=fields)
        return Response(task_data(request.user and task, request.user))

    def delete(self, request, task_id):
        if not is_manager(request.user):
            return only_managers()
        task = self.get_task(request, task_id)
        if task is None:
            return not_found('Task not found.')
        task.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
