from django.urls import path

from .views import (
    ProjectDetailView,
    ProjectListView,
    ProjectMembersView,
    TaskDetailView,
    TaskListView,
)

urlpatterns = [
    path('projects/', ProjectListView.as_view(), name='project-list'),
    path('projects/<int:project_id>/', ProjectDetailView.as_view(), name='project-detail'),
    path('projects/<int:project_id>/members/', ProjectMembersView.as_view(), name='project-members'),
    path('tasks/', TaskListView.as_view(), name='task-list'),
    path('tasks/<int:task_id>/', TaskDetailView.as_view(), name='task-detail'),
]