# KPI feature: the numeric target_value / actual_value (added in 0010) replace
# the unused text columns target_outcome / actual_outcome. REMOVES two columns
# from goal, so review it and back up the database before running migrate.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0010_goal_kpi_fields'),
    ]

    operations = [
        migrations.RemoveField(model_name='goal', name='target_outcome'),
        migrations.RemoveField(model_name='goal', name='actual_outcome'),
    ]
