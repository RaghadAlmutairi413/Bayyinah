from rest_framework.permissions import BasePermission

from workspace.permissions import is_employee, is_manager


def is_hr(user):
    return user.role == 'HR'


class IsManager(BasePermission):
    message = 'Only managers can do this.'

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and is_manager(user))


class IsHR(BasePermission):
    message = 'Only HR professionals can do this.'

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and is_hr(user))


class IsManagerOrEmployee(BasePermission):
    message = 'Only managers and employees can view performance.'

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user and user.is_authenticated and (is_manager(user) or is_employee(user))
        )
