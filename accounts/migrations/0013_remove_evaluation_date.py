# KPI feature: the evaluation year (evaluation_year, added in 0010) replaces the
# evaluation date. REMOVES one column from evaluation, so review it and back up
# the database before running migrate.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0012_alter_task_project'),
    ]

    operations = [
        migrations.RemoveField(model_name='evaluation', name='date'),
    ]
