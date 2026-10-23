# KPI feature: ADDS columns only. No column is altered or dropped, so
# existing rows in goal / evaluation keep all their data.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0009_remove_employee_service_years_employee_manager'),
    ]

    operations = [
        migrations.AddField(
            model_name='goal',
            name='employee',
            field=models.ForeignKey(blank=True, db_column='employee_id', null=True, on_delete=django.db.models.deletion.PROTECT, related_name='goals', to='accounts.employee'),
        ),
        migrations.AddField(
            model_name='goal',
            name='evaluation_year',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='goal',
            name='period_start',
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='goal',
            name='period_end',
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='goal',
            name='target_value',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name='goal',
            name='actual_value',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name='evaluation',
            name='evaluation_year',
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='evaluation',
            name='is_final',
            field=models.BooleanField(default=False),
        ),
        migrations.AddConstraint(
            model_name='evaluation',
            constraint=models.UniqueConstraint(fields=('employee', 'evaluation_year'), name='one_evaluation_per_employee_per_year'),
        ),
    ]
