from rest_framework.permissions import SAFE_METHODS, BasePermission

from accounts.models import Manager

# Values of Task.privacy. Anything else (including empty) is treated as
# not public, so a task is only shared when it is explicitly marked public.
PUBLIC = 'public'
PRIVATE = 'private'


def is_manager(user):
    """A Manager has the Manager role and a row in the manager table."""
    return user.role == 'Manager' and Manager.objects.filter(pk=user.pk).exists()


def is_employee(user):
    return user.role == 'Employee'


class IsManagerOrEmployee(BasePermission):
    """HR professionals do not use the task workspaces."""

    message = 'Only managers and employees can use projects and tasks.'

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if is_manager(user):
            return True
        if is_employee(user):
            # Employees are read-only, except for methods a view lists in
            # employee_write_methods (only TaskDetailView lists PATCH).
            allowed = SAFE_METHODS + tuple(getattr(view, 'employee_write_methods', ()))
            if request.method in allowed:
                return True
            self.message = 'Only managers can create, change or delete projects and tasks.'
        return False