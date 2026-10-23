from decimal import Decimal

from rest_framework import serializers

from . import rules


class GoalInputSerializer(serializers.Serializer):
    """One goal in the set a manager saves for an employee."""

    id = serializers.IntegerField(required=False)
    name = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    type = serializers.ChoiceField(choices=rules.GOAL_TYPES)
    period = serializers.ChoiceField(choices=rules.PERIODS)
    target = serializers.DecimalField(
        max_digits=10, decimal_places=2, min_value=Decimal('0.01'),
    )
    weight = serializers.DecimalField(
        max_digits=5, decimal_places=2, min_value=Decimal('0.01'), max_value=Decimal('100'),
    )


class GoalSetSerializer(serializers.Serializer):
    """The whole set of goals of one employee for one evaluation year."""

    year = serializers.IntegerField(min_value=2000, max_value=2100)
    goals = GoalInputSerializer(many=True, allow_empty=False)

    def validate_goals(self, goals):
        total = rules.weights_total(g['weight'] for g in goals)
        if total != 100:
            raise serializers.ValidationError(
                f'The weights total {total}%. They must total 100%.'
            )
        return goals


class ActualValueSerializer(serializers.Serializer):
    actual_value = serializers.DecimalField(
        max_digits=10, decimal_places=2, min_value=Decimal('0'),
    )


class LinkedTasksSerializer(serializers.Serializer):
    task_ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=True)
