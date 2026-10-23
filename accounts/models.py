from django.contrib.auth.models import AbstractBaseUser, BaseUserManager
from django.db import models


class Organization(models.Model):
    id = models.AutoField(primary_key=True)
    name = models.CharField(max_length=255)

    class Meta:
        db_table = 'organization'

    def __str__(self):
        return self.name


class UserManager(BaseUserManager):
    def create_user(
        self,
        email,
        password=None,
        org=None,
        first_name=None,
        last_name=None,
        department=None,
        gender=None,
        job_title=None,
        allowed_absence_days=None,
    ):
        if not email:
            raise ValueError('Users must have an email address.')
        if not first_name or not first_name.strip():
            raise ValueError('Users must have a first name.')
        if not last_name or not last_name.strip():
            raise ValueError('Users must have a last name.')
        first_name = first_name.strip()
        last_name = last_name.strip()
        if len(first_name) > 255 or len(last_name) > 255:
            raise ValueError('Names must be 255 characters or fewer.')

        user = self.model(
            email=self.normalize_email(email),
            org=org,
            first_name=first_name,
            last_name=last_name,
            department=department,
            gender=gender,
            job_title=job_title,
            allowed_absence_days=allowed_absence_days,
        )
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user


class User(AbstractBaseUser):
    user_id = models.AutoField(primary_key=True)
    password = models.CharField(max_length=255, db_column='password_hash')
    last_login = None
    email = models.EmailField(max_length=255, unique=True)
    first_name = models.CharField(max_length=255, blank=True, null=True)
    last_name = models.CharField(max_length=255, blank=True, null=True)
    gender = models.CharField(max_length=50, blank=True, null=True)
    job_title = models.CharField(max_length=255, blank=True, null=True)
    allowed_absence_days = models.IntegerField(blank=True, null=True)
    department = models.CharField(max_length=255, blank=True, null=True)
    org = models.ForeignKey(
        Organization,
        on_delete=models.PROTECT,
        db_column='org_id',
        related_name='users',
    )

    objects = UserManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['org']

    class Meta:
        db_table = 'bayyinah_user'

    @property
    def role(self):
        if hasattr(self, 'manager_record'):
            return 'Manager'
        try:
            return self.employee_record.system_role   # 'Employee' or 'HR'
        except Employee.DoesNotExist:
            return 'HR'

    def get_role_display(self):
        if self.role == 'HR':
            return 'HR Professional'
        return self.role

    @property
    def is_active(self):
        return True

    @property
    def is_staff(self):
        return self.role == 'HR'

    @property
    def display_name(self):
        return f'{self.first_name or ""} {self.last_name or ""}'.strip()

    def get_full_name(self):
        return self.display_name

    def get_short_name(self):
        return self.first_name or self.email

    def __str__(self):
        return self.email


class Employee(models.Model):
    user = models.OneToOneField(
        User,
        primary_key=True,
        on_delete=models.CASCADE,
        db_column='user_id',
        related_name='employee_record',
    )
    system_role = models.CharField(max_length=100, blank=True, null=True)
    hire_date = models.DateField(blank=True, null=True)

    manager = models.ForeignKey(
    'Manager',
    on_delete=models.SET_NULL,
    db_column='manager_id',
    related_name='managed_employees',
    blank=True,
    null=True,
)

    class Meta:
        db_table = 'employee'


class Manager(models.Model):
    user = models.OneToOneField(
        User,
        primary_key=True,
        on_delete=models.CASCADE,
        db_column='user_id',
        related_name='manager_record',
    )

    class Meta:
        db_table = 'manager'


class Project(models.Model):
    project_id = models.AutoField(primary_key=True)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    manager = models.ForeignKey(
        Manager,
        on_delete=models.PROTECT,
        db_column='manager_id',
        related_name='projects',
    )

    class Meta:
        db_table = 'project'


class Task(models.Model):
    task_id = models.AutoField(primary_key=True)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    priority = models.CharField(max_length=50, blank=True, null=True)
    start_date = models.DateField(blank=True, null=True)
    due_date = models.DateField(blank=True, null=True)
    feedback = models.TextField(blank=True, null=True)
    estimated_hours = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        blank=True,
        null=True,
    )
    created_at = models.DateTimeField(blank=True, null=True)
    privacy = models.CharField(max_length=50, blank=True, null=True)
    status = models.CharField(max_length=50, default='todo')
    project = models.ForeignKey(
        Project,
        on_delete=models.PROTECT,
        db_column='project_id',
        related_name='tasks',
        null=True,
        blank=True
    )
    employee = models.ForeignKey(
        Employee,
        on_delete=models.PROTECT,
        db_column='employee_id',
        related_name='tasks',
    )

    class Meta:
        db_table = 'task'


class Skill(models.Model):
    skill_id = models.AutoField(primary_key=True)
    name = models.CharField(max_length=255)

    class Meta:
        db_table = 'skills'


class EmployeeSkill(models.Model):
    pk = models.CompositePrimaryKey('employee', 'skill')
    employee = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        db_column='employee_id',
        related_name='skill_records',
    )
    skill = models.ForeignKey(
        Skill,
        on_delete=models.CASCADE,
        db_column='skill_id',
        related_name='employee_records',
    )
    skill_level = models.CharField(max_length=50, blank=True, null=True)

    class Meta:
        db_table = 'employee_skills'


class TaskSkill(models.Model):
    pk = models.CompositePrimaryKey('task', 'skill')
    task = models.ForeignKey(
        Task,
        on_delete=models.CASCADE,
        db_column='task_id',
        related_name='skill_records',
    )
    skill = models.ForeignKey(
        Skill,
        on_delete=models.CASCADE,
        db_column='skill_id',
        related_name='task_records',
    )
    skill_level = models.CharField(max_length=50, blank=True, null=True)

    class Meta:
        db_table = 'task_skills'


class AttendanceRecord(models.Model):
    pk = models.CompositePrimaryKey('employee', 'attendance_date')
    employee = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        db_column='employee_id',
        related_name='attendance_records',
    )
    attendance_date = models.DateField()
    check_in_time = models.TimeField(blank=True, null=True)
    check_out_time = models.TimeField(blank=True, null=True)
    status = models.CharField(max_length=50, blank=True, null=True)

    class Meta:
        db_table = 'attendancerecord'


class LeaveType(models.Model):
    leave_type_id = models.AutoField(primary_key=True)
    name = models.CharField(max_length=255)
    limit_days = models.IntegerField(blank=True, null=True)

    class Meta:
        db_table = 'leavetype'


class LeaveRequest(models.Model):
    request_id = models.AutoField(primary_key=True)
    start_date = models.DateField(blank=True, null=True)
    end_date = models.DateField(blank=True, null=True)
    note = models.TextField(blank=True, null=True)
    status = models.CharField(max_length=50, blank=True, null=True)
    submitted_at = models.DateTimeField(blank=True, null=True)
    employee = models.ForeignKey(
        Employee,
        on_delete=models.PROTECT,
        db_column='employee_id',
        related_name='leave_requests',
    )
    leave_type = models.ForeignKey(
        LeaveType,
        on_delete=models.PROTECT,
        db_column='leave_type_id',
        related_name='requests',
    )

    class Meta:
        db_table = 'leaverequest'


class MeetingSchedule(models.Model):
    meeting_id = models.AutoField(primary_key=True)
    google_event_id = models.CharField(max_length=255, blank=True, null=True)
    starts_at = models.TimeField(blank=True, null=True)
    ends_at = models.TimeField(blank=True, null=True)
    date = models.DateField(blank=True, null=True)
    employee = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        db_column='employee_id',
        related_name='meetings',
    )

    class Meta:
        db_table = 'meetingschedule'


class Goal(models.Model):
    goal_id = models.AutoField(primary_key=True)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    type = models.CharField(max_length=50, blank=True, null=True)
    weight = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        blank=True,
        null=True,
    )
    # Period code of the goal: annual, Q1-Q4 or M1-M12 (the dates are in period_start/period_end).
    time_period = models.CharField(max_length=100, blank=True, null=True)
    rating = models.DecimalField(
        max_digits=3,
        decimal_places=2,
        blank=True,
        null=True,
    )
    manager = models.ForeignKey(
        Manager,
        on_delete=models.PROTECT,
        db_column='manager_id',
        related_name='goals',
    )
    # --- KPI fields (goals feature) ---
    # target_value / actual_value are numbers so progress and rating can be calculated.
    employee = models.ForeignKey(
        Employee,
        on_delete=models.PROTECT,
        db_column='employee_id',
        related_name='goals',
        blank=True,
        null=True,
    )
    evaluation_year = models.PositiveSmallIntegerField(blank=True, null=True)
    period_start = models.DateField(blank=True, null=True)
    period_end = models.DateField(blank=True, null=True)
    target_value = models.DecimalField(
        max_digits=10, decimal_places=2, blank=True, null=True,
    )
    actual_value = models.DecimalField(
        max_digits=10, decimal_places=2, blank=True, null=True,
    )

    class Meta:
        db_table = 'goal'


class TaskGoal(models.Model):
    pk = models.CompositePrimaryKey('task', 'goal')
    task = models.ForeignKey(
        Task,
        on_delete=models.CASCADE,
        db_column='task_id',
        related_name='goal_records',
    )
    goal = models.ForeignKey(
        Goal,
        on_delete=models.CASCADE,
        db_column='goal_id',
        related_name='task_records',
    )

    class Meta:
        db_table = 'task_goal'


class Evaluation(models.Model):
    evaluation_id = models.AutoField(primary_key=True)
    overall_score = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        blank=True,
        null=True,
    )
    employee = models.ForeignKey(
        Employee,
        on_delete=models.PROTECT,
        db_column='employee_id',
        related_name='evaluations',
    )
    goal = models.ForeignKey(
        Goal,
        on_delete=models.SET_NULL,
        db_column='goal_id',
        related_name='evaluations',
        blank=True,
        null=True,
    )
    # One evaluation per employee per year; frozen (is_final) once the year ends.
    evaluation_year = models.PositiveSmallIntegerField(blank=True, null=True)
    is_final = models.BooleanField(default=False)

    class Meta:
        db_table = 'evaluation'
        constraints = [
            models.UniqueConstraint(
                fields=['employee', 'evaluation_year'],
                name='one_evaluation_per_employee_per_year',
            ),
        ]


class PredictionFactor(models.Model):
    factor_name = models.CharField(max_length=255, primary_key=True)
    contribution = models.DecimalField(max_digits=5, decimal_places=2)

    class Meta:
        db_table = 'predictionfactor'


class BurnoutSurvey(models.Model):
    survey_id = models.AutoField(primary_key=True)
    submission_date = models.DateField(blank=True, null=True)
    exhaustion_score = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        blank=True,
        null=True,
    )
    mental_distance_score = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        blank=True,
        null=True,
    )
    cognitive_impairment_score = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        blank=True,
        null=True,
    )
    emotional_impairment_score = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        blank=True,
        null=True,
    )
    overall_score = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        blank=True,
        null=True,
    )
    employee = models.ForeignKey(
        Employee,
        on_delete=models.PROTECT,
        db_column='employee_id',
        related_name='burnout_surveys',
    )

    class Meta:
        db_table = 'burnoutsurvey'


class BurnoutPrediction(models.Model):
    predicted_id = models.AutoField(primary_key=True, db_column='predictedID')
    prediction_date = models.DateField(db_column='predictiondate')
    risk_score = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        db_column='riskscore',
    )
    risk_level = models.CharField(max_length=50, db_column='risklevel')
    employee = models.ForeignKey(
        Employee,
        on_delete=models.PROTECT,
        db_column='employee_id',
        related_name='burnout_predictions',
    )

    class Meta:
        db_table = 'burnoutprediction'
