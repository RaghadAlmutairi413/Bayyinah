from rest_framework import serializers

from accounts.models import Employee, Project, Task

from .permissions import PRIVATE, PUBLIC


class ProjectWriteSerializer(serializers.ModelSerializer):
    # The API keeps calling it "name"; it is stored in Project.title.
    name = serializers.CharField(source='title', max_length=255)  # required, cannot be blank

    class Meta:
        model = Project
        fields = ['name', 'description']


class TaskWriteSerializer(serializers.ModelSerializer):
    """Used by managers to create and edit tasks.

    The task is stored with an `employee`; the API keeps calling that
    person the `assignee`. A new task is private unless the manager
    marks it public.
    """

    title = serializers.CharField(max_length=255)
    assignee = serializers.PrimaryKeyRelatedField(
        source='employee',
        queryset=Employee.objects.select_related('user'),
    )
    privacy = serializers.ChoiceField(choices=[PUBLIC, PRIVATE], required=False)

    class Meta:
        model = Task
        fields = [
            'title', 'description', 'project', 'assignee',
            'start_date', 'due_date', 'priority', 'privacy',
        ]

    def validate_project(self, project):
        if project is None:
            return None

        manager = self.context['request'].user
        if project.manager_id != manager.pk:
            raise serializers.ValidationError(
                "You can only create tasks for your own projects."
            )
        return project

    def validate_assignee(self, employee):
        manager = self.context['request'].user
        if employee.system_role != 'Employee' or employee.user.org_id != manager.org_id:
            raise serializers.ValidationError(
                'Choose an employee from your organization.'
            )
        return employee

    def validate(self, data):
        # For a partial update, fall back to the values already saved.
        start = data.get('start_date') or (self.instance and self.instance.start_date)
        due = data.get('due_date') or (self.instance and self.instance.due_date)
        if start and due and due < start:
            raise serializers.ValidationError(
                {'due_date': 'The due date cannot be before the start date.'}
            )
        return data

    def create(self, validated_data):
        validated_data.setdefault('privacy', PRIVATE)
        return super().create(validated_data)