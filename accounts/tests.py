from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory, force_authenticate
from rest_framework_simplejwt.tokens import RefreshToken

from .models import (
    AttendanceRecord,
    BurnoutPrediction,
    BurnoutSurvey,
    Employee,
    EmployeeSkill,
    Evaluation,
    Goal,
    LeaveRequest,
    LeaveType,
    Manager,
    MeetingSchedule,
    Organization,
    PredictionFactor,
    Project,
    Skill,
    Task,
    TaskGoal,
    TaskSkill,
    User,
)
from .permissions import IsHRProfessional
from .views import (
    CSVEmployeeImportView,
    CSVImportInviteAllView,
    LoginView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    OrganizationSetupSerializer,
    SetPasswordView,
    TeamInviteView,
    _change_password,
    _employees_visible_to,
    _send_invitation_email,
    _send_password_reset_email,
)


class SchemaTests(SimpleTestCase):
    def test_models_match_the_supplied_business_tables(self):
        expected = {
            'organization',
            'bayyinah_user',
            'employee',
            'manager',
            'project',
            'task',
            'skills',
            'employee_skills',
            'task_skills',
            'attendancerecord',
            'leavetype',
            'leaverequest',
            'meetingschedule',
            'goal',
            'task_goal',
            'evaluation',
            'predictionfactor',
            'burnoutsurvey',
            'burnoutprediction',
        }
        models = (
            Organization,
            User,
            Employee,
            Manager,
            Project,
            Task,
            Skill,
            EmployeeSkill,
            TaskSkill,
            AttendanceRecord,
            LeaveType,
            LeaveRequest,
            MeetingSchedule,
            Goal,
            TaskGoal,
            Evaluation,
            PredictionFactor,
            BurnoutSurvey,
            BurnoutPrediction,
        )
        self.assertEqual({model._meta.db_table for model in models}, expected)

    def test_user_stores_first_and_last_names_only(self):
        field_names = {field.name for field in User._meta.fields}
        self.assertIn('first_name', field_names)
        self.assertIn('last_name', field_names)
        self.assertNotIn('full_name', field_names)

    def test_user_display_name_uses_first_and_last_name(self):
        user = User(first_name='Raghad', last_name='Almutairi')
        self.assertEqual(user.display_name, 'Raghad Almutairi')

    def test_organization_setup_requires_separate_names(self):
        serializer = OrganizationSetupSerializer(
            data={
                'organization_name': 'Example Org',
                'first_name': 'Raghad',
                'last_name': 'Almutairi',
                'email': 'raghad@example.com',
                'password': 'ValidPassword123!',
            },
        )
        with (
            patch('accounts.views.User.objects.filter') as filter_users,
            patch('accounts.views.validate_password'),
        ):
            filter_users.return_value.exists.return_value = False
            self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data['first_name'], 'Raghad')
        self.assertEqual(serializer.validated_data['last_name'], 'Almutairi')

    def test_organization_setup_rejects_combined_name_field(self):
        serializer = OrganizationSetupSerializer(
            data={
                'organization_name': 'Example Org',
                'full_name': 'Raghad Almutairi',
                'email': 'raghad@example.com',
                'password': 'ValidPassword123!',
            },
        )
        with patch('accounts.views.User.objects.filter') as filter_users:
            filter_users.return_value.exists.return_value = False
            self.assertFalse(serializer.is_valid())
        self.assertIn('first_name', serializer.errors)
        self.assertIn('last_name', serializer.errors)

    def test_burnout_survey_has_no_prediction_factor_relationship(self):
        field_names = {field.name for field in BurnoutSurvey._meta.get_fields()}
        self.assertNotIn('factor_name', field_names)
        self.assertIn('contribution', {field.name for field in PredictionFactor._meta.fields})


class AccountApiTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()

    def hr_user(self):
        return SimpleNamespace(
            is_authenticated=True,
            role='HR',
            org_id=12,
            org=SimpleNamespace(pk=12),
            department='People',
        )

    def test_hr_permission_requires_authenticated_hr_role(self):
        permission = IsHRProfessional()
        view = SimpleNamespace()
        hr = SimpleNamespace(is_authenticated=True, role='HR')
        manager = SimpleNamespace(is_authenticated=True, role='Manager')
        anonymous = SimpleNamespace(is_authenticated=False, role='HR')

        self.assertTrue(permission.has_permission(SimpleNamespace(user=hr), view))
        self.assertFalse(permission.has_permission(SimpleNamespace(user=manager), view))
        self.assertFalse(permission.has_permission(SimpleNamespace(user=anonymous), view))

    def test_employee_visibility_is_scoped_by_role(self):
        cases = (
            (
                SimpleNamespace(role='HR', org_id=12, pk=1),
                {'org_id': 12},
            ),
            (
                SimpleNamespace(role='Manager', org_id=12, department='People', pk=2),
                {'org_id': 12, 'department': 'People'},
            ),
            (
                SimpleNamespace(role='Employee', org_id=12, pk=3),
                {'user_id': 3},
            ),
        )

        for user, expected_filter in cases:
            with self.subTest(role=user.role):
                with patch('accounts.views.User.objects.filter') as filter_users:
                    result = _employees_visible_to(user)
                filter_users.return_value.select_related.assert_called_once_with(
                    'employee_record',
                    'org',
                )
                filter_users.return_value.select_related.return_value.filter.assert_called_once_with(
                    **expected_filter,
                )
                self.assertIs(
                    result,
                    filter_users.return_value.select_related.return_value.filter.return_value,
                )

    def test_login_rejects_invalid_credentials(self):
        request = self.factory.post(
            '/api/accounts/login/',
            {'email': 'person@example.com', 'password': 'incorrect'},
            format='json',
        )
        with patch('accounts.views.authenticate', return_value=None):
            response = LoginView.as_view()(request)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data['detail'], 'Invalid email or password.')

    def test_login_rejects_invalid_email_format(self):
        request = self.factory.post(
            '/api/accounts/login/',
            {'email': 'not-an-email', 'password': 'SomePassword1'},
            format='json',
        )
        response = LoginView.as_view()(request)
        self.assertEqual(response.status_code, 400)
        self.assertIn('email', response.data)

    def test_password_requires_uppercase_letter_and_number(self):
        serializer = OrganizationSetupSerializer()
        with self.assertRaises(DjangoValidationError) as no_uppercase:
            serializer.validate_password('lowercase123')
        self.assertIn('uppercase', str(no_uppercase.exception).lower())

        with self.assertRaises(DjangoValidationError) as no_number:
            serializer.validate_password('UppercaseOnly')
        self.assertIn('number', str(no_number.exception).lower())

    def test_password_reset_rejects_the_current_password(self):
        user = MagicMock()
        user.has_usable_password.return_value = True
        user.check_password.return_value = True
        data = {'uid': 'NQ', 'token': 'valid', 'password': 'ExistingPassword1'}
        with (
            patch('accounts.views._user_from_password_link', return_value=user),
            patch('accounts.views.validate_password') as validate_password,
        ):
            changed_user, error = _change_password(data)

        self.assertIsNone(changed_user)
        self.assertIn('different', error['password'][0])
        user.set_password.assert_not_called()
        validate_password.assert_not_called()

    def test_jwt_uses_the_new_user_primary_key(self):
        user = User(user_id=27, email='person@example.com', password='password-hash')

        token = RefreshToken.for_user(user)

        self.assertEqual(settings.SIMPLE_JWT['USER_ID_FIELD'], 'user_id')
        self.assertEqual(token['user_id'], '27')

    def test_password_reset_request_has_same_response_for_unknown_address(self):
        request = self.factory.post(
            '/api/accounts/password-reset/',
            {'email': 'unknown@example.com'},
            format='json',
        )
        with (
            patch('accounts.views.User.objects.filter') as filter_users,
            patch('accounts.views._send_password_reset_email') as send_email,
        ):
            filter_users.return_value.first.return_value = None
            response = PasswordResetRequestView.as_view()(request)

        self.assertEqual(response.status_code, 200)
        self.assertIn('If an account exists', response.data['detail'])
        send_email.assert_not_called()

    def test_password_reset_request_sends_message_to_existing_account(self):
        request = self.factory.post(
            '/api/accounts/password-reset/',
            {'email': 'person@example.com'},
            format='json',
        )
        user = SimpleNamespace(email='person@example.com')
        with (
            patch('accounts.views.User.objects.filter') as filter_users,
            patch('accounts.views._send_password_reset_email') as send_email,
        ):
            filter_users.return_value.first.return_value = user
            response = PasswordResetRequestView.as_view()(request)

        self.assertEqual(response.status_code, 200)
        send_email.assert_called_once_with(user)

    def test_reset_email_uses_reset_wording_and_link(self):
        user = SimpleNamespace(
            pk=5,
            email='person@example.com',
            display_name='Person One',
        )
        with (
            patch('accounts.views.settings.BAYYINAH_FRONTEND_URL', 'http://localhost:5173'),
            patch('accounts.views.default_token_generator.make_token', return_value='token-value'),
            patch('accounts.views.send_mail') as send_mail,
        ):
            _send_password_reset_email(user)

        email = send_mail.call_args.kwargs
        self.assertEqual(email['subject'], 'Password reset requested - Bayyinah')
        self.assertIn('Here is the link to reset your password:', email['message'])
        self.assertIn(
            'http://localhost:5173/reset-password?uid=NQ&token=token-value',
            email['message'],
        )
        self.assertNotIn('You have been added to the Bayyinah HR platform', email['message'])

    def test_invitation_email_uses_account_setup_link(self):
        user = SimpleNamespace(
            pk=5,
            email='person@example.com',
            display_name='Person One',
        )
        with (
            patch('accounts.views.settings.BAYYINAH_FRONTEND_URL', 'http://localhost:5173'),
            patch('accounts.views.default_token_generator.make_token', return_value='token-value'),
            patch('accounts.views.send_mail') as send_mail,
        ):
            _send_invitation_email(user)

        email = send_mail.call_args.kwargs
        self.assertIn('finish setting up your account', email['message'])
        self.assertIn(
            'http://localhost:5173/set-password?uid=NQ&token=token-value',
            email['message'],
        )
        self.assertNotIn('Here is the link to reset your password', email['message'])

    def test_invalid_reset_token_does_not_change_password(self):
        request = self.factory.post(
            '/api/accounts/password-reset/confirm/',
            {'uid': 'NQ', 'token': 'invalid', 'password': 'Strong-password-2026!'},
            format='json',
        )
        user = MagicMock()
        with (
            patch('accounts.views.urlsafe_base64_decode', return_value=b'5'),
            patch('accounts.views.User.objects.get', return_value=user),
            patch('accounts.views.default_token_generator.check_token', return_value=False),
            patch('accounts.views.validate_password') as validate_password,
        ):
            response = PasswordResetConfirmView.as_view()(request)

        self.assertEqual(response.status_code, 400)
        user.set_password.assert_not_called()
        validate_password.assert_not_called()

    def test_valid_invitation_token_sets_password(self):
        request = self.factory.post(
            '/api/accounts/set-password/',
            {'uid': 'NQ', 'token': 'valid', 'password': 'Strong-password-2026!'},
            format='json',
        )
        with patch(
            'accounts.views._change_password',
            return_value=(SimpleNamespace(), None),
        ) as change_password:
            response = SetPasswordView.as_view()(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['detail'], 'Password set successfully.')
        change_password.assert_called_once()

    def test_non_hr_cannot_import_csv(self):
        request = self.factory.post(
            '/api/accounts/import-csv/',
            {},
            format='multipart',
        )
        force_authenticate(
            request,
            user=SimpleNamespace(is_authenticated=True, role='Manager'),
        )
        response = CSVEmployeeImportView.as_view()(request)
        self.assertEqual(response.status_code, 403)

    def test_csv_import_adds_account_ids_for_separate_invite_step(self):
        upload = SimpleUploadedFile(
            'employees.csv',
            b'email,first_name,last_name,system_role,department\nperson@example.com,Person,One,Employee,People\n',
            content_type='text/csv',
        )
        request = self.factory.post(
            '/api/accounts/import-csv/',
            {'file': upload},
            format='multipart',
        )
        force_authenticate(request, user=self.hr_user())
        created_user = SimpleNamespace(pk=33)
        with (
            patch('accounts.views.User.objects.filter') as filter_users,
            patch('accounts.views._create_account', return_value=(created_user, MagicMock())) as create_account,
            patch('accounts.views.transaction.atomic', return_value=nullcontext()),
        ):
            filter_users.return_value.exists.return_value = False
            response = CSVEmployeeImportView.as_view()(request)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['pending_invitation_ids'], [33])
        self.assertEqual(response.data['summary']['employees_added'], 1)
        self.assertEqual(response.data['summary']['departments'][0]['name'], 'People')
        self.assertEqual(create_account.call_args.kwargs['first_name'], 'Person')
        self.assertEqual(create_account.call_args.kwargs['last_name'], 'One')

    def test_csv_import_accepts_and_counts_hr_rows(self):
        upload = SimpleUploadedFile(
            'hr.csv',
            (
                b'email,first_name,last_name,system_role,department\n'
                b'hr@example.com,Human,Resources,HR,People\n'
                b'hr2@example.com,Another,Professional,hr professional,People\n'
            ),
            content_type='text/csv',
        )
        request = self.factory.post(
            '/api/accounts/import-csv/',
            {'file': upload},
            format='multipart',
        )
        force_authenticate(request, user=self.hr_user())
        users = [SimpleNamespace(pk=41), SimpleNamespace(pk=42)]
        with (
            patch('accounts.views.User.objects.filter') as filter_users,
            patch(
                'accounts.views._create_account',
                side_effect=[(user, MagicMock()) for user in users],
            ) as create_account,
            patch('accounts.views.transaction.atomic', return_value=nullcontext()),
        ):
            filter_users.return_value.exists.return_value = False
            response = CSVEmployeeImportView.as_view()(request)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['pending_invitation_ids'], [41, 42])
        self.assertEqual(response.data['summary']['hr_added'], 2)
        self.assertEqual(response.data['summary']['employees_added'], 0)
        self.assertEqual(response.data['summary']['managers_added'], 0)
        self.assertEqual(create_account.call_args_list[0].kwargs['role'], 'HR')
        self.assertEqual(create_account.call_args_list[1].kwargs['role'], 'HR')
        self.assertEqual(response.data['errors'], [])

    def test_csv_import_rejects_combined_name_column(self):
        upload = SimpleUploadedFile(
            'employees.csv',
            b'email,full_name,system_role\nperson@example.com,Person One,Employee\n',
            content_type='text/csv',
        )
        request = self.factory.post(
            '/api/accounts/import-csv/',
            {'file': upload},
            format='multipart',
        )
        force_authenticate(request, user=self.hr_user())

        response = CSVEmployeeImportView.as_view()(request)

        self.assertEqual(response.status_code, 400)
        self.assertIn('unsupported columns', response.data['file'])

    def test_team_invite_uses_separate_name_fields(self):
        request = self.factory.post(
            '/api/accounts/team-invite/',
            {
                'email': 'person@example.com',
                'first_name': 'Person',
                'last_name': 'One',
                'role': 'Employee',
            },
            format='json',
        )
        force_authenticate(request, user=self.hr_user())
        user = SimpleNamespace(email='person@example.com')
        with (
            patch('accounts.views.User.objects.filter') as filter_users,
            patch(
                'accounts.views._create_account',
                return_value=(user, MagicMock()),
            ) as create_account,
            patch('accounts.views.transaction.atomic', return_value=nullcontext()),
            patch('accounts.views._send_invitation_email'),
        ):
            filter_users.return_value.exists.return_value = False
            response = TeamInviteView.as_view()(request)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(create_account.call_args.kwargs['first_name'], 'Person')
        self.assertEqual(create_account.call_args.kwargs['last_name'], 'One')

    def test_invite_all_uses_ids_without_a_batch_table(self):
        request = self.factory.post(
            '/api/accounts/import-csv/invite-all/',
            {'employee_ids': [33]},
            format='json',
        )
        force_authenticate(request, user=self.hr_user())
        user = MagicMock()
        user.pk = 33
        user.org_id = 12
        user.has_usable_password.return_value = False
        with (
            patch('accounts.views.User.objects.filter') as filter_users,
            patch('accounts.views._send_invitation_email') as send_email,
        ):
            filter_users.return_value.first.return_value = user
            response = CSVImportInviteAllView.as_view()(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['invited'], 1)
        self.assertEqual(response.data['remaining_ids'], [])
        filter_users.assert_called_once_with(
            user_id=33,
            org_id=12,
            employee_record__system_role__in=['Employee', 'Manager', 'HR'],
        )
        send_email.assert_called_once_with(user)
