from django.urls import path

from .views import (
    EmployeeGoalsView,
    EmployeeTasksView,
    GoalActualView,
    GoalTasksView,
    HRDashboardView,
    HRYearsView,
    MyPerformanceView,
    PerformanceCompareView,
    TeamPerformanceView,
)

urlpatterns = [
    path('employees/<int:employee_id>/goals/', EmployeeGoalsView.as_view(), name='employee-goals'),
    path('employees/<int:employee_id>/tasks/', EmployeeTasksView.as_view(), name='employee-tasks'),
    path('goals/<int:goal_id>/actual/', GoalActualView.as_view(), name='goal-actual'),
    path('goals/<int:goal_id>/tasks/', GoalTasksView.as_view(), name='goal-tasks'),
    path('performance/', MyPerformanceView.as_view(), name='my-performance'),
    path('performance/compare/', PerformanceCompareView.as_view(), name='performance-compare'),
    path('team/', TeamPerformanceView.as_view(), name='team-performance'),
    path('dashboard/', HRDashboardView.as_view(), name='hr-dashboard'),
    path('dashboard/years/', HRYearsView.as_view(), name='hr-years'),
]
